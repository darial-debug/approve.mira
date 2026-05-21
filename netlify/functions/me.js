import { json, requireAuth, readData, safeUser } from './_lib.js';

export default async (req) => {
  try {
    const me = await requireAuth(req);
    const inbox = await readData('inbox', {});
    const myInbox = inbox[me.id] || [];
    const unread = myInbox.filter((n) => !n.read).length;
    return json(200, { user: safeUser(me), unread, inbox: myInbox.slice(0, 50) });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/me' };
