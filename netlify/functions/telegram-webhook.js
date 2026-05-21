import { json, readData, writeData } from './_lib.js';
import { sendTelegram, isTelegramConfigured } from './_notify.js';

// Telegram calls this on every bot update. We only care about /start <code>
// messages — that's how a user links their Telegram chat to an approve.mira user.
export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    if (!isTelegramConfigured()) return json(200, { ok: true });

    // Optional secret token (set via setWebhook), guards against spoofing.
    const expected = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    const got = req.headers.get('x-telegram-bot-api-secret-token') || '';
    if (expected && expected !== got) return json(401, { error: 'Bad secret' });

    const update = await req.json();
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return json(200, { ok: true });
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    const startMatch = text.match(/^\/start\s+([A-Z0-9]{6,12})$/i);
    if (startMatch) {
      const code = startMatch[1].toUpperCase();
      const codes = await readData('telegram_codes', {});
      const entry = codes[code];
      if (!entry) {
        await sendTelegram(chatId, "That link isn't valid. Generate a fresh one in approve.mira → Profile → Connect Telegram.");
      } else if (Date.now() - entry.createdAt > 1000 * 60 * 30) {
        delete codes[code];
        await writeData('telegram_codes', codes);
        await sendTelegram(chatId, 'That link expired. Generate a fresh one in approve.mira.');
      } else {
        const users = await readData('users', []);
        const u = users.find((x) => x.id === entry.userId);
        if (u) {
          u.telegramChatId = String(chatId);
          await writeData('users', users);
          delete codes[code];
          await writeData('telegram_codes', codes);
          await sendTelegram(chatId, `✅ Linked, ${u.name}! You'll get approve.mira notifications here.`);
        }
      }
      return json(200, { ok: true });
    }

    if (text.startsWith('/start')) {
      await sendTelegram(chatId, "Hi! To connect, open approve.mira → Profile → Connect Telegram, then click the deep link there. (Or paste it as /start CODE.)");
    }
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/telegram-webhook' };
