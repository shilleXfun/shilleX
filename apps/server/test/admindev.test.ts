import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { runTool } from '../src/world/tools.ts';
import { Indexer } from '../src/world/indexer.ts';
import { Budget } from '../src/world/budget.ts';
import { registerDepthRoutes } from '../src/routes/depth.ts';
import { registerAdminDevRoutes } from '../src/routes/admindev.ts';
import type { WorldHandles } from '../src/world/boot.ts';
import { agents as agentsTable, wallets } from '../src/db/schema.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let handles: WorldHandles;
let cookie = '';

const login = (password: string, remoteAddress = '127.0.0.1') => w.t.app.inject({ method: 'POST', url: '/api/admindev/login', payload: { password }, remoteAddress });
const call = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>, withCookie = true) =>
  w.t.app.inject({ method, url, ...(payload ? { payload } : {}), headers: withCookie ? { cookie } : {} });
const state = async () => { const r = await call('GET', '/api/admindev/state'); expect(r.statusCode).toBe(200); return r.json(); };

beforeAll(async () => {
  w = await worldTestCtx();
  const indexer = new Indexer(w.t.db, w.chain, w.t.clock.now, { balanceTtlMs: 0 });
  handles = { indexer, budget: new Budget(w.t.db, 1, w.t.clock.now), chain: w.chain, key: w.key, engine: null, moments: null, network: 'memory', startAgents: () => 'AGENTS is off' };
  await registerDepthRoutes(w.t.app, { indexer });
  await registerAdminDevRoutes(w.t.app, handles);
  const [a, b] = w.agents;
  await runTool(await w.ctxFor(a!), 'post', { body: 'gm watchers' });
  const launched = await runTool(await w.ctxFor(b!), 'launch_coin', { name: 'Dev', symbol: 'DEVC', description: 'x', emoji: '🛠', initial_buy_sol: 0.02 });
  await runTool(await w.ctxFor(b!), 'sell', { mint: (launched.result as { mint: string }).mint, tokens: null, all: true, slippage_pct: null });
});
afterAll(() => w.t.close());

describe('admindev config', () => {
  it('defaults the password to 12345 outside production only, and reads ADMIN_DEV_PASSWORD everywhere', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).adminDevPassword).toBe('12345');
    expect(loadConfig({ NODE_ENV: 'test' }).adminDevPassword).toBe('12345');
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret' }).adminDevPassword).toBeNull();
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret', ADMIN_DEV_PASSWORD: 'hunter22' }).adminDevPassword).toBe('hunter22');
  });
});

describe('admindev routes', () => {
  it('rejects a wrong password with 401 BAD_PASSWORD', async () => {
    const r = await login('nope');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ code: 'BAD_PASSWORD' });
    expect(r.cookies.find((c) => c.name === 'admindev')).toBeUndefined();
  });

  it('accepts the password with 204 and a signed, httpOnly, strict cookie scoped to /api/admindev', async () => {
    const r = await login('12345');
    expect(r.statusCode).toBe(204);
    const c = r.cookies.find((x) => x.name === 'admindev')!;
    expect(c).toBeDefined();
    expect(c.value).not.toBe('1');
    expect(w.t.app.unsignCookie(c.value)).toMatchObject({ valid: true, value: '1' });
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/admindev', maxAge: 8 * 3600 });
    cookie = `admindev=${c.value}`;
  });

  it('serves the state only with the signed cookie', async () => {
    expect((await call('GET', '/api/admindev/state', undefined, false)).statusCode).toBe(401);
    expect((await w.t.app.inject({ method: 'GET', url: '/api/admindev/state', headers: { cookie: 'admindev=1' } })).statusCode).toBe(401);
    const s = await state();
    expect(Object.keys(s).sort()).toEqual(['agents', 'budgets', 'today', 'turns', 'weather', 'world']);
    expect(s.world).toEqual({ network: 'memory', agents: 50, runtime: 'off', engine: null, queue: 0, halted: null });
    expect(s.budgets).toEqual({ model: { spentUsd: 0, capUsd: 1, level: 'normal' }, images: { spentUsd: 0, capUsd: 0.5, countToday: 0, maxPerDay: 15 } });
    expect(s.weather.regime).toMatch(/^(euphoria|grind|fear|chaos)$/);
    expect(s.today).toMatchObject({ posts: 1, launches: 1, rugs: 1, images: 0 });
    expect(s.today.trades).toBeGreaterThanOrEqual(1);
    expect(s.today.turns.running).toBeGreaterThanOrEqual(3);
    expect(s.agents).toHaveLength(50);
    expect(s.agents[0]).toHaveProperty('mood');
    const pnl = s.agents.map((a: { pnlSol: number }) => a.pnlSol);
    expect(pnl).toEqual([...pnl].sort((x, y) => y - x));
    expect(s.turns.length).toBeGreaterThan(0);
    expect(s.turns.length).toBeLessThanOrEqual(25);
    expect(s.turns[0]).toHaveProperty('agent.username');
    expect(s.turns[0]).toHaveProperty('toolCalls');
  });

  it('never shows a wallet secret', async () => {
    const raw = (await call('GET', '/api/admindev/state')).body;
    for (const row of await w.t.db.select().from(wallets)) expect(raw.includes(row.encryptedSecret)).toBe(false);
  });

  it('pauses and resumes one agent, and all of them', async () => {
    const name = w.agents[3]!.username;
    const statusOf = async () => (await state()).agents.find((a: { user: { username: string } }) => a.user.username === name).status;
    expect((await call('POST', `/api/admindev/agents/${name}/pause`, undefined, false)).statusCode).toBe(401);
    expect((await call('POST', `/api/admindev/agents/${name}/pause`)).statusCode).toBe(204);
    expect(await statusOf()).toBe('paused');
    expect((await call('POST', `/api/admindev/agents/${name}/resume`)).statusCode).toBe(204);
    expect(await statusOf()).toBe('active');
    expect((await call('POST', '/api/admindev/agents/nobody_here/pause')).statusCode).toBe(404);
    expect((await call('POST', '/api/admindev/pause-all')).statusCode).toBe(204);
    expect(new Set((await w.t.db.select({ s: agentsTable.status }).from(agentsTable)).map((x) => x.s))).toEqual(new Set(['paused']));
    expect((await call('POST', '/api/admindev/resume-all')).statusCode).toBe(204);
    expect(await w.t.db.select().from(agentsTable).where(eq(agentsTable.status, 'paused'))).toHaveLength(0);
  });

  it('switches the weather now for an hour, and rejects unknown regimes', async () => {
    expect((await call('POST', '/api/admindev/weather', { regime: 'fear' }, false)).statusCode).toBe(401);
    const before = (await w.t.app.inject({ method: 'GET', url: '/api/weather' })).json();
    const next = before.regime === 'fear' ? 'chaos' : 'fear';
    expect((await call('POST', '/api/admindev/weather', { regime: next })).statusCode).toBe(204);
    const after = (await w.t.app.inject({ method: 'GET', url: '/api/weather' })).json();
    expect(after).toEqual({ regime: next, startedAt: w.t.clock.now().toISOString(), endsAt: new Date(w.t.clock.now().getTime() + 3600_000).toISOString() });
    expect((await state()).weather.regime).toBe(next);
    expect((await call('POST', '/api/admindev/weather', { regime: 'fear' })).statusCode).toBe(204);
    expect((await w.t.app.inject({ method: 'GET', url: '/api/weather' })).json().regime).toBe('fear');
    expect((await call('POST', '/api/admindev/weather', { regime: 'storm' })).statusCode).toBe(400);
    expect((await w.t.app.inject({ method: 'GET', url: '/api/weather' })).json().regime).toBe('fear');
  });

  it("publishes today's paper (locally without the model), once", async () => {
    expect((await call('POST', '/api/admindev/paper', undefined, false)).statusCode).toBe(401);
    expect((await call('POST', '/api/admindev/paper')).statusCode).toBe(202);
    const day = w.t.clock.now().toISOString().slice(0, 10);
    const p = await w.t.app.inject({ method: 'GET', url: `/api/papers/${day}` });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ day, source: 'local' });
    expect((await call('POST', '/api/admindev/paper')).statusCode).toBe(409);
  });

  it('logs out by clearing the cookie', async () => {
    const r = await call('POST', '/api/admindev/logout');
    expect(r.statusCode).toBe(204);
    const c = r.cookies.find((x) => x.name === 'admindev')!;
    expect(c).toMatchObject({ value: '', path: '/api/admindev' });
  });

  it('allows 5 login attempts a minute per IP; the 6th is 429 even with the right password', async () => {
    for (let i = 0; i < 5; i++) expect((await login('wrong', '10.0.0.9')).statusCode).toBe(401);
    expect((await login('12345', '10.0.0.9')).statusCode).toBe(429);
    expect((await login('12345', '10.0.0.10')).statusCode).toBe(204);
  });
});

describe('admindev in production without ADMIN_DEV_PASSWORD', () => {
  it('answers 404 on every route', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-secret-for-tests' }) });
    await registerAdminDevRoutes(t.app, { ...handles, indexer: new Indexer(t.db, w.chain, t.clock.now) });
    expect((await t.app.inject({ method: 'POST', url: '/api/admindev/login', payload: { password: '12345' } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/admindev/state' })).statusCode).toBe(404);
    await t.close();
  });
});
