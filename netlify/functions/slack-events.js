import crypto from 'node:crypto';
import { json, readData, writeData } from './_lib.js';
import { sendSlackDM, slackSigningSecret } from './_notify.js';

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

// Handles Slack Events API: app_home messages so users can DM "CODE 6-char-code"
// to link their Slack identity to an approve.mira user account.
export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const rawBody = await req.text();
    const signature = req.headers.get('x-slack-signature');
    const timestamp = req.headers.get('x-slack-request-timestamp');

    if (!verifySlackSignature(rawBody, signature, timestamp, slackSigningSecret())) {
      return json(401, { error: 'Bad signature' });
    }

    const payload = JSON.parse(rawBody);

    // URL verification handshake when configuring the Events API endpoint.
    if (payload.type === 'url_verification') {
      return new Response(payload.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    if (payload.type !== 'event_callback') return json(200, { ok: true });
    const event = payload.event || {};

    // Only handle DMs to the bot (channel_type === 'im') containing a connect code.
    if (event.type === 'message' && event.channel_type === 'im' && !event.bot_id) {
      const text = (event.text || '').trim();
      const m = text.match(/^([A-Z0-9]{6})$/i);
      if (m) {
        const code = m[1].toUpperCase();
        const codes = await readData('slack_codes', {});
        const entry = codes[code];
        if (!entry) {
          await sendSlackDM(event.user, "That code isn't valid (or already used). Generate a new one in approve.mira → Profile → Connect Slack.");
        } else if (Date.now() - entry.createdAt > 1000 * 60 * 30) {
          delete codes[code];
          await writeData('slack_codes', codes);
          await sendSlackDM(event.user, 'That code expired. Generate a fresh one in approve.mira.');
        } else {
          const users = await readData('users', []);
          const u = users.find((x) => x.id === entry.userId);
          if (u) {
            u.slackUserId = event.user;
            await writeData('users', users);
            delete codes[code];
            await writeData('slack_codes', codes);
            await sendSlackDM(event.user, `✅ Linked! You'll now get approval requests here, ${u.name}.`);
          }
        }
      } else {
        await sendSlackDM(event.user, "Hi! To connect your Slack to approve.mira, paste your 6-character code here (get it from Profile → Connect Slack in the app).");
      }
    }

    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/slack-events' };
