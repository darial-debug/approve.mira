import { readData, writeData, newId } from './_lib.js';

function clean(v) {
  return (v || '').trim().replace(/^"+|"+$/g, '').trim();
}

// ───────────────────────────── Config helpers ─────────────────────────────

export function appBaseUrl() {
  return clean(process.env.APP_BASE_URL) || 'http://localhost:8888';
}

export function slackBotToken() { return clean(process.env.SLACK_BOT_TOKEN); }
export function isSlackBotConfigured() { return !!process.env.SLACK_BOT_TOKEN; }
export function slackSigningSecret() { return clean(process.env.SLACK_SIGNING_SECRET); }

export function telegramBotToken() { return clean(process.env.TELEGRAM_BOT_TOKEN); }
export function isTelegramConfigured() { return !!process.env.TELEGRAM_BOT_TOKEN; }

export function resendApiKey() { return clean(process.env.RESEND_API_KEY); }
export function resendFromAddress() {
  return clean(process.env.RESEND_FROM) || 'approve.mira <noreply@approve.mira>';
}
export function isEmailConfigured() { return !!process.env.RESEND_API_KEY; }

// ───────────────────────────── In-app inbox ──────────────────────────────

export async function pushInbox(userId, payload) {
  const inbox = await readData('inbox', {});
  const list = inbox[userId] || [];
  list.unshift({ id: newId('n'), at: new Date().toISOString(), read: false, ...payload });
  // Cap per-user inbox size so the JSON blob stays small.
  inbox[userId] = list.slice(0, 200);
  await writeData('inbox', inbox);
}

// ───────────────────────────── Slack ─────────────────────────────

function escapeMrkdwn(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendSlackDM(slackUserId, text) {
  if (!isSlackBotConfigured() || !slackUserId) return { skipped: true };
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer ' + slackBotToken(),
    },
    body: JSON.stringify({ channel: slackUserId, text, mrkdwn: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) return { ok: false, error: data.error };
  return { ok: true, ts: data.ts };
}

export async function sendSlackApprovalRequest(slackUserId, { taskId, taskTitle, submitterName, category }) {
  if (!isSlackBotConfigured() || !slackUserId) return { skipped: true };
  const url = `${appBaseUrl()}/#/task/${taskId}`;
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*New approval needed* — _${escapeMrkdwn(category)}_\n*${escapeMrkdwn(taskTitle)}*\nFrom: ${escapeMrkdwn(submitterName)}`,
      },
    },
    {
      type: 'actions',
      block_id: `task_${taskId}`,
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Approve' }, style: 'primary', action_id: 'approve', value: taskId },
        { type: 'button', text: { type: 'plain_text', text: 'Decline' }, style: 'danger', action_id: 'decline', value: taskId },
        { type: 'button', text: { type: 'plain_text', text: 'Open' }, action_id: 'open', url },
      ],
    },
  ];

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer ' + slackBotToken(),
    },
    body: JSON.stringify({ channel: slackUserId, text: `Approval needed: ${taskTitle}`, blocks }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) return { ok: false, error: data.error };
  return { ok: true, ts: data.ts };
}

export async function slackUserInfo(slackUserId) {
  if (!isSlackBotConfigured() || !slackUserId) return null;
  try {
    const res = await fetch('https://slack.com/api/users.info?user=' + encodeURIComponent(slackUserId), {
      headers: { Authorization: 'Bearer ' + slackBotToken() },
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !data.user) return null;
    return {
      id: data.user.id,
      name: data.user.real_name || data.user.profile?.real_name || data.user.name || data.user.id,
      email: data.user.profile?.email || '',
    };
  } catch {
    return null;
  }
}

// ───────────────────────────── Telegram ─────────────────────────────

export async function sendTelegram(chatId, text) {
  if (!isTelegramConfigured() || !chatId) return { skipped: true };
  const url = `https://api.telegram.org/bot${telegramBotToken()}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: text.slice(0, 3900),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

// ───────────────────────────── Email (Resend) ─────────────────────────────

export async function sendEmail(to, subject, html) {
  if (!isEmailConfigured() || !to) return { skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + resendApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: resendFromAddress(), to: [to], subject, html }),
  });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

// ───────────────────────────── Unified dispatch ─────────────────────────────

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Send the same message to a user across every channel they've opted into.
// `kind` is a short identifier (e.g. "approval_request", "decision") for analytics.
export async function notifyUser(user, { kind, taskId, title, body, slackPayload }) {
  if (!user) return;
  const url = `${appBaseUrl()}/#/task/${taskId}`;
  const plain = `${title}\n\n${body}\n\n${url}`;
  const html = `<p><b>${escapeHtml(title)}</b></p><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p><p><a href="${url}">Open in approve.mira</a></p>`;

  await pushInbox(user.id, { kind, taskId, title, body }).catch(() => {});

  const jobs = [];
  if (user.slackUserId) {
    if (slackPayload) {
      jobs.push(sendSlackApprovalRequest(user.slackUserId, slackPayload));
    } else {
      jobs.push(sendSlackDM(user.slackUserId, `*${title}*\n${body}\n${url}`));
    }
  }
  if (user.telegramChatId) {
    jobs.push(sendTelegram(user.telegramChatId, `<b>${escapeHtml(title)}</b>\n${escapeHtml(body)}\n\n${url}`));
  }
  if (user.email && user.notifyEmail !== false) {
    jobs.push(sendEmail(user.email, title, html));
  }
  await Promise.allSettled(jobs);
}
