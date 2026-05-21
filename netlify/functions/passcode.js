import { json, requireAuth, readData, writeData, bcrypt } from './_lib.js';

export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const me = await requireAuth(req);
    const body = await req.json();
    const current = (body.currentPasscode || '').trim();
    const next = (body.newPasscode || '').trim();
    if (!/^\d{4,8}$/.test(next)) return json(400, { error: 'New passcode must be 4–8 digits' });

    const users = await readData('users', []);
    const user = users.find((u) => u.id === me.id);
    if (!user) return json(404, { error: 'User not found' });

    const ok = await bcrypt.compare(current, user.passcodeHash);
    if (!ok) return json(401, { error: 'Current passcode is wrong' });

    user.passcodeHash = await bcrypt.hash(next, 10);
    await writeData('users', users);
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message });
  }
};

export const config = { path: '/api/passcode' };
