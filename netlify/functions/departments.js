import { json, requireAuth, requireAdmin, readData, writeData, newId } from './_lib.js';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const id = segments[2];

    if (req.method === 'GET') {
      await requireAuth(req);
      const departments = await readData('departments', []);
      return json(200, { departments });
    }

    if (req.method === 'POST' && !id) {
      await requireAdmin(req);
      const body = await req.json();
      const name = (body.name || '').trim();
      const headUserId = body.headUserId || null;
      if (!name) return json(400, { error: 'Name required' });
      const departments = await readData('departments', []);
      const dept = { id: newId('d'), name, headUserId, createdAt: new Date().toISOString() };
      departments.push(dept);
      await writeData('departments', departments);
      return json(200, { department: dept });
    }

    if (req.method === 'PATCH' && id) {
      await requireAdmin(req);
      const body = await req.json();
      const departments = await readData('departments', []);
      const d = departments.find((x) => x.id === id);
      if (!d) return json(404, { error: 'Department not found' });
      if (body.name !== undefined) d.name = String(body.name).trim();
      if (body.headUserId !== undefined) d.headUserId = body.headUserId || null;
      await writeData('departments', departments);
      return json(200, { department: d });
    }

    if (req.method === 'DELETE' && id) {
      await requireAdmin(req);
      const departments = await readData('departments', []);
      await writeData('departments', departments.filter((d) => d.id !== id));
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: ['/api/departments', '/api/departments/*'] };
