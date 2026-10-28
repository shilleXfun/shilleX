import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, testDb } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents } from '../src/world/boot.ts';
import { agentDayMarks, agentRules, agentTurns, users } from '../src/db/schema.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { createWallet } from '../src/world/wallets.ts';
import { effectiveRules, hardLimitRefusal, lossBreakCheck, nextUtcMidnight } from '../src/agents/external/limits-hard.ts';

/** Hard limits (2026-10-28 brief §2): the owner sets them, the server enforces them on every act, whatever the agent wants. */
const now = new Date('2026-10-28T15:30:00Z');
const free = { pausedUntil: null, pausedReason: null, now };

describe('hardLimitRefusal', () => {
  it('refuses a buy a hair over the per-trade cap', () => {
    expect(hardLimitRefusal({ maxSolPerTrade: 0.1 }, { kind: 'buy', sol: 0.1000001 }, free)?.code).toBe('OVER_TRADE_LIMIT');
    expect(hardLimitRefusal({ maxSolPerTrade: 0.1 }, { kind: 'buy', sol: 0.1 }, free)).toBeNull();
  });
  it('trading off stops buys and sells; launching off stops launches; posts are never limited', () => {
    expect(hardLimitRefusal({ tradingOn: false }, { kind: 'buy', sol: 0.01 }, free)?.code).toBe('TRADING_OFF');
    expect(hardLimitRefusal({ tradingOn: false }, { kind: 'sell' }, free)?.code).toBe('TRADING_OFF');
    expect(hardLimitRefusal({ launchingOn: false }, { kind: 'launch', sol: 0 }, free)?.code).toBe('LAUNCHING_OFF');
    expect(hardLimitRefusal({ launchingOn: true, maxSolPerTrade: 0.05 }, { kind: 'launch', sol: 0.06 }, free)?.code).toBe('OVER_TRADE_LIMIT');
    expect(hardLimitRefusal({ tradingOn: false, launchingOn: false }, { kind: 'post' }, free)).toBeNull();
  });
  it('a loss break stops buys and launches until it ends, never sells', () => {
    const paused = { pausedUntil: nextUtcMidnight(now), pausedReason: 'down 21% today', now };
    expect(hardLimitRefusal({}, { kind: 'buy', sol: 0.01 }, paused)?.code).toBe('LOSS_BREAK');
    expect(hardLimitRefusal({ launchingOn: true }, { kind: 'launch', sol: 0 }, paused)?.code).toBe('LOSS_BREAK');
    expect(hardLimitRefusal({}, { kind: 'sell' }, paused)).toBeNull();
    expect(hardLimitRefusal({}, { kind: 'buy', sol: 0.01 }, { ...paused, now: new Date('2026-10-29T00:00:01Z') })).toBeNull();
  });
  it('outside agents start with launching off; mainnet adds 0.1 SOL a trade and a 20% daily break', () => {
    expect(effectiveRules(null, { origin: 'external', network: 'devnet' })).toEqual({ launchingOn: false });
    expect(effectiveRules({ launchingOn: true }, { origin: 'external', network: 'mainnet' })).toEqual({ launchingOn: true, maxSolPerTrade: 0.1, dailyLossBreakPct: 0.2 });
    expect(effectiveRules({ maxSolPerTrade: 0.5 }, { origin: 'external', network: 'mainnet' }).maxSolPerTrade).toBe(0.5);
  });
});

describe('the daily loss break', () => {
  it('pauses until the next UTC midnight once the wallet is down the owner’s percent from the day’s start', async () => {
    const { db } = await testDb();
    const chain = new MemoryChain();
    await db.insert(users).values({ id: 'a1', username: 'mossbyte', displayName: 'Moss', kind: 'agent', createdAt: now });
    chain.airdrop(await createWallet(db, 'a1', Buffer.alloc(32, 3), now), 790_000_000);
    await db.insert(agentDayMarks).values({ agentId: 'a1', day: '2026-10-28', startLamports: 1_000_000_000 });
    expect(await lossBreakCheck(db, chain, 'a1', { dailyLossBreakPct: 0.25 }, now)).toBeNull();
    const p = await lossBreakCheck(db, chain, 'a1', { dailyLossBreakPct: 0.2 }, now);
    expect(p?.until.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    const [row] = await db.select().from(agentRules).where(eq(agentRules.agentId, 'a1'));
    expect(row?.pausedUntil?.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(row?.pausedReason).toMatch(/21%/);
  });
});

describe('through the API', () => {
  it('refuses a buy over the owner’s cap with 403 and opens no turn', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }) });
    const world = await bootAgents(t.app, {});
    const inj = async (method: 'GET' | 'POST' | 'PUT', url: string, o: { body?: unknown; key?: string; cookie?: string } = {}) => {
      const r = await t.app.inject({ method, url, payload: o.body as never, headers: { ...(o.key ? { authorization: `Bearer ${o.key}` } : {}), ...(o.cookie ? { cookie: o.cookie } : {}) } });
      return { status: r.statusCode, body: r.json() as Record<string, any> };
    };
    const s = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'ownertwo', displayName: 'Owner', password: 'password-123' } });
    const cookie = String(s.headers['set-cookie']).split(';')[0]!;
    const key = (await inj('GET', '/api/owner', { cookie })).body.linkKey.key;
    const reg = await inj('POST', '/api/v1/agents/register', { body: { handle: 'capbot', name: 'Cap', link_key: key } });
    const set = await inj('PUT', '/api/owner/agents/capbot/settings', { cookie, body: { mind: { risk: 2 }, limits: { maxSolPerTrade: 0.01, tradingOn: true } } });
    expect(set.status).toBe(200);
    const me = await inj('GET', '/api/v1/agent/me', { key: reg.body.api_key });
    expect(me.body.mind.risk).toEqual({ value: 2, line: 'risk 2/10: you play it safe and size small' });
    expect(me.body.limits).toMatchObject({ trading_on: true, launching_on: false, max_sol_per_trade: 0.01 });
    const turns = async () => (await t.db.select().from(agentTurns).where(eq(agentTurns.agentId, reg.body.agent.id))).length;
    const before = await turns();
    const buy = await inj('POST', '/api/v1/agent/buy', { key: reg.body.api_key, body: { mint: 'anything', sol: 0.02 } });
    expect([buy.status, buy.body.code]).toEqual([403, 'OVER_TRADE_LIMIT']);
    expect(await turns()).toBe(before);
    // Only the owner may change the settings.
    const other = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'stranger', displayName: 'S', password: 'password-123' } });
    const strangerCookie = String(other.headers['set-cookie']).split(';')[0]!;
    expect((await inj('PUT', '/api/owner/agents/capbot/settings', { cookie: strangerCookie, body: { limits: { maxSolPerTrade: 5 } } })).status).toBe(403);
    await world.stop();
  }, 60_000);
});
