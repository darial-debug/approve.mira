import { json } from './_lib.js';
import { isSlackBotConfigured, isTelegramConfigured, isEmailConfigured } from './_notify.js';

export default async () => json(200, {
  ok: true,
  channels: {
    slack: isSlackBotConfigured(),
    telegram: isTelegramConfigured(),
    email: isEmailConfigured(),
  },
});

export const config = { path: '/api/status' };
