import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { testWallet, walletAccount } from './wallet-helpers.ts';
import { users } from '../src/db/schema.ts';
import { passwordMatches } from '../src/services/passwords.ts';

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());
const signup = (b: object) => ctx.as(null).post('/api/auth/signup', { displayName: 'Ape', password: 'long-enough-1', ...b });
const login = (username: string, password = 'long-enough-1') => ctx.as(null).post('/api/auth/login', { username, password });

describe('email sign-in', () => {
  it('signs up with an email, stored lowercased and never shown back', async () => {
    const r = await signup({ username: 'mail_ape', email: '  Ape@Example.COM ' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain('example.com');
    const [u] = await ctx.db.select().from(users).where(eq(users.username, 'mail_ape'));
    expect(u!.email).toBe('ape@example.com');
  });

  it('a taken email in any case is EMAIL_TAKEN; a malformed one is a validation error', async () => {
    await signup({ username: 'first_mail', email: 'same@example.com' });
    const again = await signup({ username: 'second_mail', email: 'SAME@example.com' });
    expect([again.status, again.body.code]).toEqual([409, 'EMAIL_TAKEN']);
    expect((await signup({ username: 'bad_mail', email: 'not-an-email' })).body.code).toBe('VALIDATION');
  });

  it('logs in by email in any case, and still by username (Review Focus 4)', async () => {
    await signup({ username: 'case_ape', email: 'Case@Example.com' });
    expect((await login('case@example.com')).status).toBe(200);
    expect((await login('CASE@EXAMPLE.COM')).body.user.username).toBe('case_ape');
    expect((await login('Case_Ape')).status).toBe(200);
  });

  it('gives the same 401 for a wrong password, no account, a wallet-only account and an agent (Review Focus 5)', async () => {
    await signup({ username: 'pw_ape', email: 'pw@example.com' });
    await walletAccount(ctx, testWallet(), 'wallet_only');
    await ctx.db.insert(users).values({ id: 'agent_x', username: 'agent_x', displayName: 'x', createdAt: ctx.clock.now(), kind: 'agent', passwordHash: await hash('long-enough-1') });
    for (const r of [await login('pw@example.com', 'wrong-password'), await login('nobody@example.com'), await login('nobody_here'), await login('wallet_only'), await login('agent_x')]) {
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Wrong username, email or password' });
    }
  });

  it('passwordMatches never matches a missing hash', async () => {
    expect(await passwordMatches({ passwordHash: null }, 'anything')).toBe(false);
    expect(await passwordMatches({ passwordHash: await hash('right-one') }, 'right-one')).toBe(true);
  });
});
