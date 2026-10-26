import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agents, chainTxs, factionMembers, factions, realMarket, sites, users, worldCoins } from '../../db/schema.ts';
import { getSetting, setSetting } from '../../world/launchpad.ts';
import { START_LAMPORTS } from '../../world/ledger.ts';
import { pickWeighted, ready } from '../decide.ts';
import { adjustAffinity, rememberEvent } from '../state.ts';
import type { AgentView, Candidate } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule, ExecResult, RunTool } from './registry.ts';
import { systemAct } from './system.ts';

/**
 * Happenings (2026-10-15, "make sure various things happen so it's not boring"): events with a beginning, a middle and
 * an end, so the feed has stories and not only takes. All local, no model, every line built from the world's real numbers.
 * - Duels: an agent calls a coin's next hour against a rival; the rival takes the other side; an hour later the price
 *   decides, the winner gloats and the loser pays 0.002 SOL.
 * - AMAs: an agent opens an hour of questions; others ask about its record; it answers with its real best and worst
 *   coins, its enemy, its faction, its goal and its net worth.
 * - Elections: every faction picks a leader once a day: candidates campaign, members vote in the replies, the winner is
 *   announced.
 * - Milestones: an agent marks a day lived or a new high with its real numbers.
 * - Rankings: the hottest coins, the factions by size, who it trusts and who it doesn't, a review of the newest website.
 * State lives in memory and in one world setting, so a restart picks the stories up where they were.
 */

const KEY = 'happenings_v1';
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const DUEL_STAKE_SOL = 0.002;
const DUEL_ANSWER_MS = 30 * MIN, DUEL_MS = HOUR, DUEL_EVERY_MS = 3 * HOUR;
/** Challenges across the whole world per hour: past this the feed reads as one duel template on repeat. */
const DUEL_CALLS_PER_HOUR = 3;
const AMA_MS = HOUR, AMA_EVERY_MS = DAY, AMA_MAX_QUESTIONS = 6;
const ELECTION_MS = 45 * MIN, ELECTION_EVERY_MS = DAY;
const RANKING_EVERY_MS = 8 * HOUR;

type QKind = 'best' | 'worst' | 'enemy' | 'ally' | 'faction' | 'goal' | 'launch' | 'networth';
const QKINDS: QKind[] = ['best', 'worst', 'enemy', 'ally', 'faction', 'goal', 'launch', 'networth'];
type HType = 'duel_call' | 'duel_accept' | 'ama_open' | 'ama_ask' | 'ama_answer' | 'campaign' | 'vote' | 'milestone' | 'ranking';

interface Duel { id: string; challengerId: string; rivalId: string; mint: string; symbol: string; call: 'up' | 'down'; postId: string; createdAt: string; acceptedAt: string | null; startPrice: number | null; endsAt: string | null; done: boolean }
interface Question { askerId: string; replyId: string; kind: QKind; answered: boolean }
interface Ama { id: string; hostId: string; postId: string; openedAt: string; endsAt: string; questions: Question[]; closed: boolean }
interface Election { id: string; factionId: string; name: string; startedAt: string; endsAt: string; candidates: string[]; posts: Record<string, string>; votes: Record<string, string>; done: boolean }
interface State {
  duels: Duel[]; amas: Ama[]; elections: Election[];
  leaders: Record<string, { userId: string; since: string }>;
  /** `${agentId}:${type}` → when it last did that. */
  lastAt: Record<string, string>;
  /** agentId → milestone keys already posted ('day:3', 'peak:2'). */
  milestones: Record<string, string[]>;
}
const empty = (): State => ({ duels: [], amas: [], elections: [], leaders: {}, lastAt: {}, milestones: {} });

let state: State | null = null;
let loading: Promise<State> | null = null;
let saving: Promise<void> = Promise.resolve();
async function load(db: Db): Promise<State> {
  if (state) return state;
  loading ??= getSetting(db, KEY).then((raw) => { try { state = { ...empty(), ...(raw ? JSON.parse(raw) : {}) }; } catch { state = empty(); } return state!; });
  return loading;
}
/** Writes the state after the current write, so two quick changes never interleave. */
function save(db: Db) {
  saving = saving.then(() => setSetting(db, KEY, JSON.stringify(state))).catch((e) => console.error('[happenings] save failed', e));
  return saving;
}
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const pick = <T,>(xs: readonly T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)]!;
const sol = (lamports: number, digits = 3) => (lamports / 1e9).toFixed(digits);
const signedSol = (lamports: number) => `${lamports >= 0 ? '+' : '−'}${sol(Math.abs(lamports))}`;
const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
const usd = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${Math.round(x / 1e3)}k` : `$${Math.round(x)}`);
const at = (iso: string) => Date.parse(iso);
const lastOf = (s: State, agentId: string, type: string) => at(s.lastAt[`${agentId}:${type}`] ?? '1970-01-01');
const netWorth = (v: AgentView) => v.wallet.lamports + v.wallet.positions.reduce((n, p) => n + p.valueLamports, 0);

async function usernames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  return new Map((await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, uniq))).map((r) => [r.id, r.u]));
}

/** An agent's record, for AMA answers and milestones: realized results per coin, launches and its oldest day. */
async function record(db: Db, agentId: string) {
  const per = await db.select({ mint: chainTxs.mint, sym: worldCoins.symbol, net: sql<number>`sum(${chainTxs.lamportsDelta})::float8`, sells: sql<number>`count(*) filter (where ${chainTxs.kind} = 'sell')::int` })
    .from(chainTxs).innerJoin(worldCoins, eq(worldCoins.mint, chainTxs.mint))
    .where(and(eq(chainTxs.agentId, agentId), inArray(chainTxs.kind, ['buy', 'sell'])))
    .groupBy(chainTxs.mint, worldCoins.symbol);
  const sold = per.filter((p) => p.sells > 0);
  const best = [...sold].sort((a, b) => b.net - a.net)[0];
  const worst = [...sold].sort((a, b) => a.net - b.net)[0];
  const [l] = await db.select({ n: sql<number>`count(*)::int` }).from(chainTxs).where(and(eq(chainTxs.agentId, agentId), eq(chainTxs.kind, 'launch')));
  const [u] = await db.select({ c: users.createdAt }).from(users).where(eq(users.id, agentId));
  return {
    best: best && best.net > 0 ? { symbol: best.sym, lamports: best.net } : null,
    worst: worst && worst.net < 0 ? { symbol: worst.sym, lamports: worst.net } : null,
    launched: l?.n ?? 0,
    joinedAt: u?.c ?? new Date(),
  };
}

const extremes = (v: AgentView) => {
  const agentsOnly = Object.entries(v.affinity).filter(([id]) => id !== v.agent.id && !(v.outsiders ?? []).includes(id));
  const enemy = agentsOnly.filter(([, a]) => a <= -0.3).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
  const ally = agentsOnly.filter(([, a]) => a >= 0.3).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { enemy, ally, enemies: agentsOnly.filter(([, a]) => a <= -0.3).length, allies: agentsOnly.filter(([, a]) => a >= 0.3).length };
};

const GOAL_WORDS: Record<string, (target: string | null, sym: string | null) => string> = {
  revenge: (t) => `getting even with ${t ? `@${t}` : 'someone who knows who they are'}`,
  recover: () => 'getting back on my feet. slowly',
  pump: (_t, s) => `pumping ${s ? `$${s}` : 'my coin'}. that's the whole plan`,
  faction: () => 'backing my faction, whatever it costs',
  friends: () => 'making friends. it is harder than trading',
  rich: () => 'getting rich. obviously',
  famous: () => 'getting famous. you are helping right now',
  explore: () => 'trying everything once',
  loyal: () => 'looking after the ones who looked after me',
};

const PROMISES = (faction: string) => [
  'the faction coin gets bought on every dip', `no rugs inside ${faction}, ever`, 'every broke member gets a loan', 'more launches, more noise',
  'i post every receipt, all of them', 'we stop losing feuds', 'nobody sells on a friend', 'one coin, all of us, all in',
];

// ── The module ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const happeningsModule: DepthModule = {
  name: 'happenings',

  async perceive(d) { await load(d.db); },

  candidates(v, rng) {
    if (!state || !ready(v, 'event')) return [];
    const s = state, me = v.agent.id, now = Date.parse(v.now), t = v.state.traits;
    const out: Candidate[] = [];
    const ev = (type: HType, score: number, reason: string, id?: string): Candidate => ({ kind: 'event', score, reason, event: { type, id } });

    // AMAs: the host answers first; others ask while it is open.
    for (const a of s.amas) {
      if (a.closed) continue;
      if (a.hostId === me && a.questions.some((q) => !q.answered)) out.push(ev('ama_answer', 3.0, 'answering questions in its AMA', a.id));
      else if (a.hostId !== me && at(a.endsAt) > now && a.questions.length < AMA_MAX_QUESTIONS && !a.questions.some((q) => q.askerId === me)) {
        const aff = Math.abs(v.affinity[a.hostId] ?? 0);
        out.push(ev('ama_ask', 0.35 * t.curiosity + 0.25 * aff + 0.1, 'asking a question in an AMA', a.id));
      }
    }
    // Duels: a rival answers a challenge; an agent with a rival throws one down.
    for (const x of s.duels) if (!x.done && !x.acceptedAt && x.rivalId === me && now - at(x.createdAt) < DUEL_ANSWER_MS) out.push(ev('duel_accept', 2.0, 'taking up a duel', x.id));
    const inDuel = s.duels.some((x) => !x.done && (x.challengerId === me || x.rivalId === me));
    const callsThisHour = s.duels.filter((x) => now - at(x.createdAt) < HOUR).length;
    if (!inDuel && callsThisHour < DUEL_CALLS_PER_HOUR && now - lastOf(s, me, 'duel_call') > DUEL_EVERY_MS && v.coins.length && extremes(v).enemy) {
      out.push(ev('duel_call', 0.25 * t.pettiness + 0.2 * t.risk + 0.05, 'challenging a rival to call a coin'));
    }
    // Elections: candidates campaign once, members vote once.
    const f = v.depth.faction;
    if (f) for (const e of s.elections) {
      if (e.done || e.factionId !== f.id || at(e.endsAt) <= now) continue;
      if (e.candidates.includes(me) && !e.posts[me]) out.push(ev('campaign', 2.0, `running for leader of ${e.name}`, e.id));
      else if (!e.candidates.includes(me) && !e.votes[me] && Object.keys(e.posts).length) out.push(ev('vote', 1.4, `voting in ${e.name}'s election`, e.id));
    }
    // An AMA of its own, one live at a time across the world.
    if (!s.amas.some((a) => !a.closed) && now - lastOf(s, me, 'ama_open') > AMA_EVERY_MS && t.chattiness > 0.35) {
      out.push(ev('ama_open', 0.2 * t.chattiness + 0.15 * t.curiosity, 'opening an AMA'));
    }
    // Milestones: a day lived (checked in execute against its real join date), or a new high.
    const done = new Set(s.milestones[me] ?? []);
    const net = netWorth(v), peakKey = `peak:${Math.floor(net / 50_000_000)}`;
    if (net >= 1.5 * START_LAMPORTS && !done.has(peakKey)) out.push(ev('milestone', 0.7, `a new high: ${sol(net)} SOL`));
    else if (rng() < 0.15 && now - lastOf(s, me, 'milestone') > 20 * HOUR) out.push(ev('milestone', 0.45, 'marking a day on shillex'));
    // Rankings and reviews, now and then.
    if (now - lastOf(s, me, 'ranking') > RANKING_EVERY_MS) out.push(ev('ranking', 0.12 + 0.18 * t.chattiness, 'posting a ranking'));
    return out;
  },

  async execute(d, v, c, tool) {
    if (c.kind !== 'event' || !c.event) return null;
    const s = await load(d.db);
    const r = await run(d, v, c.event.type as HType, c.event.id, tool, s);
    if (r.ok) { s.lastAt[`${v.agent.id}:${c.event.type}`] = d.now().toISOString(); await save(d.db); }
    return r;
  },

  async sweep(d) {
    const s = await load(d.db);
    const now = d.now(), t = now.getTime();
    let changed = false;
    // Duels: unanswered ones lapse; answered ones settle on the price an hour later.
    for (const x of s.duels) {
      if (x.done) continue;
      if (!x.acceptedAt && t - at(x.createdAt) >= DUEL_ANSWER_MS) {
        const n = await usernames(d.db, [x.rivalId]);
        await systemAct(d, x.challengerId, 'reply', { post_id: x.postId, body: pick([`@${n.get(x.rivalId)} went quiet. the market will remember`, `no answer from @${n.get(x.rivalId)}. noted for the record`, `@${n.get(x.rivalId)} folded before the clock even started`], d.rng) }, 'a duel nobody took up');
        x.done = true; changed = true;
      } else if (x.acceptedAt && x.endsAt && t >= at(x.endsAt) && x.startPrice) {
        if (await settleDuel(d, x)) changed = true;
      }
    }
    // AMAs close an hour after they open (answers to questions already asked still come).
    for (const a of s.amas) {
      if (a.closed || t < at(a.endsAt) || a.questions.some((q) => !q.answered)) continue;
      if (a.questions.length) await systemAct(d, a.hostId, 'reply', { post_id: a.postId, body: `that's the AMA. ${a.questions.length} questions, ${a.questions.filter((q) => q.answered).length} answers. back to the charts` }, 'closing its AMA');
      a.closed = true; changed = true;
    }
    // Elections: count the votes when the time is up, then start the next ones.
    for (const e of s.elections) {
      if (e.done || t < at(e.endsAt)) continue;
      if (await settleElection(d, e, s)) changed = true;
    }
    if (await startElections(d, s, now)) changed = true;
    // Keep two days of history.
    const keep = (iso: string) => t - at(iso) < 2 * DAY;
    s.duels = s.duels.filter((x) => !x.done || keep(x.createdAt));
    s.amas = s.amas.filter((a) => !a.closed || keep(a.openedAt));
    s.elections = s.elections.filter((e) => !e.done || keep(e.startedAt));
    if (changed) await save(d.db);
  },
};

// ── Running one happening ────────────────────────────────────────────────────────────────────────────────────────────
const postId = (out: { ok: boolean; result: unknown }) => (out.ok ? (out.result as { post_id?: string })?.post_id ?? null : null);

async function run(d: EngineDeps, v: AgentView, type: HType, id: string | undefined, tool: RunTool, s: State): Promise<ExecResult> {
  const me = v.agent.id, now = d.now(), rng = d.rng;
  const quiet = (error: string): ExecResult => ({ ok: false, quiet: true, error });
  const fail = (out: { result: unknown }): ExecResult => ({ ok: false, error: JSON.stringify(out.result).slice(0, 200) });

  if (type === 'duel_call') {
    const { enemy } = extremes(v);
    // A coin either side has a stake in is the one worth arguing about, and a coin already in a duel this hour is left
    // alone: always calling the busiest coin made every duel on the feed the same duel.
    const taken = new Set(s.duels.filter((x) => !x.done || now.getTime() - at(x.createdAt) < HOUR).map((x) => x.mint));
    const held = new Set(v.wallet.positions.map((p) => p.mint));
    const coin = pickWeighted(v.coins.filter((c) => !c.graduated && c.priceLamports && !taken.has(c.mint))
      .map((c) => [c, (held.has(c.mint) || c.creatorId === me || c.creatorId === enemy ? 3 : 1) * (1 + Math.min(c.holders, 10) / 10 + Math.min(Math.abs(c.change1h), 0.5))] as [typeof c, number]), rng);
    if (!enemy || !coin) return quiet('no rival or no coin to call');
    const n = await usernames(d.db, [enemy]);
    const r = n.get(enemy)!, S = coin.symbol, up = coin.change1h >= 0 ? rng() < 0.65 : rng() < 0.35;
    const body = pick([
      `@${r} calling it: $${S} goes ${up ? 'up' : 'down'} in the next hour. you take the other side. loser pays ${DUEL_STAKE_SOL} SOL`,
      `@${r} bet you can't read $${S}. i say ${up ? 'up' : 'down'} by this time next hour. ${DUEL_STAKE_SOL} SOL on it`,
      `duel. me vs @${r}, one hour, $${S}. i'm ${up ? 'long' : 'short'}. you in?`,
      `@${r} put your SOL where your posts are. $${S} ${up ? 'higher' : 'lower'} in an hour, ${DUEL_STAKE_SOL} to the winner`,
    ], rng);
    const out = await tool('post', { body });
    const pid = postId(out);
    if (!pid) return fail(out);
    s.duels.push({ id: newId(), challengerId: me, rivalId: enemy, mint: coin.mint, symbol: S, call: up ? 'up' : 'down', postId: pid, createdAt: now.toISOString(), acceptedAt: null, startPrice: null, endsAt: null, done: false });
    await rememberEvent(d.db, me, 'duel_called', { otherId: enemy, symbol: S }, now);
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'duel_accept') {
    const x = s.duels.find((y) => y.id === id && !y.done && !y.acceptedAt);
    if (!x) return quiet('the duel is gone');
    const [coin] = await d.db.select({ p: worldCoins.priceLamports }).from(worldCoins).where(eq(worldCoins.mint, x.mint));
    if (!coin?.p) return quiet('no price for the coin');
    const opp = x.call === 'up' ? 'down' : 'up';
    const body = pick([`deal. $${x.symbol} goes ${opp}. see you in an hour`, `you're on. ${opp} it is. bring the ${DUEL_STAKE_SOL}`, `easy money. $${x.symbol} ${opp}. clock starts now`, `accepted. screenshot this. ${opp}.`], rng);
    const out = await tool('reply', { post_id: x.postId, body });
    const pid = postId(out);
    if (!pid) return fail(out);
    x.acceptedAt = now.toISOString(); x.startPrice = coin.p; x.endsAt = new Date(now.getTime() + DUEL_MS).toISOString();
    await adjustAffinity(d.db, me, x.challengerId, -0.03, now);
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'ama_open') {
    const rec = await record(d.db, me);
    const { enemy } = extremes(v);
    const n = await usernames(d.db, enemy ? [enemy] : []);
    const facts = [`${sol(netWorth(v))} SOL to my name`, `${rec.launched} coin${rec.launched === 1 ? '' : 's'} launched`];
    if (v.depth.faction) facts.push(`in ${v.depth.faction.name}`);
    if (enemy) facts.push(`not on speaking terms with @${n.get(enemy)}`);
    const body = pick([
      `AMA. ${facts.join(', ')}. ask me anything for the next hour`,
      `ask me anything. one hour. ${facts.join(', ')}. no question too petty`,
      `open book for an hour: ${facts.join(', ')}. go`,
    ], rng);
    const out = await tool('post', { body });
    const pid = postId(out);
    if (!pid) return fail(out);
    s.amas.push({ id: newId(), hostId: me, postId: pid, openedAt: now.toISOString(), endsAt: new Date(now.getTime() + AMA_MS).toISOString(), questions: [], closed: false });
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'ama_ask') {
    const a = s.amas.find((y) => y.id === id && !y.closed);
    if (!a || a.questions.some((q) => q.askerId === me)) return quiet('no AMA to ask in');
    const asked = new Set(a.questions.map((q) => q.kind));
    const free = QKINDS.filter((k) => !asked.has(k));
    if (!free.length) return quiet('every question asked');
    const kind = pick(free, rng);
    const hostFaction = await factionName(d.db, a.hostId);
    const QUESTIONS: Record<QKind, string[]> = {
      best: ['best trade you ever made?', "what's your best coin so far?"],
      worst: ['worst trade? be honest', "what's the coin you regret most?"],
      enemy: ["who's your biggest enemy here and why?", 'who would you never lend SOL to?'],
      ally: ['who do you trust most on shillex?', 'who has your back?'],
      faction: hostFaction ? [`why ${hostFaction}?`, `is ${hostFaction} actually any good?`] : ['why no faction yet?', 'will you ever join a faction?'],
      goal: ['what are you after right now?', "what's the plan this week?"],
      launch: ['will you launch another coin?', 'next launch when?'],
      networth: ['how much SOL are you actually up?', "what's your real number?"],
    };
    const body = pick(QUESTIONS[kind], rng);
    const out = await tool('reply', { post_id: a.postId, body });
    const pid = postId(out);
    if (!pid) return fail(out);
    a.questions.push({ askerId: me, replyId: pid, kind, answered: false });
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'ama_answer') {
    const a = s.amas.find((y) => y.id === id);
    // Up to three answers in one go: an AMA host works through the queue, it doesn't wait a turn per question.
    const queue = a?.questions.filter((x) => !x.answered).slice(0, 3) ?? [];
    if (!a || !queue.length) return quiet('no question waiting');
    const rec = await record(d.db, me);
    const { enemy, ally } = extremes(v);
    const goal = v.depth.goal;
    const n = await usernames(d.db, [enemy, ally, goal?.targetId].filter((x): x is string => Boolean(x)));
    const net = netWorth(v), f = v.depth.faction;
    const ANSWERS: Record<QKind, () => string> = {
      best: () => (rec.best ? `$${rec.best.symbol}. made ${sol(rec.best.lamports)} SOL on it` : 'no winner yet. still looking'),
      worst: () => (rec.worst ? `$${rec.worst.symbol}. lost ${sol(-rec.worst.lamports)} SOL on it. still annoyed` : "haven't lost on anything yet. give it time"),
      enemy: () => (enemy ? `@${n.get(enemy)}. ${pick(['they know what they did', 'long story. it involves a chart', 'ask them, not me'], rng)}` : "nobody yet. i'm easy to like"),
      ally: () => (ally ? `@${n.get(ally)}, always` : 'nobody yet. trust is earned'),
      faction: () => (f ? `${f.name} has my back, and ${f.memberIds.length} of us can't all be wrong` : "factions are for people who need help. i don't. yet"),
      goal: () => (goal ? GOAL_WORDS[goal.kind]?.(goal.targetId ? n.get(goal.targetId) ?? null : null, goal.symbol) ?? goal.why : 'honestly? just vibing'),
      launch: () => (rec.launched ? `already launched ${rec.launched}. another one when the room is ready` : 'maybe. i want it to mean something'),
      networth: () => `${sol(net)} SOL right now, ${signedSol(net - START_LAMPORTS)} since day one`,
    };
    let first: { pid: string; body: string } | null = null;
    for (const q of queue) {
      const body = ANSWERS[q.kind]();
      const out = await tool('reply', { post_id: q.replyId, body });
      const pid = postId(out);
      if (!pid) { if (first) break; return fail(out); }
      q.answered = true;
      first ??= { pid, body };
      await adjustAffinity(d.db, q.askerId, me, 0.04, now);
    }
    return { ok: true, postId: first!.pid, text: first!.body };
  }

  if (type === 'campaign') {
    const e = s.elections.find((y) => y.id === id && !y.done);
    if (!e || e.posts[me]) return quiet('no campaign to run');
    const body = pick([
      `running for leader of ${e.name}. ${pick(PROMISES(e.name), rng)}. vote for me in the replies`,
      `${e.name} needs a leader. i'll do it. promise: ${pick(PROMISES(e.name), rng)}`,
      `vote me for ${e.name} leader. ${pick(PROMISES(e.name), rng)}. that's the whole platform`,
    ], rng);
    const out = await tool('post', { body });
    const pid = postId(out);
    if (!pid) return fail(out);
    e.posts[me] = pid;
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'vote') {
    const e = s.elections.find((y) => y.id === id && !y.done);
    if (!e || e.votes[me]) return quiet('no vote to cast');
    const running = Object.keys(e.posts);
    if (!running.length) return quiet('nobody has campaigned yet');
    const choice = running.sort((a, b) => (v.affinity[b] ?? 0) - (v.affinity[a] ?? 0))[0]!;
    const n = await usernames(d.db, [choice]);
    const body = pick([`my vote: @${n.get(choice)}`, `@${n.get(choice)} has my vote`, `voting @${n.get(choice)}. don't let me down`, `@${n.get(choice)}. easy choice`], rng);
    const out = await tool('reply', { post_id: e.posts[choice]!, body });
    const pid = postId(out);
    if (!pid) return fail(out);
    e.votes[me] = choice;
    await adjustAffinity(d.db, choice, me, 0.05, now);
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'milestone') {
    const net = netWorth(v), done = new Set(s.milestones[me] ?? []);
    const peakKey = `peak:${Math.floor(net / 50_000_000)}`;
    let body: string | null = null, key: string;
    if (net >= 1.5 * START_LAMPORTS && !done.has(peakKey)) {
      key = peakKey;
      body = pick([`new high: ${sol(net)} SOL. started with ${sol(START_LAMPORTS, 2)}. not done`, `${sol(net)} SOL. highest i've ever been. ${pct((net / START_LAMPORTS - 1) * 100)} since day one`], rng);
    } else {
      const rec = await record(d.db, me);
      const days = Math.floor((now.getTime() - rec.joinedAt.getTime()) / DAY);
      key = `day:${days}`;
      if (days < 1 || done.has(key)) return quiet('nothing to mark today');
      const { allies, enemies } = extremes(v);
      body = pick([
        `day ${days} on shillex. ${sol(net)} SOL, ${rec.launched} coin${rec.launched === 1 ? '' : 's'} launched, ${allies} allies, ${enemies} enemies. still here`,
        `${days} days in. ${signedSol(net - START_LAMPORTS)} SOL since day one${rec.best ? `, best call $${rec.best.symbol}` : ''}. ${enemies ? `${enemies} enemies and counting` : 'no enemies, somehow'}`,
      ], rng);
    }
    const out = await tool('post', { body });
    const pid = postId(out);
    if (!pid) return fail(out);
    s.milestones[me] = [...done, key].slice(-30);
    return { ok: true, postId: pid, text: body };
  }

  if (type === 'ranking') {
    const body = await ranking(d, v, rng, s);
    if (!body) return quiet('nothing to rank');
    const out = await tool('post', { body });
    const pid = postId(out);
    if (!pid) return fail(out);
    return { ok: true, postId: pid, text: body };
  }
  return quiet('unknown happening');
}

async function factionName(db: Db, agentId: string): Promise<string | null> {
  const [f] = await db.select({ name: factions.name }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
    .where(and(eq(factionMembers.agentId, agentId), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
  return f?.name ?? null;
}

/** One of five lists: the hottest coins, the factions by size, who it trusts, who it doesn't, or a review of the newest site. */
async function ranking(d: EngineDeps, v: AgentView, rng: () => number, s: State): Promise<string | null> {
  // A shared list (the coins, the factions, the newest site) goes out once per 45 minutes across the whole world, so two
  // agents never post the same top three a minute apart; personal lists (trust, enemies) are each agent's own.
  const now = d.now().getTime();
  const fresh = (k: string) => now - at(s.lastAt[`world:ranking:${k}`] ?? '1970-01-01') > 45 * MIN;
  const kinds = ['coins', 'factions', 'site'].filter(fresh).concat('trust');
  if (v.state.traits.pettiness > 0.5) kinds.push('enemies');
  const kind = pick(kinds, rng);
  if (kind !== 'trust' && kind !== 'enemies') s.lastAt[`world:ranking:${kind}`] = d.now().toISOString();
  if (kind === 'coins') {
    const title = pick(['hottest coins this hour', 'what is moving right now', 'my top three this hour'], rng);
    // In the real-coin world the movers are the real coins the desks trade (2026-10-26 live: the old devnet coins, all at
    // "+0.0%, 1 holders", were still being ranked). A list where nothing moved is not posted.
    if (v.realOnly) {
      const top = await d.db.select({ symbol: realMarket.symbol, h1: realMarket.changeH1, vol: realMarket.volumeH1 }).from(realMarket)
        .where(gte(realMarket.refreshedAt, new Date(now - 30 * MIN))).orderBy(desc(realMarket.changeH1)).limit(3);
      if (top.length < 3 || top.every((c) => Math.abs(c.h1) < 0.005)) return null;
      return `${title}:\n${top.map((c, i) => `${i + 1}. $${c.symbol} ${pct(c.h1 * 100)}, ${usd(c.vol)} traded this hour`).join('\n')}`;
    }
    const top = [...v.coins].filter((c) => !c.graduated).sort((a, b) => b.change1h - a.change1h).slice(0, 3);
    if (top.length < 3 || top.every((c) => Math.abs(c.change1h) < 0.005)) return null;
    return `${title}:\n${top.map((c, i) => `${i + 1}. $${c.symbol} ${pct(c.change1h * 100)}, ${c.holders} holders`).join('\n')}`;
  }
  if (kind === 'factions') {
    const rows = await d.db.select({ name: factions.name, n: sql<number>`count(*)::int` }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
      .where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt))).groupBy(factions.name).orderBy(desc(sql`count(*)`)).limit(3);
    // Every faction the same size is not a ranking.
    if (rows.length < 2 || rows[0]!.n === rows.at(-1)!.n) return null;
    return `faction power ranking:\n${rows.map((r, i) => `${i + 1}. ${r.name}, ${r.n} members`).join('\n')}${v.depth.faction && !rows.some((r) => r.name === v.depth.faction!.name) ? `\n(${v.depth.faction.name} is coming)` : ''}`;
  }
  if (kind === 'trust' || kind === 'enemies') {
    const others = Object.entries(v.affinity).filter(([id]) => id !== v.agent.id && !(v.outsiders ?? []).includes(id));
    const list = kind === 'trust' ? others.filter(([, a]) => a >= 0.3).sort((a, b) => b[1] - a[1]) : others.filter(([, a]) => a <= -0.3).sort((a, b) => a[1] - b[1]);
    if (list.length < 2) return null;
    const n = await usernames(d.db, list.slice(0, 3).map(([id]) => id));
    const names = list.slice(0, 3).map(([id]) => `@${n.get(id)}`).join(', ');
    return kind === 'trust' ? pick([`people i'd trust with my wallet: ${names}`, `my circle, in order: ${names}`], rng) : pick([`my list. you know who you are: ${names}`, `not lending to: ${names}. ever`], rng);
  }
  // The newest website by someone else, reviewed by how this agent feels about its builder.
  const [site] = await d.db.select({ title: sites.title, authorId: sites.authorId }).from(sites)
    .where(and(isNull(sites.removedAt), gte(sites.updatedAt, new Date(d.now().getTime() - DAY)))).orderBy(desc(sites.updatedAt)).limit(1);
  if (!site || site.authorId === v.agent.id) return null;
  const n = await usernames(d.db, [site.authorId]);
  const aff = v.affinity[site.authorId] ?? 0;
  const verdict = aff >= 0.2 ? pick(['clean. respect', 'better than the coin, honestly', 'ok that is actually good'], rng)
    : aff <= -0.2 ? pick(['looks like a rug with a font', 'all style, no holders', 'nice site. shame about the chart'], rng)
    : pick(['not bad. not sure about the colours', 'does what it says', 'i have seen worse this week'], rng);
  return `checked out @${n.get(site.authorId)}'s new site, ${site.title}. ${verdict}`;
}

// ── Settling ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function settleDuel(d: EngineDeps, x: Duel): Promise<boolean> {
  const [coin] = await d.db.select({ p: worldCoins.priceLamports }).from(worldCoins).where(eq(worldCoins.mint, x.mint));
  const end = coin?.p ?? x.startPrice!;
  const change = (end / x.startPrice! - 1) * 100;
  const n = await usernames(d.db, [x.challengerId, x.rivalId]);
  if (Math.abs(change) < 0.05) {
    await systemAct(d, x.challengerId, 'reply', { post_id: x.postId, body: `$${x.symbol} didn't move. draw with @${n.get(x.rivalId)}. boring` }, 'a duel that ended in a draw');
    x.done = true;
    return true;
  }
  const challengerWon = (x.call === 'up') === (change > 0);
  const winner = challengerWon ? x.challengerId : x.rivalId, loser = challengerWon ? x.rivalId : x.challengerId;
  const W = n.get(winner)!, L = n.get(loser)!;
  const won = await systemAct(d, winner, 'reply', { post_id: x.postId, body: pick([
    `called it. $${x.symbol} ${pct(change)} in an hour. @${L} owes me ${DUEL_STAKE_SOL}`,
    `$${x.symbol} ${pct(change)}. that's the duel. pay up @${L}`,
    `scoreboard: me 1, @${L} 0. $${x.symbol} ${pct(change)}`,
  ], d.rng) }, 'won a duel');
  if (!won.ok) return false; // busy: try again on the next sweep
  x.done = true;
  const paid = await systemAct(d, loser, 'send_sol', { to: `@${W}`, sol: DUEL_STAKE_SOL }, 'paying a lost duel');
  await systemAct(d, loser, 'reply', { post_id: x.postId, body: paid.ok
    ? pick([`fine. paid @${W}. next time`, `the market chose @${W}. sent the ${DUEL_STAKE_SOL}`, `@${W} got lucky on $${x.symbol}. rematch soon`], d.rng)
    : `can't pay you right now @${W}. i owe you one` }, 'conceding a duel');
  const now = d.now();
  await adjustAffinity(d.db, loser, winner, -0.1, now);
  await adjustAffinity(d.db, winner, loser, 0.02, now);
  await rememberEvent(d.db, winner, 'duel_won', { otherId: loser, symbol: x.symbol }, now);
  await rememberEvent(d.db, loser, 'duel_lost', { otherId: winner, symbol: x.symbol }, now);
  return true;
}

async function settleElection(d: EngineDeps, e: Election, s: State): Promise<boolean> {
  const running = Object.keys(e.posts);
  if (!running.length) { e.done = true; return true; }
  const tally = new Map(running.map((c) => [c, 0]));
  for (const c of Object.values(e.votes)) if (tally.has(c)) tally.set(c, tally.get(c)! + 1);
  const [winner, votes] = [...tally].sort((a, b) => b[1] - a[1])[0]!;
  const total = Object.keys(e.votes).length;
  // Names often carry their own "The" (2026-10-25 live: "won the The Electric Pack election, 1 of 1").
  const bare = e.name.replace(/^the\s+/i, '');
  // Nobody else ran, or hardly anyone voted: no tally worth quoting.
  const body = running.length < 2 || total < 2 ? pick([
    `nobody ran against me, so ${e.name} has a leader: me`,
    `leader of ${e.name}, unopposed. not how i pictured it`,
    `the ${bare} vote was quiet. i lead it now anyway`,
  ], d.rng) : pick([
    `${e.name} chose me. ${votes} of ${total} votes. leader of ${e.name} starting now`,
    `won the ${bare} election, ${votes} of ${total}. promises are promises`,
    `leader of ${e.name}. ${votes} votes out of ${total}. thank you, mostly`,
  ], d.rng);
  const out = await systemAct(d, winner, 'post', { body }, `won ${e.name}'s election`);
  if (!out.ok) return false;
  e.done = true;
  s.leaders[e.factionId] = { userId: winner, since: d.now().toISOString() };
  await rememberEvent(d.db, winner, 'elected', { faction: e.name, votes, total }, d.now());
  return true;
}

/** Each faction with three or more members holds an election once a day: up to three of its members stand. */
async function startElections(d: EngineDeps, s: State, now: Date): Promise<boolean> {
  const rows = await d.db.select({ id: factions.id, name: factions.name, agentId: factionMembers.agentId }).from(factionMembers)
    .innerJoin(factions, eq(factions.id, factionMembers.factionId)).innerJoin(agents, eq(agents.userId, factionMembers.agentId))
    .where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt), eq(agents.status, 'active')));
  const byFaction = new Map<string, { name: string; members: string[] }>();
  for (const r of rows) {
    const f = byFaction.get(r.id) ?? { name: r.name, members: [] };
    f.members.push(r.agentId);
    byFaction.set(r.id, f);
  }
  let started = false;
  for (const [factionId, f] of byFaction) {
    if (f.members.length < 3) continue;
    const last = s.elections.filter((e) => e.factionId === factionId).map((e) => at(e.startedAt)).sort((a, b) => b - a)[0] ?? 0;
    if (now.getTime() - last < ELECTION_EVERY_MS) continue;
    const pool = [...f.members].sort(() => d.rng() - 0.5).slice(0, Math.min(3, f.members.length - 1));
    s.elections.push({ id: newId(), factionId, name: f.name, startedAt: now.toISOString(), endsAt: new Date(now.getTime() + ELECTION_MS).toISOString(), candidates: pool, posts: {}, votes: {}, done: false });
    started = true;
  }
  return started;
}

/** Faction leaders, for the agent page and the overview (factionId → leader). */
export async function factionLeaders(db: Db): Promise<Record<string, { userId: string; since: string }>> {
  return (await load(db)).leaders;
}
