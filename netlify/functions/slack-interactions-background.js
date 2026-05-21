import crypto from 'node:crypto';
import { json, readData, writeData, newId, appendAudit } from './_lib.js';
import {
  sendSlackDM, slackSigningSecret, isSlackBotConfigured, slackUserInfo, notifyUser,
  appBaseUrl,
} from './_notify.js';

function verifySlackSignature(body, signature, timestamp, secret) {
  if (!signature || !timestamp || !secret) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) return false;
  const base = `v0:${timestamp}:${body}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// "Send to approve.mira" — message shortcut.
// Captures the message as a DRAFT task; the user finishes the form in the web app.
async function processSendShortcut(payload) {
  const actorSlackId = payload.user?.id;
  const message = payload.message || {};
  const messageText = (message.text || '').trim();

  const users = await readData('users', []);
  const me = users.find((u) => u.slackUserId === actorSlackId);
  if (!me) {
    await sendSlackDM(
      actorSlackId,
      "👋 Connect your Slack to approve.mira first (Profile → Connect Slack in the app), then this shortcut will create a draft for you."
    );
    return;
  }
  if (!messageText && !(message.files && message.files.length)) {
    await sendSlackDM(actorSlackId, "I can't read that message (no text). Try one with text content.");
    return;
  }

  // Capture sender info so the draft has provenance.
  let senderName = null;
  if (message.user && message.user !== actorSlackId) {
    const info = await slackUserInfo(message.user).catch(() => null);
    senderName = info?.name || `Slack user <@${message.user}>`;
  }

  const draftId = newId('draft');
  const drafts = await readData('task_drafts', {});
  if (!Array.isArray(drafts[me.id])) drafts[me.id] = [];
  drafts[me.id].push({
    id: draftId,
    title: messageText.slice(0, 80) || 'From Slack',
    description: messageText,
    senderName,
    slackMessage: {
      channelId: payload.channel?.id || null,
      channelName: payload.channel?.name || null,
      ts: message.ts || null,
      text: messageText,
      sender: message.user || null,
    },
    createdAt: new Date().toISOString(),
  });
  await writeData('task_drafts', drafts);

  const url = `${appBaseUrl()}/#/new?draft=${draftId}`;
  if (payload.response_url) {
    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `📩 Sent to approve.mira as a draft.\nFinish setting it up here: ${url}`,
      }),
    }).catch(() => {});
  }
  await sendSlackDM(actorSlackId, `📩 Sent to approve.mira as a draft.\n${url}`);
}

// Approve / Decline buttons on approval DMs.
async function processButtonAction(payload) {
  const action = (payload.actions || [])[0];
  if (!action) return;
  const actorSlackId = payload.user?.id;
  const taskId = action.value;
  if (!taskId || (action.action_id !== 'approve' && action.action_id !== 'decline')) return;

  const users = await readData('users', []);
  const me = users.find((u) => u.slackUserId === actorSlackId);
  if (!me) {
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: 'ephemeral', text: 'Connect your Slack to approve.mira first.' }),
      }).catch(() => {});
    }
    return;
  }

  const tasks = await readData('tasks', []);
  const t = tasks.find((x) => x.id === taskId);
  if (!t || t.status !== 'under_review') {
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: 'ephemeral', text: 'That task is no longer pending.' }),
      }).catch(() => {});
    }
    return;
  }

  const idx = t.steps.findIndex((s) => s.status === 'pending');
  const step = t.steps[idx];
  if (!step || step.approverId !== me.id) {
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response_type: 'ephemeral', text: "It's not your step right now." }),
      }).catch(() => {});
    }
    return;
  }

  const now = new Date().toISOString();
  if (action.action_id === 'approve') {
    step.status = 'approved';
    step.actedAt = now;
    const nextIdx = t.steps.findIndex((s) => s.status === 'pending');
    if (nextIdx === -1) t.status = 'approved';
    await appendAudit(t.id, { action: 'approved_step', userId: me.id, meta: { stepNumber: step.stepNumber, via: 'slack' } });
  } else {
    step.status = 'declined';
    step.actedAt = now;
    t.status = 'declined';
    await appendAudit(t.id, { action: 'declined', userId: me.id, meta: { stepNumber: step.stepNumber, via: 'slack' } });
  }
  t.updatedAt = now;
  await writeData('tasks', tasks);

  const submitter = users.find((u) => u.id === t.submitterId);
  if (t.status === 'approved') {
    await notifyUser(submitter, {
      kind: 'decision',
      taskId: t.id,
      title: `Approved — ${t.title}`,
      body: 'Your request was approved by all approvers.',
    });
  } else if (t.status === 'declined') {
    await notifyUser(submitter, {
      kind: 'decision',
      taskId: t.id,
      title: `Declined — ${t.title}`,
      body: `${me.name} declined at step ${step.stepNumber}.`,
    });
  } else {
    // Notify next approver
    const nextStep = t.steps.find((s) => s.status === 'pending');
    const nextApprover = users.find((u) => u.id === nextStep?.approverId);
    if (nextApprover) {
      await notifyUser(nextApprover, {
        kind: 'approval_request',
        taskId: t.id,
        title: `Approval needed — ${t.title}`,
        body: `You're step ${nextStep.stepNumber} of ${t.steps.length}.`,
        slackPayload: {
          taskId: t.id,
          taskTitle: t.title,
          submitterName: submitter?.name || 'A teammate',
          category: t.category,
        },
      });
    }
  }

  // Replace the original buttons with a status message so it doesn't get clicked again.
  if (payload.response_url) {
    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: true,
        text: `${action.action_id === 'approve' ? '✅ Approved' : '❌ Declined'} — *${t.title}*`,
      }),
    }).catch(() => {});
  }
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isSlackBotConfigured()) return new Response('OK', { status: 200 });

  const rawBody = await req.text();
  const signature = req.headers.get('x-slack-signature');
  const timestamp = req.headers.get('x-slack-request-timestamp');

  const secret = slackSigningSecret();
  if (secret && !verifySlackSignature(rawBody, signature, timestamp, secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    const params = new URLSearchParams(rawBody);
    const raw = params.get('payload');
    if (!raw) return json(400, { error: 'No payload' });
    payload = JSON.parse(raw);
  } catch (e) {
    return json(400, { error: 'Invalid payload: ' + e.message });
  }

  // Dedupe (Slack can retry on transient errors)
  if (payload?.trigger_id) {
    const processed = await readData('slack_processed', {});
    if (processed[payload.trigger_id]) return new Response('OK', { status: 200 });
    processed[payload.trigger_id] = Date.now();
    await writeData('slack_processed', processed);
  }

  try {
    if (payload.type === 'message_action' && payload.callback_id === 'send_to_approve_mira') {
      await processSendShortcut(payload);
    } else if (payload.type === 'block_actions') {
      await processButtonAction(payload);
    }
  } catch (e) {
    console.error('Slack interaction failed:', e.message);
  }

  return new Response('', { status: 200 });
};
