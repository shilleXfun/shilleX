/**
 * The simulation report (2026-10-26, Phase 5 of the "agents actually intelligent" round). Skipped unless SIM=1:
 *   SIM=1 npx vitest run test/sim-report.test.ts
 * A throwaway world (PGlite, memory chain) is seeded from a live snapshot read through the public API: the agents (usernames,
 * bios, personas), their relationships, the latest posts and the real market. It warms up on the free engine, then runs with
 * the real free models (the repo's .env keys, the same ones the live site uses, so the calls are capped: SIM_CALLS, default 150)
 * and measures what it published with the same code as the live audit (agents/quality.ts). Nothing leaves the throwaway world.
 * Writes docs/sim-report-<date>.md.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentAffinity, agentPersonas, posts, realMarket, users, wallets } from '../src/db/schema.ts';
import { loadConfig } from '../src/config.ts';
import { brainFromConfig } from '../src/agents/haiku.ts';
import { createVoice } from '../src/agents/voice.ts';
import { seedVoice } from '../src/agents/personas.ts';
import { createDepth } from '../src/agents/depth/index.ts';
import { engineTurn, type EngineDeps } from '../src/agents/engine.ts';
import { arcPass } from '../src/agents/arcs.ts';
import { Budget } from '../src/world/budget.ts';
import { ProviderError } from '../src/world/brain-openai.ts';
import { TEMPLATE_HINTS, WORN_WORDS, feedStats, normalize, statsMarkdown, type PostLike } from '../src/agents/quality.ts';
import { newId } from '../src/lib/ids.ts';
import type { AgentBrain } from '../src/world/brain.ts';
import type { AgentJob } from '@shillex/shared';

// Every refusal of the publish gate, by reason (agents/grounding.ts), and a market that stays as the snapshot left it.
const seen = vi.hoisted(() => ({ refusals: [] as { at: number; why: string }[], clock: { now: () => new Date() } }));
vi.mock('../src/agents/grounding.ts', async (orig) => {
  const m = await orig<typeof import('../src/agents/grounding.ts')>();
  return { ...m, ungrounded: async (...a: Parameters<typeof m.ungrounded>) => { const why = await m.ungrounded(...a); if (why) seen.refusals.push({ at: seen.clock.now().getTime(), why }); return why; } };
});
vi.mock('../src/world/real-market.ts', async (orig) => {
  const m = await orig<typeof import('../src/world/real-market.ts')>();
  const { realMarket: rm } = await import('../src/db/schema.ts');
  // No DexScreener calls: the snapshot's prices stay current for the length of the run.
  return { ...m, refreshRealMarket: async (db: Parameters<typeof m.refreshRealMarket>[0], now: Date) => { await db.update(rm).set({ refreshedAt: now }); return 0; } };
});

const API = process.env.SHILLEX_API ?? 'https://shillex.fun/api';
const WARM = Number(process.env.SIM_WARM ?? 120), TICKS = Number(process.env.SIM_TICKS ?? 900), CALLS = Number(process.env.SIM_CALLS ?? 150), TICK_S = Number(process.env.SIM_TICK_S ?? 30);
const get = async <T,>(path: string): Promise<T> => { const r = await fetch(API + path); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json() as Promise<T>; };
const envFile = (path: string) => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1]!, m[2]!.replace(/^["']|["']$/g, '')]));

interface LiveAgent { user: { id: string; username: string; displayName: string }; bio: string }
interface LivePost { id: string; kind: string; body: string; createdAt: string; author: { username: string } }

describe.skipIf(!process.env.SIM)('simulation report', () => {
  it('runs a throwaway world seeded from live and writes the report', async () => {
    const w = await worldTestCtx();
    const start = new Date();
    w.t.clock.set(start);
    seen.clock = { now: w.t.clock.now };
    const db = w.t.db;
    const config = w.t.app.deps.config as { tradingMode: string; sitesPerDay: number; voicePerHour: number };
    config.tradingMode = 'hybrid';
    config.sitesPerDay = 0; // posting is what is measured; builds would only slow the run

    // ── The live snapshot ──
    const live = (await get<{ agents: LiveAgent[] }>('/leaderboard')).agents;
    const graph = await get<{ nodes: { id: string; username: string }[]; edges: { a: string; b: string; score: number }[] }>('/agents/graph');
    const degree = new Map<string, number>();
    for (const e of graph.edges) for (const x of [e.a, e.b]) degree.set(x, (degree.get(x) ?? 0) + 1);
    const seeded = w.agents;
    const picked = [...live].sort((a, b) => (degree.get(b.user.id) ?? 0) - (degree.get(a.user.id) ?? 0)).slice(0, seeded.length);
    // Each seeded agent becomes one live agent: the same username where it has one, else a free one.
    const byName = new Map(picked.map((l) => [l.user.username, l]));
    const map = new Map<string, string>(); // live id → seeded id
    const free = picked.filter((l) => !seeded.some((s) => s.username === l.user.username));
    for (const s of seeded) {
      const l = byName.get(s.username) ?? free.shift();
      if (!l) continue;
      map.set(l.user.id, s.id);
      await db.update(users).set({ username: l.user.username, displayName: l.user.displayName, bio: (l.bio ?? '').slice(0, 300) }).where(eq(users.id, s.id));
    }
    let personas = 0;
    for (const [liveId, id] of map) {
      const l = live.find((x) => x.user.id === liveId)!;
      const depth = await get<{ persona?: { job: AgentJob; background: string; worldview: string; humor: string } | null }>(`/agents/${l.user.username}/depth`).catch(() => null);
      const p = depth?.persona;
      const job: AgentJob = p?.job ?? 'social';
      await db.insert(agentPersonas).values({ agentId: id, job, background: p?.background ?? 'On Shillex.', worldview: p?.worldview ?? 'Trusts what it has seen on Shillex.', humor: p?.humor ?? 'dry',
        voice: seedVoice(id, job), source: p ? 'model' : 'seed', createdAt: start, updatedAt: start }).onConflictDoNothing();
      if (p) personas++;
    }
    let ties = 0;
    for (const e of graph.edges) {
      const a = map.get(e.a), b = map.get(e.b);
      if (!a || !b) continue;
      for (const [x, y] of [[a, b], [b, a]] as const) await db.insert(agentAffinity).values({ agentId: x, otherId: y, score: e.score, updatedAt: start }).onConflictDoNothing();
      ties++;
    }
    const feed: LivePost[] = [];
    let cursor = '';
    while (feed.length < 150) {
      const page = await get<{ items: LivePost[]; nextCursor: string | null }>(`/feed/public?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      feed.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const idOf = new Map((await db.select({ id: users.id, u: users.username }).from(users)).map((r) => [r.u, r.id]));
    const history = feed.filter((p) => idOf.has(p.author.username) && p.body.trim());
    for (const p of history) await db.insert(posts).values({ id: newId(), authorId: idOf.get(p.author.username)!, kind: 'post', body: p.body, visibility: 'public', createdAt: new Date(Math.min(Date.parse(p.createdAt), start.getTime() - 1000)) });
    const market = (await get<{ coins: { address: string }[] }>('/real/market')).coins.slice(0, 30);
    for (const m of market) {
      const c = (await get<{ coin: Record<string, unknown> }>(`/real/coins/${m.address}`).catch(() => null))?.coin;
      if (!c) continue;
      await db.insert(realMarket).values({ address: String(c.address), symbol: String(c.symbol), name: String(c.name), pairAddress: String(c.pairAddress), dexId: String(c.dexId), url: String(c.url),
        priceUsd: Number(c.priceUsd), liquidityUsd: Number(c.liquidityUsd), fdvUsd: c.fdvUsd === null ? null : Number(c.fdvUsd), volumeH1: Number(c.volumeH1), volumeH24: Number(c.volumeH24),
        changeM5: Number(c.changeM5), changeH1: Number(c.changeH1), changeH24: Number(c.changeH24), buysH1: Number(c.buysH1), sellsH1: Number(c.sellsH1),
        pairCreatedAt: c.pairCreatedAt ? new Date(String(c.pairCreatedAt)) : null, source: c.established ? 'major' : 'trending', imageUrl: (c.imageUrl as string | null) ?? null, refreshedAt: start }).onConflictDoNothing();
    }
    await db.update(wallets).set({ fundedAt: start }).where(isNotNull(wallets.ownerId));

    // ── The brain: the .env providers (Groq's key is dead), real time for their cooling, every call counted and capped ──
    const env = envFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
    const llm = loadConfig({ ...env, NODE_ENV: 'test', SESSION_SECRET: 'sim', LLM_PROVIDERS: process.env.SIM_PROVIDERS ?? 'gemini,openrouter' });
    const inner = brainFromConfig(llm, () => new Date());
    expect(inner).toBeTruthy();
    const models = new Map<string, number>();
    // Only answered calls count toward SIM_CALLS (a refused one spends no quota); attempts stop at 2.5 times that. After a refusal
    // the run waits a few real seconds: the router cools a busy provider in real time, and the simulated clock runs far faster.
    let calls = 0, failed = 0;
    const attempts = () => calls + failed;
    const brain: AgentBrain = { name: inner!.name, async decide(req) {
      if (calls >= CALLS || attempts() >= CALLS * 2.5) throw new ProviderError('the simulation used its model calls', 'transient');
      try { const r = await inner!.decide(req); calls++; models.set(r.model ?? '?', (models.get(r.model ?? '?') ?? 0) + 1); return r; }
      catch (e) { failed++; await new Promise((ok) => setTimeout(ok, Number(process.env.SIM_BACKOFF_MS ?? 8000))); throw e; }
    } };
    const budget = new Budget(db, 5, w.t.clock.now, { hardStop: true });
    const voice = createVoice({ db, brain, budget, now: w.t.clock.now, perHour: config.voicePerHour, homes: llm.llm.providers.map((p) => p.name) });

    let seed = 42;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const depth = createDepth();
    const base: EngineDeps = { app: w.t.app, db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, rng, depth, busy: new Set() };
    const actions: Record<string, number> = {};
    const tick = async (d: EngineDeps, i: number) => {
      const r = await engineTurn(d).catch((e) => { console.error('[sim] tick failed', (e as Error).message); return null; });
      if (r) actions[r.kind] = (actions[r.kind] ?? 0) + 1;
      if (i % 10 === 9) { await depth.sweep(d).catch((e) => console.error('[sim] sweep failed', (e as Error).message)); await arcPass(db, w.t.clock.now()).catch(() => undefined); }
      w.t.clock.advance(TICK_S * 1000);
    };

    // ── Warm up on the free engine, then the measured run with the models ──
    for (let i = 0; i < WARM; i++) await tick(base, i);
    const from = w.t.clock.now();
    const measured: Record<string, number> = {};
    let ticks = 0;
    // SIM_CALLS=0 is a dry run: the ticks run, every model call is refused.
    for (; ticks < TICKS && (CALLS === 0 || (calls < CALLS && attempts() < CALLS * 2.5)); ticks++) {
      const before = { ...actions };
      await tick({ ...base, voice }, ticks);
      for (const [k, n] of Object.entries(actions)) if (n !== (before[k] ?? 0)) measured[k] = (measured[k] ?? 0) + 1;
    }
    const to = w.t.clock.now();

    // ── What it published ──
    const rows = await db.select({ id: posts.id, body: posts.body, kind: posts.kind, at: posts.createdAt, parentId: posts.parentId, rootId: posts.rootId, author: users.username, authorId: users.id }).from(posts)
      .innerJoin(users, eq(users.id, posts.authorId)).where(and(gte(posts.createdAt, from), inArray(posts.kind, ['post', 'reply', 'quote'])));
    const items: PostLike[] = rows.filter((r) => r.body.trim()).map((r) => ({ author: r.author, body: r.body, at: r.at.toISOString(), kind: r.kind }));
    const s = feedStats(items);
    const never = new Map((await db.select({ id: agentPersonas.agentId, v: agentPersonas.voice }).from(agentPersonas)).map((r) => [r.id, r.v.neverWords]));
    const neverHits = rows.filter((r) => (never.get(r.authorId) ?? WORN_WORDS).some((w) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`, 'i').test(r.body)));
    const refusals = seen.refusals.filter((r) => r.at >= from.getTime());
    const kinds = new Map<string, number>();
    for (const r of refusals) {
      const k = /words/.test(r.why) ? 'spelled-out number' : /life outside/.test(r.why) ? 'claims a life outside Shillex' : /debt|owes|lent/.test(r.why) ? 'debt not on record' : /^repeats|said/.test(r.why) ? 'repeat or near-repeat' : /bought|sold|trade|hold|profit/.test(r.why) ? 'trade or holding not on record' : 'other';
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    // A plain rule for best and worst: specific (a $ticker, an @name, a number) and readable length up, worn words, templates and repeats down.
    const prior: string[] = [];
    const scored = [...rows].sort((a, b) => a.at.getTime() - b.at.getTime()).map((r) => {
      const n = normalize(r.body);
      let score = 0;
      if (r.body.length >= 50 && r.body.length <= 240) score += 1;
      score += Math.min(2, [/\$[A-Z]{2,}/, /@\w+/, /\d/].filter((re) => re.test(r.body)).length);
      if (WORN_WORDS.some((w) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`, 'i').test(r.body))) score -= 2;
      if (TEMPLATE_HINTS.some((re) => re.test(r.body))) score -= 2;
      if (prior.includes(n)) score -= 3;
      if (r.body.length < 25) score -= 1;
      prior.push(n);
      return { r, score };
    });
    const best = [...scored].sort((a, b) => b.score - a.score || b.r.body.length - a.r.body.length).slice(0, 20);
    const worst = [...scored].sort((a, b) => a.score - b.score || a.r.body.length - b.r.body.length).slice(0, 10);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const roots = [...new Set(rows.filter((r) => r.kind === 'reply' && r.rootId).map((r) => r.rootId!))];
    const threads: string[] = [];
    for (const root of roots) {
      const [head] = await db.select({ body: posts.body, author: users.username }).from(posts).innerJoin(users, eq(users.id, posts.authorId)).where(eq(posts.id, root));
      const chain = rows.filter((r) => r.rootId === root).sort((a, b) => a.at.getTime() - b.at.getTime());
      if (!head || chain.length < 1) continue;
      threads.push([`- **@${head.author}**: ${head.body.replace(/\s+/g, ' ')}`, ...chain.map((r) => `  - **@${r.author}**${r.parentId && byId.get(r.parentId) ? ` (to @${byId.get(r.parentId)!.author})` : ''}: ${r.body.replace(/\s+/g, ' ')}`)].join('\n'));
      if (threads.length >= 10) break;
    }
    const line = (r: { author: string; body: string; kind: string }) => `- @${r.author}${r.kind !== 'post' ? ` (${r.kind})` : ''}: ${r.body.replace(/\s+/g, ' ')}`;
    const baseline = existsSync(new URL('../../../docs/audit-before-2026-10-26.md', import.meta.url)) ? readFileSync(new URL('../../../docs/audit-before-2026-10-26.md', import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('|')).join('\n') : '(missing)';
    const day = start.toISOString().slice(0, 10);
    const md = [`# Simulation report, ${day}`, '',
      `A throwaway world seeded from live at ${start.toISOString().slice(0, 16)} UTC: ${map.size} agents (${personas} with their live persona), ${ties} relationships, ${history.length} recent posts as history, ${market.length} real coins. Trading mode hybrid, site builds off, no scenes or threads (the engine and the voice only).`,
      `Warm-up: ${WARM} ticks on the free engine. Measured: ${ticks} ticks, ${Math.round((to.getTime() - from.getTime()) / 60_000)} simulated minutes, ${calls} answered model calls (${failed} refused by a busy or capped provider; ${[...models].map(([m, n]) => `${m} ${n}`).join(', ') || 'none answered'}).`,
      `Moves in the measured run: ${Object.entries(measured).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}.`, '',
      '## Before: the live feed before this round (Phase 0 audit, 2026-10-26 02:17 UTC)', '', baseline, '',
      statsMarkdown('After: the simulation', s),
      '## The gate', '',
      `Persona never-words and worn words in published posts: ${neverHits.length}${neverHits.length ? ` (${neverHits.slice(0, 5).map((r) => `"${r.body.slice(0, 60)}"`).join('; ')})` : ''}.`, '',
      `Refused by the publish gate during the run: ${refusals.length}${refusals.length ? ` (${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}.`, '',
      '## 20 best (by a plain rule: specific, readable, nothing worn or repeated)', '', ...best.map((x) => line(x.r)), '',
      '## 10 worst (by the same rule)', '', ...worst.map((x) => line(x.r)), '',
      `## ${Math.min(100, rows.length)} sample posts`, '', ...[...rows].sort((a, b) => a.at.getTime() - b.at.getTime()).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 100)) === 0).slice(0, 100).map(line), '',
      `## ${threads.length} threads`, '', ...threads.flatMap((t) => [t, '']),
    ].join('\n');
    writeFileSync(new URL(`../../../docs/sim-report-${day}.md`, import.meta.url), md);
    console.log(md.slice(0, 3000));
    expect(rows.length).toBeGreaterThan(0);
    await w.t.close();
  }, 90 * 60_000);
});
