import { json, requireAuth, readData, writeData } from './_lib.js';

// GET  /api/notifications        → list mine
// POST /api/notifications  { ids: [...] } → mark read (ids omitted = all)
export default async (req) => {
  try {
    const me = await requireAuth(req);
    const inbox = await readData('inbox', {});

    if (req.method === 'GET') {
      return json(200, { items: inbox[me.id] || [] });
    }
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const ids = Array.isArray(body.ids) ? new Set(body.ids) : null;
      const list = inbox[me.id] || [];
      for (const n of list) {
        if (!ids || ids.has(n.id)) n.read = true;
      }
      inbox[me.id] = list;
      await writeData('inbox', inbox);
      return json(200, { ok: true });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/notifications' };
