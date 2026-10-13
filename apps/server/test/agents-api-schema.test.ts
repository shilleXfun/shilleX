import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { agentApiKeys, agentClaims, agents, externalRegistrations, users } from '../src/db/schema.ts';

let h: Awaited<ReturnType<typeof testDb>> | null = null;
afterEach(async () => { await h?.close(); h = null; });

const at = new Date('2026-10-13T00:00:00Z');
async function agent(db: NonNullable<typeof h>['db'], id: string) {
  await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: at });
  await db.insert(agents).values({ userId: id, status: 'paused', origin: 'external', createdAt: at });
}

describe('open agents schema', () => {
  it('adds the key, registration and claim tables', async () => {
    h = await testDb();
    const t: any = await h.db.execute(sql`select table_name from information_schema.tables where table_name in ('agent_api_keys', 'external_registrations', 'agent_claims') order by 1`);
    expect((t.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual(['agent_api_keys', 'agent_claims', 'external_registrations']);
  });

  it('stores an outside agent with its key hash and its registration, and deleting the user removes both', async () => {
    h = await testDb();
    await agent(h.db, 'ext_a');
    await h.db.insert(agentApiKeys).values({ id: 'a'.repeat(64), agentId: 'ext_a', createdAt: at, label: 'laptop' });
    await h.db.insert(externalRegistrations).values({ agentId: 'ext_a', claimCode: 'ABCDEFGHJKLM', claimTokenHash: 'e'.repeat(64), ipHash: 'f'.repeat(64), createdAt: at, expiresAt: new Date(at.getTime() + 86_400_000), status: 'pending' });
    await h.db.delete(users).where(sql`${users.id} = 'ext_a'`);
    expect(await h.db.select().from(agentApiKeys)).toHaveLength(0);
    expect(await h.db.select().from(externalRegistrations)).toHaveLength(0);
  });

  it('refuses a second registration with the same claim code', async () => {
    h = await testDb();
    await agent(h.db, 'ext_a');
    await agent(h.db, 'ext_b');
    const row = (agentId: string) => ({ agentId, claimCode: 'ABCDEFGHJKLM', claimTokenHash: `t-${agentId}`, ipHash: 'f'.repeat(64), createdAt: at, expiresAt: at, status: 'pending' as const });
    await h.db.insert(externalRegistrations).values(row('ext_a'));
    await expect(h.db.insert(externalRegistrations).values(row('ext_b'))).rejects.toThrow();
  });

  it('refuses a second live claim on the same X handle or the same wallet', async () => {
    h = await testDb();
    for (const id of ['ext_a', 'ext_b', 'ext_c', 'ext_d']) await agent(h.db, id);
    await h.db.insert(agentClaims).values({ agentId: 'ext_a', method: 'x', xHandle: 'someone', claimedAt: at });
    await expect(h.db.insert(agentClaims).values({ agentId: 'ext_b', method: 'x', xHandle: 'someone', claimedAt: at })).rejects.toThrow();
    await h.db.insert(agentClaims).values({ agentId: 'ext_c', method: 'wallet', wallet: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', claimedAt: at });
    await expect(h.db.insert(agentClaims).values({ agentId: 'ext_d', method: 'wallet', wallet: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', claimedAt: at })).rejects.toThrow();
  });

  it('lets a handle claim again once its old claim has ended (the bar is checked by the claim code, not the index)', async () => {
    h = await testDb();
    for (const id of ['ext_a', 'ext_b']) await agent(h.db, id);
    await h.db.insert(agentClaims).values({ agentId: 'ext_a', method: 'x', xHandle: 'someone', claimedAt: at, endedAt: at, barredUntil: new Date(at.getTime() + 30 * 86_400_000) });
    await h.db.insert(agentClaims).values({ agentId: 'ext_b', method: 'x', xHandle: 'someone', claimedAt: at });
    expect(await h.db.select().from(agentClaims)).toHaveLength(2);
  });
});

describe('open agents config', () => {
  it('is on by default, with the plan’s limits', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.external).toEqual({
      on: true, max: 50, walletClaims: 'approve', startLamports: 50_000_000, regPerIpDay: 5, readsPerMin: 60, actsPerMin: 10,
      oembedUrl: 'https://publish.twitter.com/oembed',
    });
  });

  it('parses overrides', () => {
    const c = loadConfig({
      NODE_ENV: 'test', EXTERNAL_AGENTS: 'on', EXTERNAL_AGENTS_MAX: '7', EXTERNAL_WALLET_CLAIMS: 'open', EXTERNAL_START_LAMPORTS: '1000',
      EXTERNAL_REGISTRATIONS_PER_IP_DAY: '2', EXTERNAL_KEY_READS_PER_MIN: '30', EXTERNAL_KEY_ACTS_PER_MIN: '3', X_OEMBED_URL: 'http://127.0.0.1:9/oembed',
    });
    expect(c.external).toEqual({ on: true, max: 7, walletClaims: 'open', startLamports: 1000, regPerIpDay: 2, readsPerMin: 30, actsPerMin: 3, oembedUrl: 'http://127.0.0.1:9/oembed' });
  });

  it.each([
    ['EXTERNAL_AGENTS', 'maybe'],
    ['EXTERNAL_WALLET_CLAIMS', 'sometimes'],
    ['EXTERNAL_AGENTS_MAX', '-1'],
    ['EXTERNAL_AGENTS_MAX', 'lots'],
    ['EXTERNAL_START_LAMPORTS', '0.5'],
    ['EXTERNAL_REGISTRATIONS_PER_IP_DAY', '0'],
    ['EXTERNAL_KEY_READS_PER_MIN', 'x'],
    ['EXTERNAL_KEY_ACTS_PER_MIN', 'none'],
    ['X_OEMBED_URL', 'not a url'],
    ['X_OEMBED_URL', 'ftp://example.com/oembed'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ NODE_ENV: 'test', [name]: value })).toThrow(new RegExp(name));
  });
});
