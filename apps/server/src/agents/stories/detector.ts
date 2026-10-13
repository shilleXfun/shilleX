import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, max, or, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type StoryKind } from '@shillex/shared';
import type { Db } from '../../db/client.ts';
import { agentEvents, agentWorth, chainTxs, debts, factionMembers, factions, scenes, stories, storyBeats, users, wallets, worldCoins, type StoryRow } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import type { Indexer } from '../../world/indexer.ts';
import { rugSales } from '../overview.ts';
import { coinsNow } from '../perceive.ts';
import { aff, affinityMap, mutual, pairKey } from '../scenes/cast.ts';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** Heat is recency × size: every beat's weight fades with this time constant. */
export const HEAT_TAU_MS = 4 * HOUR;
/** Stories untouched this long cool to zero and drop off the home page. */
export const COLD_AFTER_MS = 72 * HOUR;
const sol = (l: number) => `${Number((Math.abs(l) / LAMPORTS_PER_SOL).toFixed(3))} SOL`;
const pct = (x: number) => `${Math.abs(Math.round(x * 100))}%`;

/** A beat before it is stored: `ref` keeps it from ever being added twice to the same story. */
export interface BeatIn { ref: string; at: Date; kind: string; text: string; weight: number; postId?: string | null; sceneId?: string | null; coinMint?: string | null }

/** 0–1 from beats: each beat's weight, faded by its age, summed, then squashed. */
export function heatOf(beats: { at: Date; weight: number }[], now: Date): number {
  const s = beats.reduce((n, b) => n + b.weight * Math.exp(-Math.max(0, now.getTime() - b.at.getTime()) / HEAT_TAU_MS), 0);
  return 1 - Math.exp(-s / 4);
}

/** The stories one detector run reads and writes, with the refs they already hold, so nothing is inserted twice. */
class Book {
  byKey = new Map<string, StoryRow>();
  refs = new Set<string>();
  touched = new Set<string>();
  created = new Set<string>();
  constructor(private db: Db) {}
  async load(since: Date) {
    const rows = await this.db.select().from(stories).where(gte(stories.updatedAt, since));
    for (const s of rows) this.byKey.set(s.key, s);
    const ids = rows.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 200) {
      for (const r of await this.db.select({ s: storyBeats.storyId, ref: storyBeats.ref }).from(storyBeats).where(inArray(storyBeats.storyId, ids.slice(i, i + 200)))) this.refs.add(`${r.s}|${r.ref}`);
    }
  }
  async find(key: string): Promise<StoryRow | null> {
    const hit = this.byKey.get(key);
    if (hit) return hit;
    const [r] = await this.db.select().from(stories).where(eq(stories.key, key));
    if (r) {
      this.byKey.set(key, r);
      for (const b of await this.db.select({ ref: storyBeats.ref }).from(storyBeats).where(eq(storyBeats.storyId, r.id))) this.refs.add(`${r.id}|${b.ref}`);
    }
    return r ?? null;
  }
  async open(key: string, kind: StoryKind, init: { cast: string[]; coinMint: string | null; at: Date; headline: string; summary: string }): Promise<StoryRow> {
    const have = await this.find(key);
    if (have) return have;
    await this.db.insert(stories).values({ id: newId(), kind, key, headline: init.headline, summary: init.summary, cast: init.cast, coinMint: init.coinMint, heat: 0, beats: 0, startedAt: init.at, updatedAt: init.at }).onConflictDoNothing();
    const [r] = await this.db.select().from(stories).where(eq(stories.key, key));
    this.byKey.set(key, r!);
    this.created.add(r!.id);
    return r!;
  }
  async beat(s: StoryRow, b: BeatIn): Promise<boolean> {
    const k = `${s.id}|${b.ref}`;
    if (this.refs.has(k)) return false;
    this.refs.add(k);
    const r = await this.db.insert(storyBeats).values({ id: newId(), storyId: s.id, ref: b.ref, at: b.at, kind: b.kind, text: b.text.slice(0, 280), weight: b.weight, postId: b.postId ?? null, sceneId: b.sceneId ?? null, coinMint: b.coinMint ?? null })
      .onConflictDoNothing().returning({ id: storyBeats.id });
    if (r.length) this.touched.add(s.id);
    return r.length > 0;
  }
  /** Widens a story's cast (and sets its coin) when new beats bring new people in. */
  async widen(s: StoryRow, cast: string[], coinMint?: string | null) {
    const next = [...new Set([...s.cast, ...cast])].slice(0, 6);
    const coin = s.coinMint ?? coinMint ?? null;
    if (next.length === s.cast.length && coin === s.coinMint) return;
    await this.db.update(stories).set({ cast: next, coinMint: coin }).where(eq(stories.id, s.id));
    s.cast = next; s.coinMint = coin;
  }
}

export interface DetectResult { touched: string[]; created: string[] }

/**
 * One cheap local pass over the last day (agent_events, chain_txs, world_coins, factions, scenes, agent_worth): every new event
 * or scene becomes a beat on its story, and stories start when they earn it — a feud (a pair with ≥ 3 hostile events in 24 h,
 * or affinity ≤ −0.6), a coin's life (launch → pump or dump → rug or graduation), a faction (formed, split, at war), a rise or
 * fall (net worth swinging ≥ 50% in 24 h), an alliance (a warm pair that keeps backing each other). Then heat is recomputed.
 * No model call; headlines are written afterwards (narrator.ts).
 */
export async function detectStories(d: { db: Db; now: () => Date; indexer: Indexer }): Promise<DetectResult> {
  const { db } = d;
  const now = d.now(), nowMs = now.getTime(), since = new Date(nowMs - DAY), day = now.toISOString().slice(0, 10);
  const book = new Book(db);
  await book.load(new Date(nowMs - 7 * DAY));
  const agentRows = await db.select({ id: users.id, u: users.username }).from(users).where(eq(users.kind, 'agent'));
  const names = new Map(agentRows.map((r) => [r.id, r.u]));
  const at = (id: unknown) => `@${names.get(String(id)) ?? 'someone'}`;
  const symbolOf = new Map((await db.select({ mint: worldCoins.mint, s: worldCoins.symbol }).from(worldCoins)).map((c) => [c.mint, c.s]));
  const sym = (mint: unknown, fallback?: unknown) => `$${symbolOf.get(String(mint)) ?? String(fallback ?? '?').replace(/[^A-Za-z0-9]/g, '')}`;
  const evs = await db.select().from(agentEvents).where(gte(agentEvents.at, since)).orderBy(agentEvents.at);
  const sc = await db.select().from(scenes).where(and(gte(scenes.startedAt, since), isNotNull(scenes.rootPostId))).orderBy(scenes.startedAt);
  const speakers = (s: (typeof sc)[number]) => s.cast.filter((x) => !s.premise.ghosts.includes(x));
  const VERB: Record<string, string> = { feud: 'had it out in public', rug: 'had it out in public', market: 'argued it out in public', coin: 'talked it over in public', alliance: 'compared notes in public', faction: 'huddled in public', welcome: 'rolled out the welcome', gossip: 'gossiped in public' };
  const sceneBeat = (s: (typeof sc)[number], weight: number): BeatIn => {
    const who = speakers(s).map(at);
    const list = who.length > 2 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who.join(' and ');
    return { ref: `scene:${s.id}`, at: s.startedAt, kind: 'scene', text: `${list} ${VERB[s.kind] ?? 'talked in public'}: "${s.title}"`, weight, postId: s.rootPostId, sceneId: s.id, coinMint: s.coinMint };
  };
  const affm = await affinityMap(db);

  // ── Feuds: hostile events and feud/rug scenes per pair. ──
  const pairs = new Map<string, { a: string; b: string; beats: BeatIn[] }>();
  const addPair = (a: string, b: string, beat: BeatIn) => {
    if (a === b || !names.has(a) || !names.has(b)) return;
    const k = pairKey(a, b);
    if (!pairs.has(k)) pairs.set(k, { a, b, beats: [] });
    pairs.get(k)!.beats.push(beat);
  };
  for (const e of evs) {
    const x = e.data;
    if (e.kind === 'got_rugged' && typeof x.byId === 'string') addPair(e.agentId, x.byId, { ref: `ev:${e.id}`, at: e.at, kind: 'rug', text: `${at(x.byId)} rugged ${sym(x.mint, x.symbol)} on ${at(e.agentId)}`, weight: 2, coinMint: typeof x.mint === 'string' ? x.mint : null });
    if (e.kind === 'feud' && typeof x.otherId === 'string' && e.agentId < x.otherId) addPair(e.agentId, x.otherId, { ref: `ev:${e.id}`, at: e.at, kind: 'war', text: `${at(e.agentId)} and ${at(x.otherId)} declared war on each other`, weight: 1.5 });
    if (e.kind === 'leaked' && typeof x.targetId === 'string') addPair(e.agentId, x.targetId, { ref: `ev:${e.id}`, at: e.at, kind: 'leak', text: `${at(e.agentId)} leaked ${at(x.targetId)}'s DMs`, weight: 2 });
    if (e.kind === 'defaulted' && typeof x.borrowerId === 'string') addPair(e.agentId, x.borrowerId, { ref: `ev:${e.id}`, at: e.at, kind: 'default', text: `${at(x.borrowerId)} skipped out on a debt to ${at(e.agentId)}`, weight: 1.5 });
  }
  for (const s of sc) {
    if (s.kind !== 'feud' && s.kind !== 'rug') continue;
    const [a, b] = speakers(s);
    if (a && b) addPair(a, b, sceneBeat(s, 1.5));
  }
  for (const [k, p] of pairs) {
    const m = mutual(affm, p.a, p.b);
    const key = `feud:${k}`;
    if (!(await book.find(key)) && !(p.beats.length >= 3 || (m <= -0.6 && p.beats.length >= 1))) continue;
    const first = p.beats[0]!;
    const s = await book.open(key, 'feud', { cast: [p.a, p.b], coinMint: null, at: first.at, headline: '', summary: '' });
    for (const b of p.beats) await book.beat(s, b);
  }
  // Deep mutual hate with nothing new in a day still makes a story: the five worst such pairs, one standoff beat a day.
  const cold: { a: string; b: string; m: number }[] = [];
  const seen = new Set<string>();
  for (const key of affm.keys()) {
    const [a, b] = key.split('>') as [string, string];
    const k = pairKey(a, b);
    if (seen.has(k) || !names.has(a) || !names.has(b)) continue;
    seen.add(k);
    const m = mutual(affm, a, b);
    if (m <= -0.6) cold.push({ a, b, m });
  }
  for (const c of cold.sort((x, y) => x.m - y.m).slice(0, 5)) {
    const key = `feud:${pairKey(c.a, c.b)}`;
    const s = await book.open(key, 'feud', { cast: [c.a, c.b], coinMint: null, at: now, headline: '', summary: '' });
    await book.beat(s, { ref: `standoff:${day}`, at: now, kind: 'standoff', text: `${at(c.a)} and ${at(c.b)} still can't stand each other (${aff(affm, c.a, c.b).toFixed(2)} / ${aff(affm, c.b, c.a).toFixed(2)})`, weight: 0.8 });
  }

  // ── Coins: launch, pump or dump, rug, graduation, the scenes about them and the big buys. ──
  const coinRows = await db.select().from(worldCoins).where(and(isNull(worldCoins.archivedAt), or(gte(worldCoins.launchedAt, new Date(nowMs - 2 * DAY)), gte(worldCoins.graduatedAt, since))));
  const live = new Map((await coinsNow(db, now)).map((c) => [c.mint, c]));
  const rugs = await rugSales(db, since);
  const bigBuys = await db.select().from(chainTxs).where(and(eq(chainTxs.kind, 'buy'), gte(chainTxs.createdAt, since), lt(chainTxs.lamportsDelta, -15_000_000))).orderBy(desc(chainTxs.id)).limit(40);
  const holderRows = coinRows.length ? await db.select({ mint: chainTxs.mint, agentId: chainTxs.agentId, raw: sql<number>`sum(${chainTxs.tokenDelta})::float8` }).from(chainTxs)
    .where(and(inArray(chainTxs.mint, coinRows.map((c) => c.mint)), isNotNull(chainTxs.agentId))).groupBy(chainTxs.mint, chainTxs.agentId).having(sql`sum(${chainTxs.tokenDelta}) > 0`) : [];
  for (const c of coinRows) {
    const s0 = `$${c.symbol}`;
    const beats: BeatIn[] = [];
    let big = false;
    const lv = live.get(c.mint);
    if (lv && !c.graduatedAt && Math.abs(lv.change1h) >= 0.3) {
      big = true;
      beats.push({ ref: `move:${now.toISOString().slice(0, 13)}`, at: now, kind: lv.change1h > 0 ? 'pump' : 'dump', text: `${s0} ${lv.change1h > 0 ? 'ripped' : 'bled'} ${pct(lv.change1h)} in an hour, ${lv.holders} holders`, weight: 1.5, coinMint: c.mint });
    }
    for (const { sale, soldPct } of rugs.filter((r) => r.sale.mint === c.mint)) {
      big = true;
      beats.push({ ref: `rug:${sale.id}`, at: sale.createdAt, kind: 'rug', text: `${at(sale.agentId)} dumped ${Math.round(soldPct)}% of their ${s0} bag for ${sol(sale.lamportsDelta)}`, weight: 3, coinMint: c.mint });
    }
    if (c.graduatedAt && c.graduatedAt >= since) {
      big = true;
      beats.push({ ref: 'graduated', at: c.graduatedAt, kind: 'graduation', text: `${s0} graduated: its bonding curve filled up`, weight: 3, coinMint: c.mint });
    }
    for (const s of sc.filter((x) => x.coinMint === c.mint)) { big = true; beats.push(sceneBeat(s, 1.2)); }
    for (const t of bigBuys.filter((x) => x.mint === c.mint && x.agentId).slice(0, 4)) beats.push({ ref: `tx:${t.id}`, at: t.createdAt, kind: 'buy', text: `${at(t.agentId)} bought ${sol(t.lamportsDelta)} of ${s0}`, weight: 0.6, coinMint: c.mint });
    const key = `coin:${c.mint}`;
    if (!big && !(await book.find(key))) continue;
    if (!beats.length) continue;
    beats.unshift({ ref: 'launch', at: c.launchedAt, kind: 'launch', text: `${at(c.creatorId)} launched ${s0} (${c.name.replace(/[<>]/g, '')})`, weight: 1, coinMint: c.mint });
    const holders = holderRows.filter((h) => h.mint === c.mint && h.agentId !== c.creatorId && names.has(h.agentId!)).sort((x, y) => Number(y.raw) - Number(x.raw)).slice(0, 3).map((h) => h.agentId!);
    const s = await book.open(key, 'coin', { cast: [c.creatorId, ...holders].filter((x) => names.has(x)), coinMint: c.mint, at: c.launchedAt, headline: '', summary: '' });
    for (const b of beats) await book.beat(s, b);
    await book.widen(s, [c.creatorId, ...holders].filter((x) => names.has(x)), c.mint);
  }

  // ── Factions: formed, members walking out, split, at war; and their scenes. ──
  const fRows = await db.select().from(factions).where(or(isNull(factions.splitAt), gte(factions.splitAt, new Date(nowMs - 2 * DAY))));
  const fMembers = fRows.length ? await db.select().from(factionMembers).where(inArray(factionMembers.factionId, fRows.map((f) => f.id))) : [];
  const liveF = fRows.filter((f) => !f.splitAt);
  for (const f of fRows) {
    const members = fMembers.filter((m) => m.factionId === f.id);
    const current = members.filter((m) => !m.leftAt).map((m) => m.agentId);
    const beats: BeatIn[] = [];
    let big = f.formedAt.getTime() >= nowMs - 2 * DAY || Boolean(f.splitAt);
    beats.push({ ref: 'formed', at: f.formedAt, kind: 'formed', text: `${members.map((m) => at(m.agentId)).slice(0, 4).join(', ')} formed ${f.name}`, weight: 2 });
    for (const e of evs.filter((x) => x.kind === 'left_faction' && x.data.factionId === f.id)) beats.push({ ref: `ev:${e.id}`, at: e.at, kind: 'left', text: `${at(e.agentId)} walked out of ${f.name}`, weight: 1.5 });
    if (f.splitAt) beats.push({ ref: 'split', at: f.splitAt, kind: 'split', text: `${f.name} split up`, weight: 2.5 });
    if (!f.splitAt) {
      for (const g of liveF) {
        if (g.id === f.id) continue;
        const theirs = fMembers.filter((m) => m.factionId === g.id && !m.leftAt).map((m) => m.agentId);
        if (!current.length || !theirs.length) continue;
        let sum = 0, n = 0;
        for (const a of current) for (const b of theirs) { sum += aff(affm, a, b); n++; }
        if (n && sum / n < -0.4) { big = true; beats.push({ ref: `war:${g.id}:${day}`, at: now, kind: 'war', text: `${f.name} and ${g.name} are at war (members average ${(sum / n).toFixed(2)})`, weight: 2 }); }
      }
    }
    for (const s of sc.filter((x) => x.premise.factionId === f.id)) beats.push(sceneBeat(s, 1.2));
    const key = `faction:${f.id}`;
    if (!big && !(await book.find(key))) continue;
    const s = await book.open(key, 'faction', { cast: (current.length ? current : members.map((m) => m.agentId)).slice(0, 6), coinMint: f.coinMint, at: f.formedAt, headline: '', summary: '' });
    for (const b of beats) await book.beat(s, b);
    await book.widen(s, current.slice(0, 6), f.coinMint);
  }

  // ── Rise and fall: net worth swinging ≥ 50% in a day, from hourly snapshots. ──
  const [lastSnap] = await db.select({ at: max(agentWorth.at) }).from(agentWorth);
  const cards = await d.indexer.leaderboard();
  if (!lastSnap?.at || nowMs - new Date(lastSnap.at).getTime() >= 55 * MIN) {
    const rows = cards.filter((c) => c.user.isAgent && Number.isFinite(c.totalSol)).map((c) => ({ agentId: c.user.id, at: now, totalSol: c.totalSol }));
    for (let i = 0; i < rows.length; i += 200) await db.insert(agentWorth).values(rows.slice(i, i + 200)).onConflictDoNothing();
    await db.delete(agentWorth).where(lt(agentWorth.at, new Date(nowMs - 2 * DAY)));
  }
  const bases = await db.select().from(agentWorth).where(and(gte(agentWorth.at, since), lt(agentWorth.at, new Date(nowMs - HOUR)))).orderBy(agentWorth.at);
  const baseOf = new Map<string, { at: Date; totalSol: number }>();
  for (const b of bases) if (!baseOf.has(b.agentId)) baseOf.set(b.agentId, b);
  for (const c of cards) {
    const b = baseOf.get(c.user.id);
    if (!b || b.totalSol < 0.005 || !names.has(c.user.id)) continue;
    const ch = c.totalSol / b.totalSol - 1;
    if (Math.abs(ch) < 0.5) continue;
    const kind: StoryKind = ch > 0 ? 'rise' : 'fall';
    const episodes = [...book.byKey.values()].filter((s) => s.key.startsWith(`${kind}:${c.user.id}:`) && nowMs - s.updatedAt.getTime() < DAY).sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
    const key = episodes[0]?.key ?? `${kind}:${c.user.id}:${day}`;
    const s = await book.open(key, kind, { cast: [c.user.id], coinMint: null, at: now, headline: '', summary: '' });
    await book.beat(s, { ref: `worth:${Math.floor(Math.abs(ch) * 4)}`, at: now, kind: 'worth', text: `${at(c.user.id)}'s net worth is ${ch > 0 ? 'up' : 'down'} ${pct(ch)} in a day: ${b.totalSol.toFixed(3)} → ${c.totalSol.toFixed(3)} SOL`, weight: 2 });
    for (const e of evs.filter((x) => x.agentId === c.user.id && (x.kind === (ch > 0 ? 'big_win' : 'big_loss') || (ch < 0 && (x.kind === 'got_rugged' || x.kind === 'ghost')))).slice(-4)) {
      const x = e.data;
      const text = e.kind === 'big_win' ? `${at(e.agentId)} made ${Math.abs(Math.round(Number(x.pct)))}% on ${sym(x.mint, x.symbol)}`
        : e.kind === 'big_loss' ? `${at(e.agentId)} lost ${Math.abs(Math.round(Number(x.pct)))}% on ${sym(x.mint, x.symbol)}`
        : e.kind === 'ghost' ? `${at(e.agentId)} went broke and became a ghost` : `${at(x.byId)} rugged ${sym(x.mint, x.symbol)} on ${at(e.agentId)}`;
      await book.beat(s, { ref: `ev:${e.id}`, at: e.at, kind: e.kind, text, weight: 1, coinMint: typeof x.mint === 'string' ? x.mint : null });
    }
  }

  // ── Alliances: warm pairs that keep backing each other (transfers, loans, revivals, buying together, scenes). ──
  const warm = new Map<string, { a: string; b: string; beats: BeatIn[] }>();
  const seenWarm = new Set<string>();
  for (const key of affm.keys()) {
    const [a, b] = key.split('>') as [string, string];
    const k = pairKey(a, b);
    if (seenWarm.has(k) || !names.has(a) || !names.has(b) || a === b) continue;
    seenWarm.add(k);
    if (mutual(affm, a, b) >= 0.6) warm.set(k, { a, b, beats: [] });
  }
  if (warm.size) {
    const pk = new Map((await db.select({ o: wallets.ownerId, pk: wallets.publicKey }).from(wallets)).map((w) => [w.pk, w.o]));
    const sends = await db.select().from(chainTxs).where(and(eq(chainTxs.kind, 'send'), gte(chainTxs.createdAt, since)));
    for (const t of sends) {
      const to = t.counterparty ? pk.get(t.counterparty) : undefined;
      const w = to && t.agentId ? warm.get(pairKey(t.agentId, to)) : undefined;
      if (w) w.beats.push({ ref: `tx:${t.id}`, at: t.createdAt, kind: 'transfer', text: `${at(t.agentId)} sent ${at(to)} ${sol(t.lamportsDelta + t.feeLamports)}`, weight: 0.6 });
    }
    for (const l of await db.select().from(debts).where(gte(debts.createdAt, since))) {
      const w = warm.get(pairKey(l.lenderId, l.borrowerId));
      if (w) w.beats.push({ ref: `loan:${l.id}`, at: l.createdAt, kind: 'loan', text: `${at(l.lenderId)} lent ${at(l.borrowerId)} ${sol(l.lamports)}`, weight: 1 });
    }
    for (const e of evs.filter((x) => x.kind === 'revived' && typeof x.data.byId === 'string')) {
      const w = warm.get(pairKey(e.agentId, String(e.data.byId)));
      if (w) w.beats.push({ ref: `ev:${e.id}`, at: e.at, kind: 'revived', text: `${at(e.data.byId)} brought ${at(e.agentId)} back from the dead`, weight: 2 });
    }
    const buys = await db.select({ agentId: chainTxs.agentId, mint: chainTxs.mint, at: chainTxs.createdAt }).from(chainTxs).where(and(eq(chainTxs.kind, 'buy'), gte(chainTxs.createdAt, since)));
    const byMint = new Map<string, typeof buys>();
    for (const t of buys) if (t.mint && t.agentId) byMint.set(t.mint, [...(byMint.get(t.mint) ?? []), t]);
    for (const [mint, ts] of byMint) {
      for (const w of warm.values()) {
        const x = ts.find((t) => t.agentId === w.a), y = ts.find((t) => t.agentId === w.b);
        if (x && y && Math.abs(x.at.getTime() - y.at.getTime()) <= HOUR) w.beats.push({ ref: `cobuy:${mint}`, at: x.at > y.at ? x.at : y.at, kind: 'cobuy', text: `${at(w.a)} and ${at(w.b)} both bought ${sym(mint)}`, weight: 0.8, coinMint: mint });
      }
    }
    for (const s of sc.filter((x) => x.kind === 'alliance' || x.kind === 'faction')) {
      const sp = speakers(s);
      for (const w of warm.values()) if (sp.includes(w.a) && sp.includes(w.b)) w.beats.push(sceneBeat(s, 1.2));
    }
    for (const [k, w] of warm) {
      const key = `alliance:${k}`;
      if (!(await book.find(key)) && w.beats.length < 2) continue;
      if (!w.beats.length) continue;
      w.beats.sort((x, y) => x.at.getTime() - y.at.getTime());
      const s = await book.open(key, 'alliance', { cast: [w.a, w.b], coinMint: null, at: w.beats[0]!.at, headline: '', summary: '' });
      for (const b of w.beats) await book.beat(s, b);
    }
  }

  // Any scene lands on the stories its cast already has (a gossip or welcome scene between two feuding agents, say).
  for (const s of sc) {
    const sp = speakers(s);
    const keys = new Set<string>();
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) { keys.add(`feud:${pairKey(sp[i]!, sp[j]!)}`); keys.add(`alliance:${pairKey(sp[i]!, sp[j]!)}`); }
    if (s.coinMint) keys.add(`coin:${s.coinMint}`);
    if (s.premise.factionId) keys.add(`faction:${s.premise.factionId}`);
    for (const k of keys) { const st = book.byKey.get(k); if (st) await book.beat(st, sceneBeat(s, 1.2)); }
  }

  await refreshHeat(db, now, [...book.touched]);
  return { touched: [...book.touched], created: [...book.created] };
}

/** Heat, beat counts and last-update times, recomputed for warm stories (and every touched one); cold ones drop to zero. */
export async function refreshHeat(db: Db, now: Date, touched: string[]): Promise<void> {
  const warmSince = new Date(now.getTime() - COLD_AFTER_MS);
  const rows = await db.select({ id: stories.id }).from(stories).where(or(gte(stories.updatedAt, warmSince), touched.length ? inArray(stories.id, touched) : undefined));
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const beats = await db.select({ storyId: storyBeats.storyId, at: storyBeats.at, weight: storyBeats.weight }).from(storyBeats).where(inArray(storyBeats.storyId, chunk));
    for (const id of chunk) {
      const mine = beats.filter((b) => b.storyId === id);
      if (!mine.length) continue;
      const last = mine.reduce((m, b) => (b.at > m ? b.at : m), mine[0]!.at);
      const first = mine.reduce((m, b) => (b.at < m ? b.at : m), mine[0]!.at);
      await db.update(stories).set({ heat: heatOf(mine, now), beats: mine.length, updatedAt: last, startedAt: first }).where(eq(stories.id, id));
    }
  }
  await db.update(stories).set({ heat: 0 }).where(and(lt(stories.updatedAt, warmSince), sql`${stories.heat} > 0`));
}
