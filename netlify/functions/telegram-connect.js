import { json, requireAuth, readData, writeData } from './_lib.js';
import { isTelegramConfigured } from './_notify.js';

// POST   /api/telegram-connect   → issue a one-time code + deep link to the bot
// DELETE /api/telegram-connect   → unlink Telegram
export default async (req) => {
  try {
    const me = await requireAuth(req);
    if (!isTelegramConfigured()) {
      return json(503, { error: 'Telegram bot not configured on the server.' });
    }

    if (req.method === 'POST') {
      const codes = await readData('telegram_codes', {});
      for (const k of Object.keys(codes)) {
        if (codes[k]?.userId === me.id) delete codes[k];
      }
      const code = Math.random().toString(36).slice(2, 10).toUpperCase();
      codes[code] = { userId: me.id, createdAt: Date.now() };
      await writeData('telegram_codes', codes);
      const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').trim();
      const deepLink = botUsername ? `https://t.me/${botUsername}?start=${code}` : null;
      return json(200, { code, deepLink });
    }

    if (req.method === 'DELETE') {
      const users = await readData('users', []);
      const u = users.find((x) => x.id === me.id);
      if (u) {
        delete u.telegramChatId;
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

export const config = { path: '/api/telegram-connect' };
