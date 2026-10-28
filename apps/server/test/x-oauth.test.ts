import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { oauthStates, userXAccounts, users } from '../src/db/schema.ts';
import { finishXLogin, startXLogin } from '../src/services/x-oauth.ts';

/** Owners sign in with X (2026-10-28 brief §1): OAuth 2.0 with PKCE; X answers are faked here, nothing leaves the test. */
const config = loadConfig({ NODE_ENV: 'test', X_OAUTH_CLIENT_ID: 'cid', X_OAUTH_CLIENT_SECRET: 'csecret', PUBLIC_URL: 'https://shillex.test' });
const now = () => new Date('2026-10-28T12:00:00Z');

function fakeX(me: { id: string; username: string; name: string }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'at', token_type: 'bearer' }), { status: 200 });
    if (String(url).includes('/users/me')) return new Response(JSON.stringify({ data: me }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

describe('signing in with X', () => {
  it('sends the owner to X with a PKCE challenge and remembers the state', async () => {
    const { db } = await testDb();
    const url = new URL(await startXLogin({ db, config, now }, '/owner'));
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://shillex.test/api/auth/x/callback');
    const [row] = await db.select().from(oauthStates).where(eq(oauthStates.state, url.searchParams.get('state')!));
    expect(row).toMatchObject({ next: '/owner' });
  });

  it('refuses an unknown state', async () => {
    const { db } = await testDb();
    await expect(finishXLogin({ db, config, now }, { code: 'c', state: 'nope' }, fakeX({ id: '1', username: 'a', name: 'A' }).f)).rejects.toMatchObject({ code: 'X_LOGIN_EXPIRED' });
  });

  it('makes one account for an X user, and signs the same person in again later', async () => {
    const { db } = await testDb();
    const x = fakeX({ id: '42', username: 'kacper_dev', name: 'Kacper' });
    const first = new URL(await startXLogin({ db, config, now }, null)).searchParams.get('state')!;
    const a = await finishXLogin({ db, config, now }, { code: 'code1', state: first }, x.f);
    const token = x.calls.find((c) => c.url.includes('/oauth2/token'))!;
    expect(String(token.init?.body)).toMatch(/code_verifier=/);
    expect(new Headers(token.init?.headers).get('authorization')).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    const second = new URL(await startXLogin({ db, config, now }, null)).searchParams.get('state')!;
    const b = await finishXLogin({ db, config, now }, { code: 'code2', state: second }, x.f);
    expect(b.userId).toBe(a.userId);
    const [u] = await db.select().from(users).where(eq(users.id, a.userId));
    expect(u).toMatchObject({ username: 'kacper_dev', kind: 'human' });
    expect(await db.select().from(userXAccounts)).toHaveLength(1);
    // A state works once.
    await expect(finishXLogin({ db, config, now }, { code: 'code3', state: second }, x.f)).rejects.toMatchObject({ code: 'X_LOGIN_EXPIRED' });
  });
});
