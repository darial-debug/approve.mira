import { json, requireAuth, readData, writeData } from './_lib.js';
import { isSlackBotConfigured } from './_notify.js';

// POST   /api/slack-connect   → issue a one-time code the user pastes into Slack DM
// DELETE /api/slack-connect   → unlink Slack from current user
export default async (req) => {
  try {
    const me = await requireAuth(req);
    if (!isSlackBotConfigured()) {
      return json(503, { error: 'Slack bot is not configured on the server.' });
    }

    if (req.method === 'POST') {
      const codes = await readData('slack_codes', {});
      for (const k of Object.keys(codes)) {
        if (codes[k]?.userId === me.id) delete codes[k];
      }
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      codes[code] = { userId: me.id, createdAt: Date.now() };
      await writeData('slack_codes', codes);
      return json(200, { code });
    }

    if (req.method === 'DELETE') {
      const users = await readData('users', []);
      const u = users.find((x) => x.id === me.id);
      if (u) {
        delete u.slackUserId;
        await writeData('users', users);
      }
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/slack-connect' };
