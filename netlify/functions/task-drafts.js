import { json, requireAuth, readData, writeData } from './_lib.js';

// GET    /api/task-drafts          → list mine
// DELETE /api/task-drafts/:id      → discard one (used after promoting to real task)
export default async (req) => {
  try {
    const me = await requireAuth(req);
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const id = segments[2];

    const all = await readData('task_drafts', {});
    if (req.method === 'GET') {
      return json(200, { drafts: all[me.id] || [] });
    }
    if (req.method === 'DELETE' && id) {
      all[me.id] = (all[me.id] || []).filter((d) => d.id !== id);
      await writeData('task_drafts', all);
      return json(200, { ok: true });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/task-drafts/*' };
