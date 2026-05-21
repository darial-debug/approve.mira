import { json, requireAuth, requireAdmin, readData, writeData, bcrypt, safeUser, ROLES, newId } from './_lib.js';

// /api/users
//   GET    — auth: list every user (lightweight) so submitters can build approval paths
//   POST   — admin: create a user
// /api/users/:id
//   PATCH  — admin: edit user
//   DELETE — admin: remove user
export default async (req) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean); // ['api','users',':id?']
    const userId = segments[2];

    if (req.method === 'GET') {
      await requireAuth(req);
      const users = await readData('users', []);
      return json(200, { users: users.map(safeUser) });
    }

    if (req.method === 'POST' && !userId) {
      await requireAdmin(req);
      const body = await req.json();
      const email = (body.email || '').trim().toLowerCase();
      const name = (body.name || '').trim();
      const role = body.role || 'employee';
      const departmentId = body.departmentId || null;
      const passcode = (body.passcode || '').trim() || String(Math.floor(1000 + Math.random() * 9000));

      if (!email || !name) return json(400, { error: 'Email and name required' });
      if (!ROLES.includes(role)) return json(400, { error: 'Invalid role' });
      if (!/^\d{4,8}$/.test(passcode)) return json(400, { error: 'Passcode must be 4–8 digits' });

      const users = await readData('users', []);
      if (users.some((u) => u.email.toLowerCase() === email)) {
        return json(409, { error: 'Email already in use' });
      }
      const passcodeHash = await bcrypt.hash(passcode, 10);
      const user = {
        id: newId('u'),
        email,
        name,
        role,
        departmentId,
        passcodeHash,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      await writeData('users', users);
      // We return the initial passcode once so admin can hand it off.
      return json(200, { user: safeUser(user), initialPasscode: passcode });
    }

    if (req.method === 'PATCH' && userId) {
      await requireAdmin(req);
      const body = await req.json();
      const users = await readData('users', []);
      const u = users.find((x) => x.id === userId);
      if (!u) return json(404, { error: 'User not found' });

      if (body.name !== undefined) u.name = String(body.name).trim();
      if (body.email !== undefined) u.email = String(body.email).trim().toLowerCase();
      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) return json(400, { error: 'Invalid role' });
        u.role = body.role;
      }
      if (body.departmentId !== undefined) u.departmentId = body.departmentId || null;
      if (body.resetPasscode) {
        const next = String(Math.floor(1000 + Math.random() * 9000));
        u.passcodeHash = await bcrypt.hash(next, 10);
        await writeData('users', users);
        return json(200, { user: safeUser(u), newPasscode: next });
      }
      await writeData('users', users);
      return json(200, { user: safeUser(u) });
    }

    if (req.method === 'DELETE' && userId) {
      await requireAdmin(req);
      const users = await readData('users', []);
      const next = users.filter((u) => u.id !== userId);
      await writeData('users', next);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/users/*' };
