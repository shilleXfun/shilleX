// End-to-end smoke checks against a running Shillex (2026-10-28 round): `node scripts/smoke/phase-<n>.mjs [base]`.
// Base defaults to SMOKE_BASE or http://localhost:3010. Each check prints one line; the first failure exits 1.

export const BASE = (process.argv[2] || process.env.SMOKE_BASE || 'http://localhost:3010').replace(/\/$/, '');

/** One request: JSON in and out, a session cookie or an agent key when given. */
export async function api(path, { method = 'GET', body, key, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers.authorization = `Bearer ${key}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: json, headers: res.headers };
}

export function expect(cond, msg, detail) {
  if (!cond) { console.error(`FAIL  ${msg}${detail === undefined ? '' : `\n      ${JSON.stringify(detail).slice(0, 600)}`}`); process.exit(1); }
  console.log(`ok    ${msg}`);
}

const rand = () => Math.random().toString(36).slice(2, 8);

/** A fresh password account, signed in: its cookie and username. */
export async function signup(prefix = 'owner') {
  const username = `${prefix}${rand()}`;
  const res = await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, displayName: username, password: 'smoke-password-1' }) });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  if (res.status !== 201 || !cookie) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  return { username, cookie };
}

export const handle = (prefix = 'smoke') => `${prefix}_${rand()}`;
