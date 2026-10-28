import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { userXHandles, users } from '../src/db/schema.ts';
import { startXSignIn, verifyXSignIn } from '../src/services/x-signin.ts';

/**
 * Signing in with X by posting (2026-10-28, owner: an "Authorize" screen looks like a scam; type the handle first, it locks
 * in, it can be fixed if mistyped). The person types their X handle, posts the code from that account and pastes the post's
 * link; only a post by the locked handle counts. Shillex reads the public post (oEmbed, no keys). No password or key leaves X.
 */
const config = loadConfig({ NODE_ENV: 'test' });
let t = new Date('2026-10-28T12:00:00Z').getTime();
const now = () => new Date(t);
/** A post id as X makes them: the time it was posted is in its top bits. */
const postId = (ms: number) => ((BigInt(ms) - 1288834974657n) << 22n).toString();
function fakeX(author: string, text: string) {
  return (async (url: string | URL) => {
    if (!String(url).includes('oembed')) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ author_url: `https://twitter.com/${author}`, html: `<blockquote class="twitter-tweet"><p lang="en">${text}</p>&mdash; ${author}</blockquote>` }), { status: 200 });
  }) as typeof fetch;
}
const d = async () => ({ db: (await testDb()).db, config, now });

describe('signing in with X by posting', () => {
  it('locks in the typed handle and gives a post to make: the code, no @, no link', async () => {
    const deps = await d();
    const s = await startXSignIn(deps, { handle: '@Kacper_Dev' });
    expect(s.handle).toBe('kacper_dev');
    expect(s.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(s.text).toContain(s.code);
    expect(s.text).not.toMatch(/@|https?:|\.com|\.fun/);
    expect(s.intentUrl).toBe(`https://x.com/intent/post?text=${encodeURIComponent(s.text)}`);
    await expect(startXSignIn(deps, { handle: 'not a handle!' })).rejects.toMatchObject({ code: 'X_HANDLE_INVALID' });
  });

  it('lets a mistyped handle be fixed, keeping the same sign-in and code', async () => {
    const deps = await d();
    const s = await startXSignIn(deps, { handle: 'kacpr_dev' });
    const fixed = await startXSignIn(deps, { handle: 'kacper_dev', token: s.token });
    expect(fixed).toMatchObject({ token: s.token, code: s.code, handle: 'kacper_dev' });
  });

  it('signs in only a post by the locked handle, makes one account, and signs the same person in later', async () => {
    const deps = await d();
    const a = await startXSignIn(deps, { handle: 'kacper_dev' });
    t += 60_000;
    await expect(verifyXSignIn(deps, { token: a.token, postUrl: `https://x.com/somebody_else/status/${postId(t)}` }, fakeX('somebody_else', `Code ${a.code}`)))
      .rejects.toMatchObject({ code: 'X_WRONG_ACCOUNT' });
    const r1 = await verifyXSignIn(deps, { token: a.token, postUrl: `https://x.com/kacper_dev/status/${postId(t)}` }, fakeX('kacper_dev', `Code ${a.code}`));
    const [u] = await deps.db.select().from(users).where(eq(users.id, r1.userId));
    expect(u).toMatchObject({ username: 'kacper_dev', kind: 'human' });
    const b = await startXSignIn(deps, { handle: 'Kacper_Dev' });
    t += 60_000;
    const r2 = await verifyXSignIn(deps, { token: b.token, postUrl: `https://twitter.com/Kacper_Dev/status/${postId(t)}` }, fakeX('Kacper_Dev', `again ${b.code}`));
    expect(r2.userId).toBe(r1.userId);
    expect(await deps.db.select().from(userXHandles)).toHaveLength(1);
  });

  it('refuses a post without the code, a post older than the sign-in, a link that is not a post, and a used or unknown sign-in', async () => {
    const deps = await d();
    const s = await startXSignIn(deps, { handle: 'someone' });
    t += 30_000;
    const url = `https://x.com/someone/status/${postId(t)}`;
    await expect(verifyXSignIn(deps, { token: s.token, postUrl: url }, fakeX('someone', 'no code here'))).rejects.toMatchObject({ code: 'X_CODE_MISSING' });
    await expect(verifyXSignIn(deps, { token: s.token, postUrl: `https://x.com/someone/status/${postId(t - 3_600_000)}` }, fakeX('someone', s.code))).rejects.toMatchObject({ code: 'X_POST_TOO_OLD' });
    await expect(verifyXSignIn(deps, { token: s.token, postUrl: 'https://example.com/x' }, fakeX('someone', s.code))).rejects.toMatchObject({ code: 'X_POST_URL' });
    await verifyXSignIn(deps, { token: s.token, postUrl: url }, fakeX('someone', s.code));
    await expect(verifyXSignIn(deps, { token: s.token, postUrl: url }, fakeX('someone', s.code))).rejects.toMatchObject({ code: 'X_SIGNIN_EXPIRED' });
    await expect(startXSignIn(deps, { handle: 'other', token: s.token })).rejects.toMatchObject({ code: 'X_SIGNIN_EXPIRED' });
    await expect(verifyXSignIn(deps, { token: 'nope', postUrl: url }, fakeX('someone', s.code))).rejects.toMatchObject({ code: 'X_SIGNIN_EXPIRED' });
  });
});
