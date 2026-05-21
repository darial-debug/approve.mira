import { json, requireAdmin } from './_lib.js';
import { telegramBotToken, isTelegramConfigured } from './_notify.js';

// One-shot helper: admin clicks "Register webhook" in profile/admin and we
// tell Telegram where to send updates for this bot.
export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    await requireAdmin(req);
    if (!isTelegramConfigured()) return json(503, { error: 'TELEGRAM_BOT_TOKEN missing' });

    const body = await req.json().catch(() => ({}));
    const base = (body.baseUrl || process.env.APP_BASE_URL || '').trim();
    if (!base) return json(400, { error: 'baseUrl required (or set APP_BASE_URL env)' });

    const webhookUrl = base.replace(/\/$/, '') + '/api/telegram-webhook';
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    const params = new URLSearchParams({ url: webhookUrl });
    if (secret) params.set('secret_token', secret);
    const res = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/setWebhook?${params.toString()}`);
    const data = await res.json();
    if (!data.ok) return json(500, { error: data.description || 'Telegram error' });
    return json(200, { ok: true, webhook: webhookUrl });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/telegram-setup' };
