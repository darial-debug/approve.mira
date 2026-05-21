import { json, readData, writeData, signToken, bcrypt, safeUser, newId } from './_lib.js';

const SEED_ADMIN_EMAIL = 'daria.l@miracreative.ae';

export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'POST only' });
    const body = await req.json();
    const email = (body.email || '').trim().toLowerCase();
    const passcode = (body.passcode || '').trim();
    const firstSetup = !!body.firstSetup;
    const name = (body.name || '').trim();

    if (!email || !passcode) return json(400, { error: 'Email and passcode required' });
    if (!/^\d{4,8}$/.test(passcode)) return json(400, { error: 'Passcode must be 4–8 digits' });

    let users = await readData('users', []);

    // First-time setup: only allowed when the seed admin doesn't exist yet.
    if (firstSetup) {
      if (users.length > 0) return json(409, { error: 'Already initialized — sign in instead.' });
      if (email !== SEED_ADMIN_EMAIL) {
        return json(403, { error: `First admin must be ${SEED_ADMIN_EMAIL}` });
      }
      if (!name) return json(400, { error: 'Name required for setup' });
      const passcodeHash = await bcrypt.hash(passcode, 10);
      const admin = {
        id: newId('u'),
        email,
        name,
        passcodeHash,
        role: 'admin',
        departmentId: null,
        createdAt: new Date().toISOString(),
      };
      await writeData('users', [admin]);
      const token = await signToken({ uid: admin.id });
      return json(200, { token, user: safeUser(admin) });
    }

    const user = users.find((u) => u.email.toLowerCase() === email);
    if (!user) return json(401, { error: 'Invalid email or passcode' });
    const ok = await bcrypt.compare(passcode, user.passcodeHash);
    if (!ok) return json(401, { error: 'Invalid email or passcode' });

    const token = await signToken({ uid: user.id });
    return json(200, { token, user: safeUser(user) });
  } catch (e) {
    if (e instanceof Response) return e;
    return json(500, { error: e.message || 'Server error' });
  }
};

export const config = { path: '/api/login' };
