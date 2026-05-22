import { json, requireAuth, requireAdmin, readData, writeData, newId } from './_lib.js';

// GET    /api/projects         → auth: list (used in approval forms)
// POST   /api/projects         → admin: create
// PATCH  /api/projects/:id     → admin: rename
// DELETE /api/projects/:id     → admin: archive
export default async (req) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const id = segments[2];

    if (req.method === 'GET') {
      await requireAuth(req);
      const projects = await readData('projects', []);
      return json(200, { projects });
    }
    if (req.method === 'POST' && !id) {
      // Any signed-in user can add a business while filling a form.
      // If the name already exists (case-insensitive), return that one instead
      // of erroring — so the New form can call this idempotently.
      const me = await requireAuth(req);
      const body = await req.json();
      const name = (body.name || '').trim();
      if (!name) return json(400, { error: 'Name required' });
      const projects = await readData('projects', []);
      const existing = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (existing) return json(200, { project: existing, existed: true });
      const project = { id: newId('p'), name, createdAt: new Date().toISOString(), createdBy: me.id };
      projects.push(project);
      await writeData('projects', projects);
      return json(200, { project, existed: false });
    }
    if (req.method === 'PATCH' && id) {
      await requireAdmin(req);
      const body = await req.json();
      const projects = await readData('projects', []);
      const p = projects.find((x) => x.id === id);
      if (!p) return json(404, { error: 'Project not found' });
      if (body.name !== undefined) p.name = String(body.name).trim();
      await writeData('projects', projects);
      return json(200, { project: p });
    }
    if (req.method === 'DELETE' && id) {
      await requireAdmin(req);
      const projects = await readData('projects', []);
      await writeData('projects', projects.filter((p) => p.id !== id));
      return json(200, { ok: true });
    }
    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: ['/api/projects', '/api/projects/*'] };
