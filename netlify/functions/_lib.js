import { getStore } from '@netlify/blobs';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

const JWT_SECRET_RAW = process.env.JWT_SECRET || 'dev-secret-change-me-please';
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);

export const ROLES = ['employee', 'manager', 'dept_head', 'c_level', 'admin'];
export const CATEGORIES = ['payments', 'content', 'other'];
export const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP'];
export const TASK_STATUS = ['under_review', 'declined', 'approved'];

// Roles allowed to edit the approval path on an in-flight task.
export const PATH_EDITORS = new Set(['dept_head', 'c_level', 'admin']);

export function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function dataStore(name) {
  return getStore({ name, consistency: 'strong' });
}

export async function readData(name, defaultValue) {
  const s = dataStore(name);
  const value = await s.get('data', { type: 'json' });
  return value ?? defaultValue;
}

export async function writeData(name, value) {
  const s = dataStore(name);
  await s.setJSON('data', value);
}

export function fileStore() {
  return getStore({ name: 'files', consistency: 'strong' });
}

export async function signToken(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function getCurrentUser(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.uid) return null;
  const users = await readData('users', []);
  return users.find((u) => u.id === payload.uid) || null;
}

export async function requireAuth(request) {
  const user = await getCurrentUser(request);
  if (!user) throw json(401, { error: 'Not signed in' });
  return user;
}

export async function requireAdmin(request) {
  const user = await requireAuth(request);
  if (user.role !== 'admin') throw json(403, { error: 'Admin only' });
  return user;
}

export function safeUser(u) {
  if (!u) return null;
  const { passcodeHash, ...rest } = u;
  return rest;
}

export function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function appendAudit(taskId, entry) {
  const log = await readData('audit_log', []);
  log.push({
    id: newId('a'),
    taskId,
    at: new Date().toISOString(),
    ...entry,
  });
  await writeData('audit_log', log);
}

export { bcrypt };
