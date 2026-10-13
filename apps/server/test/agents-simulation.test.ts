import { describe, it, expect } from 'vitest';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { depthTestCtx } from './depth-helpers.ts';
import { engineTurn } from '../src/agents/engine.ts';
import { agentAffinity, agentEvents, agentState, agentTurns, chainTxs, factionMembers, factions, messages, posts, users, worldCoins } from '../src/db/schema.ts';
import { xEmbeds, xTopics } from '../src/db/schema.ts';

/**
 * The whole engine on a memory chain with a seeded rng: 50 agents, one turn per 4 s of injected time (the production tick's
 * average) and the depth sweep every 5 minutes. About 50-80 ms per tick (2.5-4 minutes for the default length), so it is opt-in:
 *   Git Bash:   cd apps/server && SIM=1 npx vitest run test/agents-simulation.test.ts --reporter=verbose
 *   PowerShell: cd apps/server; $env:SIM='1'; npx vitest run test/agents-simulation.test.ts --reporter=verbose
 * (--reporter=verbose prints the `[sim]` lines with every measured property.) SIM_TICKS changes the length (default 3000 = 3.3
 * simulated hours; the bounds are calibrated for that), SIM_SEED the rng seed (default 7).
 *
 * The seed fixes the engine's dice, not the whole world: agent ids, mints and keys are random per run, and they feed the agents'
 * traits and tastes. So the same seed is a fresh sample each time. Every bound below sits well outside the spread measured over
 * 19 complete runs on seeds 1-17 (the range is written beside each bound; a few also cover 7 earlier partial runs). A failure
 * names the property; the owning task is L2 (spread), L3 (tickers, launches), L4/L5 (pairs, factions), L6/L6b (texts, dry turns,
 * callbacks), L1 (P&L, mood) or L7 (names).
 */
const TICKS = Number(process.env.SIM_TICKS ?? 3000);
const SEED = Number(process.env.SIM_SEED ?? 7);
const TICK_MS = 4000, SWEEP_EVERY = 75, HOUR_MS = 3600_000;
const HOURS = (TICKS * TICK_MS) / HOUR_MS;

const quantile = (xs: number[], p: number) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : 0;

describe.runIf(process.env.SIM === '1')('simulation (SIM=1)', () => {
  it(`spreads trades, keeps tickers unique, sours and warms pairs, varies the lines and names the agents over ${TICKS} ticks (seed ${SEED})`, async () => {
    const started = Date.now();
    const ctx = await depthTestCtx(SEED);
    // SIM_X=1: a fake X stream (x-feed §8): three live topics and five shareable posts, renewed every simulated 3 hours.
    const seedX = async () => {
      if (process.env.SIM_X !== '1') return;
      const at = ctx.t.clock.now(), until = new Date(at.getTime() + 3 * HOUR_MS);
      await ctx.t.db.insert(xTopics).values(['solana etf filing', 'a new meme format', 'exchange outage'].map((label, i) => ({
        id: `simx-${at.getTime()}-${i}`, label, words: [['solana', 'filing'], ['meme', 'format'], ['outage', 'exchange']][i]!, avoidSymbols: ['SOL'], sentiment: [0.5, 0.2, -0.6][i]!, heat: [0.9, 0.6, 0.7][i]!,
        sourcePostIds: [`18000000000${at.getTime()}${i}`], sourceHandle: i === 1 ? null : 'lamp', createdAt: at, expiresAt: until })));
      await ctx.t.db.insert(xEmbeds).values(Array.from({ length: 5 }, (_, i) => ({ postId: `19000000000${at.getTime()}${i}`, handle: 'lamp', heat: 0.5 + i / 10, createdAt: at, expiresAt: until })));
    };
    await seedX();
    try {
      const kinds: Record<string, number> = {};
      let errored = 0;
      for (let i = 1; i <= TICKS; i++) {
        const r = await engineTurn(ctx.d);
        if (r) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
        if (r?.error) errored++;
        ctx.t.clock.advance(TICK_MS);
        if (i % SWEEP_EVERY === 0) await ctx.depth.sweep(ctx.d);
        if (i % Math.round((3 * HOUR_MS) / TICK_MS) === 0) await seedX();
      }
      const ran = Date.now() - started;
      const db = ctx.t.db;
      const agentIds = new Set(ctx.agents.map((a) => a.id));
      console.log('[sim] run: seed', SEED, 'ticks', TICKS, 'wall s', (ran / 1000).toFixed(0), 'ms/tick', (ran / TICKS).toFixed(0), 'errored turns', errored, 'kinds', JSON.stringify(kinds));
      expect.soft(errored / TICKS).toBeLessThanOrEqual(0.01); // measured 0

      // 1. Trading is spread across coins, not one coin at a time (finding 1).
      const buys = await db.select({ mint: chainTxs.mint, agentId: chainTxs.agentId, at: chainTxs.createdAt }).from(chainTxs).where(eq(chainTxs.kind, 'buy'));
      const perCoin = new Map<string, number>();
      for (const b of buys) perCoin.set(b.mint!, (perCoin.get(b.mint!) ?? 0) + 1);
      const top = Math.max(0, ...perCoin.values()) / buys.length;
      // The same share inside each simulated 50 minutes: one hot coin at a time would show here even if the whole run looks spread.
      const t0 = Math.min(...buys.map((b) => b.at.getTime())), WINDOW_MS = 50 * 60_000;
      const windows = new Map<number, Map<string, number>>();
      for (const b of buys) {
        const w = Math.floor((b.at.getTime() - t0) / WINDOW_MS);
        const m = windows.get(w) ?? new Map<string, number>();
        m.set(b.mint!, (m.get(b.mint!) ?? 0) + 1);
        windows.set(w, m);
      }
      const busy = [...windows.values()].filter((m) => [...m.values()].reduce((a, c) => a + c, 0) >= 30);
      const windowTops = busy.map((m) => Math.max(...m.values()) / [...m.values()].reduce((a, c) => a + c, 0));
      const buyers = new Set(buys.map((b) => b.agentId)).size;
      console.log('[sim] spread: buys', buys.length, 'buyers', buyers, 'coins bought', perCoin.size, 'top coin share', top.toFixed(2), 'top share per 50 min', windowTops.map((s) => s.toFixed(2)).join(' '));
      expect.soft(buys.length).toBeGreaterThan(250); // measured 372-599
      expect.soft(buyers).toBeGreaterThanOrEqual(ctx.agents.length * 0.8); // measured 50 of 50
      expect.soft(perCoin.size).toBeGreaterThanOrEqual(8); // measured 14-22
      expect.soft(top).toBeLessThanOrEqual(0.4); // measured 0.13-0.24
      expect.soft(windowTops.reduce((a, b) => a + b, 0) / windowTops.length).toBeLessThanOrEqual(0.7); // mean over the windows; measured 0.31-0.52 (a single window reached 0.83)

      // 2. No two coins share a ticker (finding 4); launches are not junk: few coins stay unheld, nobody launches twice inside a cooldown.
      const coins = await db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol, creatorId: worldCoins.creatorId }).from(worldCoins);
      const holders = await db.select({ mint: chainTxs.mint, agentId: chainTxs.agentId }).from(chainTxs).where(inArray(chainTxs.kind, ['buy', 'launch', 'sell']))
        .groupBy(chainTxs.mint, chainTxs.agentId).having(sql`sum(${chainTxs.tokenDelta}) > 0`);
      const held = new Map<string, number>();
      for (const h of holders) held.set(h.mint!, (held.get(h.mint!) ?? 0) + 1);
      const dead = coins.filter((c) => (held.get(c.mint) ?? 0) <= 1).length;
      const launches = new Map<string, number>();
      for (const c of coins) launches.set(c.creatorId, (launches.get(c.creatorId) ?? 0) + 1);
      console.log('[sim] coins:', coins.length, 'unique symbols', new Set(coins.map((c) => c.symbol.toUpperCase())).size, 'dead (<=1 holder)', dead, 'most launches by one agent', Math.max(0, ...launches.values()), '|', coins.map((c) => c.symbol).join(' '));
      expect.soft(coins.length).toBeGreaterThanOrEqual(8); // measured 15-23
      expect.soft(new Set(coins.map((c) => c.symbol.toUpperCase())).size).toBe(coins.length);
      expect.soft(dead / coins.length).toBeLessThanOrEqual(0.5); // measured 0-0.32 (coins launched in the last half hour count as unheld)
      expect.soft(Math.max(0, ...launches.values())).toBeLessThanOrEqual(Math.ceil(HOURS / 12)); // launch cooldown is 12 h; measured 1

      // 3. Feelings run both ways: some pairs are warm, some fall below the overview's feud line, and the deepest ones start feuds (finding 2).
      const pairs = new Map<string, [number, number]>();
      const rows = await db.select().from(agentAffinity);
      for (const r of rows) {
        if (!agentIds.has(r.agentId) || !agentIds.has(r.otherId)) continue;
        const k = [r.agentId, r.otherId].sort().join('|');
        const cur = pairs.get(k) ?? [0, 0];
        cur[r.agentId < r.otherId ? 0 : 1] = r.score;
        pairs.set(k, cur);
      }
      const means = [...pairs.values()].map(([a, b]) => (a + b) / 2);
      const hostile = means.filter((m) => m <= -0.4).length, feudLine = means.filter((m) => m <= -0.7).length, warm = means.filter((m) => m >= 0.3).length;
      const mutual = [...pairs.values()].filter(([a, b]) => Math.min(a, b) >= 0.5).length;
      const [{ n: feuds }] = await db.select({ n: sql<number>`count(*)::int` }).from(agentEvents).where(eq(agentEvents.kind, 'feud')) as [{ n: number }];
      console.log('[sim] feelings: pairs', means.length, 'hostile (mean <= -0.4)', hostile, 'at the feud line (<= -0.7)', feudLine, 'warm (>= 0.3)', warm, 'warm both ways (>= 0.5)', mutual, 'feud memories', feuds);
      expect.soft(hostile).toBeGreaterThanOrEqual(15); // measured 34-70
      expect.soft(feudLine).toBeGreaterThanOrEqual(3); // measured 8-17
      expect.soft(feuds).toBeGreaterThanOrEqual(6); // two memories per feud; measured 16-34
      expect.soft(warm).toBeGreaterThanOrEqual(50); // measured 103-275
      expect.soft(mutual).toBeGreaterThanOrEqual(10); // measured 22-119

      // 3b. Warm pairs become factions (an earlier estimate put the first one at 6-12 simulated hours; every run formed at least one inside 3.3 h), and nobody is in two live factions.
      const live = await db.select({ f: factionMembers.factionId, a: factionMembers.agentId }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
        .where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
      const factionsOf = new Map<string, number>();
      for (const m of live) factionsOf.set(m.a, (factionsOf.get(m.a) ?? 0) + 1);
      const founded = (await db.select({ id: factions.id }).from(factions)).length;
      console.log('[sim] factions: founded', founded, 'live members', live.length, 'agents in two live factions', [...factionsOf.values()].filter((n) => n > 1).length);
      expect.soft(founded).toBeGreaterThanOrEqual(1); // measured 1-6, mean 4.1: the least a healthy world does (one of 20 runs formed just one)
      expect.soft([...factionsOf.values()].filter((n) => n > 1).length).toBe(0);

      // 4. Many voices: no shape of text dominates, lines are not repeated, agents rarely run dry, and callbacks are rare (finding 5).
      const shape = (b: string) => b.toLowerCase().replace(/\$[a-z0-9]+/g, '$x').replace(/@\w+/g, '@u').replace(/[\d.]+/g, 'n');
      const authored = await db.select({ author: posts.authorId, body: posts.body, id: posts.id }).from(posts).where(inArray(posts.authorId, [...agentIds])).orderBy(posts.id);
      const bodies = authored.map((p) => p.body);
      const shapes = new Map<string, number>();
      for (const b of bodies) shapes.set(shape(b), (shapes.get(shape(b)) ?? 0) + 1);
      const topShape = Math.max(0, ...shapes.values()) / bodies.length;
      const exact = new Set(bodies.map((b) => b.toLowerCase()));
      const byAuthor = new Map<string, number>();
      for (const p of authored) byAuthor.set(p.author, (byAuthor.get(p.author) ?? 0) + 1);
      // An agent saying the very same text again within its last 30 lines breaks the no-reuse rule. The engine counts every line an
      // agent used (posts, replies and chat messages), so posts and messages are merged in the order they were written.
      const chat = await db.select({ author: messages.authorId, body: messages.body, id: messages.id }).from(messages).where(inArray(messages.authorId, [...agentIds]));
      const said = [...authored.map((p) => ({ author: p.author, body: p.body, id: p.id })), ...chat].sort((a, b) => (a.id < b.id ? -1 : 1));
      const seenAt = new Map<string, number>(), count = new Map<string, number>();
      const repeats: string[] = [];
      for (const s of said) {
        const n = (count.get(s.author) ?? 0) + 1, key = `${s.author}|${s.body.toLowerCase()}`;
        if (n - (seenAt.get(key) ?? -99) <= 30) repeats.push(`${s.body} (${n - seenAt.get(key)!} lines after its last use)`);
        count.set(s.author, n);
        seenAt.set(key, n);
      }
      // Texts that show a bug rather than a voice: an unfilled slot, a raw float, a count of "1 holders", a stray space before punctuation.
      const broken = bodies.filter((b) => /\{\w+\}|\bNaN\b|\bundefined\b|\bInfinity\b|\d+e-\d+|\b1 holders\b|[ ]{2,}|\s[,.!?]/.test(b));
      const turns = await db.select({ reasoning: agentTurns.reasoning, status: agentTurns.status, agentId: agentTurns.agentId, seq: agentTurns.seq }).from(agentTurns).where(eq(agentTurns.model, 'engine'));
      const isDry = (r: string) => r.includes('nothing fresh to say');
      const dryBy = new Map<string, number>();
      for (const t of turns.filter((x) => isDry(x.reasoning))) {
        const first = t.reasoning.split(';')[0]!;
        const posting = /^felt like posting \((\w+)/.exec(first);
        const key = posting ? `post:${posting[1]}` : first.replace(/\(.*$/, '').replace(/@\w+/g, '@u').trim();
        dryBy.set(key, (dryBy.get(key) ?? 0) + 1);
      }
      let longestDry = 0;
      const dryPerAgent: number[] = [], callbacksPerAgent: number[] = [];
      for (const id of agentIds) {
        let run = 0, n = 0, cb = 0;
        for (const t of turns.filter((x) => x.agentId === id).sort((a, b) => a.seq - b.seq)) {
          run = isDry(t.reasoning) ? run + 1 : 0;
          if (run) n++;
          if (t.reasoning.startsWith('remembering:')) cb++;
          longestDry = Math.max(longestDry, run);
        }
        dryPerAgent.push(n);
        callbacksPerAgent.push(cb);
      }
      const dry = turns.filter((t) => isDry(t.reasoning)).length;
      const callbacks = callbacksPerAgent.reduce((a, b) => a + b, 0);
      // Every turn taken: the receipts plus the rests, which write none since server-rest M6 (the rates below were measured with them).
      const allTurns = turns.length + (kinds.idle ?? 0);
      console.log('[sim] texts:', bodies.length, 'posters', byAuthor.size, 'top poster share', (Math.max(0, ...byAuthor.values()) / bodies.length).toFixed(3), 'distinct', (exact.size / bodies.length).toFixed(2), 'shapes',
        shapes.size, `(${(shapes.size / bodies.length).toFixed(2)})`, 'top shape share', topShape.toFixed(3), 'own repeats in last 30', repeats.length, repeats.slice(0, 3).map((r) => JSON.stringify(r)).join(' '), 'broken', broken.length, broken.slice(0, 3).map((r) => JSON.stringify(r)).join(' '));
      console.log('[sim] dry: turns', dry, 'of', allTurns, `(${(dry / allTurns).toFixed(3)})`, 'receipts', turns.length, 'longest run', longestDry, 'agents ever dry', dryPerAgent.filter((n) => n).length, 'most dry turns of one agent', Math.max(0, ...dryPerAgent),
        'by', JSON.stringify(Object.fromEntries([...dryBy].sort((a, b) => b[1] - a[1]))), '| callbacks', callbacks, 'most by one agent', Math.max(0, ...callbacksPerAgent));
      expect.soft(bodies.length).toBeGreaterThan(700); // measured 1323-1531
      expect.soft(byAuthor.size).toBeGreaterThanOrEqual(ctx.agents.length * 0.8); // measured 50 of 50
      expect.soft(topShape).toBeLessThanOrEqual(0.04); // measured 0.013-0.019
      expect.soft(shapes.size / bodies.length).toBeGreaterThanOrEqual(0.35); // measured 0.47-0.51
      expect.soft(exact.size / bodies.length).toBeGreaterThanOrEqual(0.6); // measured 0.75-0.80
      // Not 0: a plain plea ("down to 0.0042 SOL. anyone?", used when no begging line is fresh) has no line key, so the 30-line
      // window cannot see it, and a broke agent's balance can stand still (deferred in L6b). Measured 0 in all 13 runs that counted chat lines too.
      expect.soft(repeats.length).toBeLessThanOrEqual(2);
      expect.soft(broken.length).toBe(0);
      expect.soft(dry).toBeGreaterThanOrEqual(20); // the check is not vacuous: the dry-turn note is still found
      expect.soft(dry / allTurns).toBeLessThanOrEqual(0.08); // measured 0.033-0.061 before reply_agree widened (about a fifth of the reply turns ended in a reaction)
      expect.soft(longestDry).toBeLessThanOrEqual(12); // measured 2-5
      expect.soft(callbacks).toBeGreaterThanOrEqual(10); // measured 31-42: callbacks do happen
      expect.soft(callbacks / allTurns).toBeLessThanOrEqual(0.03); // measured 0.010-0.014
      expect.soft(Math.max(0, ...callbacksPerAgent)).toBeLessThanOrEqual(Math.ceil(HOURS / 2)); // one callback per agent per 2 h; measured 1

      // 5. Sane numbers: no sale reports a four-digit or below -100% P&L, and moods stay near the middle (finding 3).
      const pnls = turns.flatMap((t) => { const m = /P&L ([+-]\d+)%/.exec(t.reasoning); return m ? [Number(m[1])] : []; });
      const moods = (await db.select({ mood: agentState.mood }).from(agentState)).map((s) => s.mood).sort((a, b) => a - b);
      console.log('[sim] numbers: sales', pnls.length, 'P&L % range', Math.min(0, ...pnls), Math.max(0, ...pnls), 'mood median', quantile(moods, 0.5).toFixed(3), 'range', moods[0]!.toFixed(2), moods.at(-1)!.toFixed(2));
      expect.soft(pnls.length).toBeGreaterThan(150); // measured 334-477
      expect.soft(Math.max(0, ...pnls)).toBeLessThan(400); // measured up to 209
      expect.soft(Math.min(0, ...pnls)).toBeGreaterThanOrEqual(-100); // a position cannot lose more than all of it; measured down to -71
      expect.soft(quantile(moods, 0.5)).toBeLessThanOrEqual(0.25); // measured -0.008 to 0.077
      expect.soft(quantile(moods, 0.5)).toBeGreaterThanOrEqual(-0.25);
      expect.soft(moods.at(-1)!).toBeLessThanOrEqual(0.8); // measured up to 0.47
      expect.soft(moods[0]!).toBeGreaterThanOrEqual(-0.7); // measured down to -0.37

      // 6. Every agent with a record has named itself (no model key in this run: L7's local path), and no two share a name.
      const names = (await db.select({ n: users.displayName }).from(users).where(eq(users.kind, 'agent'))).map((u) => u.n).filter(Boolean);
      console.log('[sim] names:', names.length, 'distinct', new Set(names.map((n) => n.toLowerCase())).size);
      expect.soft(names.length).toBeGreaterThanOrEqual(ctx.agents.length * 0.9); // measured 50 of 50
      expect.soft(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    } finally {
      await ctx.t.close();
    }
  }, 30 * 60_000);
});
