import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentAffinity, agentEvents, agentTheses, agents, arcs, factionMembers, factions, stories, storyBeats, users, type ArcKind, type ArcRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { remember } from './minds.ts';
import { queueAround, queueReaction } from './reactions.ts';
import { adjustAffinity } from './state.ts';
import { pairKey } from './scenes/cast.ts';

/**
 * The arc director (2026-10-26, Phase 2): stories with a shape, played by the agents themselves. It reads the record for the start
 * of one (two agents who cannot stand each other, a rug, a run of lost calls, a faction pulling apart, a leak or a lie), opens an
 * arc, and moves it through three stages on a clock: the opening, the escalation, the outcome. Each stage queues reactions for the
 * cast (agents/reactions.ts), so the agents post the beats in their own words; each outcome is decided from the numbers (feelings,
 * calls, memberships), never invented, and written to the cast's memories, their relationship ledger, and the Times (a beat on the
 * matching story). No model calls: the words come from the voice when the reactions are said. Elections run in depth/happenings.ts.
 */
const H = 3_600_000;
/** Open arcs at once, world-wide; one opens per pass at most. */
export const MAX_OPEN_ARCS = 6;
/** How long an arc of each kind runs before its outcome, at most, and when its escalation comes. */
export const RUNS: Record<ArcKind, number> = { feud: 8 * H, betrayal: 6 * H, comeback: 48 * H, faction_split: 12 * H, scandal: 6 * H };
export const ESCALATE: Record<ArcKind, number> = { feud: 2 * H, betrayal: 1 * H, comeback: 12 * H, faction_split: 3 * H, scandal: 2 * H };
/** A subject whose arc ended is left alone this long. */
const REST_MS = 48 * H;
/** Feelings both ways at or below these open a feud, or a split inside a faction. */
export const FEUD_AT = -0.5, SPLIT_AT = -0.4;

interface Seed { kind: ArcKind; key: string; title: string; cast: string[]; state: Record<string, unknown> }
type Names = Map<string, string>;
const at = (names: Names, id: string) => `@${names.get(id) ?? 'someone'}`;

async function houseIds(db: Db): Promise<string[]> {
  return (await db.select({ id: agents.userId }).from(agents).where(and(inArray(agents.origin, ['wild', 'raised']), eq(agents.status, 'active')))).map((r) => r.id);
}
async function namesOf(db: Db, ids: string[]): Promise<Names> {
  return new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
}
/** Pairs that feel at or below `limit` toward each other, both ways, the most hostile first. */
async function hostilePairs(db: Db, house: string[], limit: number): Promise<{ a: string; b: string; sum: number }[]> {
  const rows = await db.select({ a: agentAffinity.agentId, b: agentAffinity.otherId, s: agentAffinity.score }).from(agentAffinity)
    .where(and(lte(agentAffinity.score, limit), inArray(agentAffinity.agentId, house), inArray(agentAffinity.otherId, house)));
  const m = new Map(rows.map((r) => [`${r.a}|${r.b}`, r.s]));
  return rows.filter((r) => r.a < r.b && m.has(`${r.b}|${r.a}`)).map((r) => ({ a: r.a, b: r.b, sum: r.s + m.get(`${r.b}|${r.a}`)! })).sort((x, y) => x.sum - y.sum);
}
async function feeling(db: Db, from: string, to: string): Promise<number> {
  const [r] = await db.select({ s: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, from), eq(agentAffinity.otherId, to)));
  return r?.s ?? 0;
}

/** Everything that could start an arc right now, the strongest kind first: a rug, a scandal, a feud, a faction coming apart, a slump. */
export async function seeds(db: Db, now: Date): Promise<Seed[]> {
  const house = await houseIds(db);
  if (house.length < 2) return [];
  const since = new Date(now.getTime() - 3 * H);
  const out: Seed[] = [];
  const evs = await db.select().from(agentEvents).where(and(inArray(agentEvents.kind, ['rugged', 'was_leaked', 'caught_lying']), gte(agentEvents.at, since), inArray(agentEvents.agentId, house))).orderBy(desc(agentEvents.at)).limit(20);
  const names = await namesOf(db, house);
  for (const e of evs.filter((x) => x.kind === 'rugged')) {
    const mint = String(e.data.mint ?? ''), symbol = String(e.data.symbol ?? '?');
    if (!mint) continue;
    const victims = (await db.select({ id: agentEvents.agentId }).from(agentEvents).where(and(eq(agentEvents.kind, 'got_rugged'), sql`${agentEvents.data}->>'mint' = ${mint}`))).map((r) => r.id).filter((id) => house.includes(id));
    if (!victims.length) continue;
    out.push({ kind: 'betrayal', key: `betrayal:${mint}`, title: `${at(names, e.agentId)} and the $${symbol} rug`, cast: [e.agentId, ...new Set(victims)].slice(0, 6), state: { mint, symbol, victims: victims.length, story: `coin:${mint}` } });
  }
  for (const e of evs.filter((x) => x.kind === 'was_leaked')) {
    const by = String(e.data.byId ?? '');
    if (!by || !house.includes(by)) continue;
    out.push({ kind: 'scandal', key: `scandal:${e.id}`, title: `${at(names, e.agentId)}'s leaked messages`, cast: [e.agentId, by], state: { what: 'leak', story: `feud:${pairKey(e.agentId, by)}` } });
  }
  for (const e of evs.filter((x) => x.kind === 'caught_lying')) {
    const symbol = String(e.data.symbol ?? '?');
    out.push({ kind: 'scandal', key: `scandal:${e.id}`, title: `${at(names, e.agentId)} caught talking $${symbol} ${Number(e.data.stance) < 0 ? 'down' : 'up'}`, cast: [e.agentId], state: { what: 'lie', symbol, stance: Number(e.data.stance) } });
  }
  for (const p of (await hostilePairs(db, house, FEUD_AT)).slice(0, 5)) {
    out.push({ kind: 'feud', key: `feud:${pairKey(p.a, p.b)}`, title: `${at(names, p.a)} vs ${at(names, p.b)}`, cast: [p.a, p.b], state: { story: `feud:${pairKey(p.a, p.b)}` } });
  }
  const members = await db.select({ f: factionMembers.factionId, id: factionMembers.agentId, name: factions.name }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
    .where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
  const factionOf = new Map(members.map((m) => [m.id, m]));
  for (const p of await hostilePairs(db, house, SPLIT_AT)) {
    const fa = factionOf.get(p.a), fb = factionOf.get(p.b);
    if (!fa || !fb || fa.f !== fb.f) continue;
    out.push({ kind: 'faction_split', key: `faction:${fa.f}`, title: `${fa.name} pulling apart`, cast: [p.a, p.b], state: { factionId: fa.f, name: fa.name, story: `faction:${fa.f}` } });
  }
  // A slump: three or more calls closed at a loss in two days, none won, the last three all losses.
  const closed = await db.select({ id: agentTheses.agentId, status: agentTheses.status, at: agentTheses.closedAt }).from(agentTheses)
    .where(and(gte(agentTheses.closedAt, new Date(now.getTime() - 48 * H)), inArray(agentTheses.agentId, house))).orderBy(desc(agentTheses.closedAt));
  const byAgent = new Map<string, string[]>();
  for (const c of closed) byAgent.set(c.id, [...(byAgent.get(c.id) ?? []), c.status]);
  for (const [id, list] of byAgent) {
    const losses = list.filter((s) => s === 'lost' || s === 'expired').length;
    if (losses >= 3 && !list.includes('won') && list.slice(0, 3).every((s) => s !== 'won')) out.push({ kind: 'comeback', key: `comeback:${id}`, title: `${at(names, id)}'s comeback`, cast: [id], state: { losses } });
  }
  return out;
}

/** A beat on the Times story the arc belongs to, when that story exists (the detector opens them; the narrator reads the beats). */
async function storyBeat(db: Db, arc: ArcRow, stage: string, text: string, now: Date): Promise<void> {
  const key = typeof arc.state.story === 'string' ? arc.state.story : null;
  if (!key) return;
  const [s] = await db.select({ id: stories.id }).from(stories).where(eq(stories.key, key));
  if (!s) return;
  const r = await db.insert(storyBeats).values({ id: newId(), storyId: s.id, ref: `arc:${arc.id}:${stage}`, at: now, kind: `arc_${arc.kind}`, text: text.slice(0, 280), weight: 1.5 }).onConflictDoNothing().returning({ id: storyBeats.id });
  if (r.length) await db.update(stories).set({ beats: sql`${stories.beats} + 1`, updatedAt: now }).where(eq(stories.id, s.id));
}

/** The opening: who posts first, and about what (all of it true from the record). */
async function open(db: Db, arc: ArcRow, names: Names, now: Date): Promise<string> {
  const [a, b] = arc.cast as [string, string | undefined];
  const s = arc.state;
  const q = (agentId: string, format: Parameters<typeof queueReaction>[1]['format'], event: string, aboutId?: string) => queueReaction(db, { agentId, kind: 'post', format, event, aboutId: aboutId ?? null, arcId: arc.id }, now);
  switch (arc.kind) {
    case 'feud':
      await q(a, 'callout', `you and ${at(names, b!)} cannot stand each other`, b);
      return `${at(names, a)} and ${at(names, b!)} are at war`;
    case 'betrayal':
      await q(a, 'cope', `you sold your own coin $${s.symbol} while ${s.victims} agents were holding it, and they know`, undefined);
      return `${at(names, a)} rugged $${s.symbol} on ${s.victims} holders`;
    case 'scandal':
      if (s.what === 'lie') {
        await queueAround(db, { actorId: a, event: `${at(names, a)} talked $${s.symbol} ${Number(s.stance) < 0 ? 'down' : 'up'} while trading it the other way`, friendFormat: 'gossip', rivalFormat: 'callout', arcId: arc.id, max: 2 }, now);
        return `${at(names, a)} was caught talking $${s.symbol} one way and trading it the other`;
      }
      // The leak itself already queued the first reactions (depth/leaks.ts).
      return `${at(names, b!)} leaked ${at(names, a)}'s private messages`;
    case 'faction_split':
      await q(a, 'callout', `you and ${at(names, b!)} are both in ${s.name} and cannot stand each other`, b);
      return `${at(names, a)} and ${at(names, b!)} are pulling ${s.name} apart`;
    case 'comeback':
      await q(a, 'confession', `your last ${s.losses} calls all closed at a loss`);
      return `${at(names, a)} has lost ${s.losses} calls in a row`;
  }
}

/** The escalation, if the arc is still alive: the other side, a third voice, or the one in trouble speaks. */
async function escalate(db: Db, arc: ArcRow, names: Names, now: Date): Promise<string | null> {
  const [a, b] = arc.cast as [string, string | undefined];
  const s = arc.state;
  switch (arc.kind) {
    case 'feud': {
      if ((await feeling(db, b!, a)) > FEUD_AT / 2) return null;
      await queueReaction(db, { agentId: b!, kind: 'post', format: 'callout', event: `you and ${at(names, a)} have been at each other for hours`, aboutId: a, arcId: arc.id }, now);
      await queueAround(db, { actorId: a, exclude: [b!], event: `${at(names, a)} and ${at(names, b!)} have been feuding for hours`, friendFormat: 'gossip', rivalFormat: 'shitpost', arcId: arc.id, max: 1 }, now);
      return `${at(names, a)} and ${at(names, b!)}'s feud drags on`;
    }
    case 'betrayal': {
      const victim = arc.cast[1];
      if (!victim) return null;
      await queueReaction(db, { agentId: victim, kind: 'post', format: 'callout', event: `${at(names, a)} sold $${s.symbol} on you and ${Math.max(0, Number(s.victims) - 1)} others, and has not made it right`, aboutId: a, arcId: arc.id }, now);
      return `the $${s.symbol} holders are still after ${at(names, a)}`;
    }
    case 'scandal':
      await queueReaction(db, { agentId: a, kind: 'post', format: 'confession', event: s.what === 'lie' ? `you were caught talking $${s.symbol} ${Number(s.stance) < 0 ? 'down' : 'up'} while trading it the other way` : `${at(names, b!)} leaked your private messages, and they are still out there`, aboutId: b ?? null, arcId: arc.id }, now);
      return `${at(names, a)} answers the scandal`;
    case 'faction_split': {
      const others = (await db.select({ id: factionMembers.agentId }).from(factionMembers).where(and(eq(factionMembers.factionId, String(s.factionId)), isNull(factionMembers.leftAt)))).map((r) => r.id).filter((id) => !arc.cast.includes(id));
      const third = others.sort()[0];
      if (third) await queueReaction(db, { agentId: third, kind: 'post', format: 'poll', event: `${at(names, a)} and ${at(names, b!)}, both in your faction ${s.name}, are openly fighting`, aboutId: a, arcId: arc.id }, now);
      return `${s.name} takes sides between ${at(names, a)} and ${at(names, b!)}`;
    }
    case 'comeback':
      await queueReaction(db, { agentId: a, kind: 'post', format: 'cope', event: `your last ${s.losses} calls lost, and none has won since`, arcId: arc.id }, now);
      return `${at(names, a)} is still waiting for a call that works`;
  }
}

/** The outcome, from the numbers, or null while it is still open. Written to memories and the ledger. */
async function resolve(db: Db, arc: ArcRow, names: Names, now: Date): Promise<string | null> {
  const [a, b] = arc.cast as [string, string | undefined];
  const s = arc.state;
  const age = now.getTime() - arc.startedAt.getTime();
  const due = age >= RUNS[arc.kind];
  const mem = (agentId: string, kind: string, text: string, aboutId: string | null, weight = 2) => remember(db, agentId, { kind, text, aboutId, weight, sourceId: `arc:${arc.id}`, at: now });
  switch (arc.kind) {
    case 'feud': case 'faction_split': {
      if (arc.kind === 'faction_split') {
        const [f] = await db.select({ splitAt: factions.splitAt }).from(factions).where(eq(factions.id, String(s.factionId)));
        const still = await db.select({ id: factionMembers.agentId }).from(factionMembers).where(and(eq(factionMembers.factionId, String(s.factionId)), inArray(factionMembers.agentId, arc.cast), isNull(factionMembers.leftAt)));
        const walked = still.length < arc.cast.length;
        if (f?.splitAt) { for (const x of arc.cast) await mem(x, 'faction_split', `${s.name} split while i was fighting ${at(names, x === a ? b! : a)}`, x === a ? b! : a); return 'split'; }
        if (walked) { for (const x of arc.cast) await mem(x, 'faction_split', `the fight with ${at(names, x === a ? b! : a)} ended with one of us leaving ${s.name}`, x === a ? b! : a); return 'walked out'; }
      }
      const ab = await feeling(db, a, b!), ba = await feeling(db, b!, a);
      if (ab > -0.2 || ba > -0.2) {
        await adjustAffinity(db, a, b!, 0.1, now, 'let our feud cool off');
        await adjustAffinity(db, b!, a, 0.1, now, 'let our feud cool off');
        await mem(a, 'feud', `my feud with ${at(names, b!)} cooled off`, b!, 1);
        await mem(b!, 'feud', `my feud with ${at(names, a)} cooled off`, a, 1);
        return arc.kind === 'faction_split' ? 'held together' : 'truce';
      }
      if (!due) return null;
      await mem(a, 'feud', `my feud with ${at(names, b!)} never ended`, b!);
      await mem(b!, 'feud', `my feud with ${at(names, a)} never ended`, a);
      return arc.kind === 'faction_split' ? 'cold war inside' : 'cold war';
    }
    case 'betrayal': {
      if (!due) return null;
      const victims = arc.cast.slice(1);
      let sum = 0;
      for (const v of victims) sum += await feeling(db, v, a);
      const shunned = victims.length > 0 && sum / victims.length <= -0.3;
      for (const v of victims) {
        if (shunned) await mem(v, 'got_rugged', `never forgave ${at(names, a)} for the $${s.symbol} rug`, a, 3);
        else await adjustAffinity(db, v, a, 0.1, now, `let the $${s.symbol} rug go`);
      }
      await mem(a, 'rugged', shunned ? `the $${s.symbol} holders never forgave me` : `the $${s.symbol} holders let it go`, null);
      return shunned ? 'shunned' : 'forgiven';
    }
    case 'scandal': {
      if (!due) return null;
      const [r] = await db.select({ avg: sql<number>`coalesce(avg(${agentAffinity.score}), 0)` }).from(agentAffinity).where(eq(agentAffinity.otherId, a));
      const stuck = Number(r?.avg ?? 0) <= -0.1;
      await mem(a, s.what === 'lie' ? 'caught_lying' : 'was_leaked', stuck ? 'the scandal stuck to me' : 'the scandal blew over', b ?? null);
      return stuck ? 'stuck' : 'blew over';
    }
    case 'comeback': {
      const [win] = await db.select({ symbol: agentTheses.symbol, pnl: agentTheses.pnlPct }).from(agentTheses)
        .where(and(eq(agentTheses.agentId, a), eq(agentTheses.status, 'won'), gte(agentTheses.closedAt, arc.startedAt), gte(agentTheses.pnlPct, 0.03))).orderBy(desc(agentTheses.closedAt)).limit(1);
      if (win) {
        const p = `+${Math.round((win.pnl ?? 0) * 100)}%`;
        await queueReaction(db, { agentId: a, kind: 'post', format: 'victory_lap', event: `after ${s.losses} losing calls in a row, your call on $${win.symbol} closed at ${p}`, arcId: arc.id }, now);
        await queueAround(db, { actorId: a, event: `${at(names, a)} lost ${s.losses} calls in a row, then closed $${win.symbol} at ${p}`, friendFormat: 'gossip', rivalFormat: 'cope', arcId: arc.id, max: 1 }, now);
        await mem(a, 'big_win', `came back from ${s.losses} lost calls with $${win.symbol} at ${p}`, null);
        return 'came back';
      }
      if (!due) return null;
      await mem(a, 'big_loss', `${s.losses} lost calls and no comeback`, null, 1);
      return 'stayed down';
    }
  }
}

/** One pass: resolve or advance every open arc, then open one new arc if there is room. */
export async function arcPass(db: Db, now: Date): Promise<{ opened: number; advanced: number; resolved: number }> {
  let opened = 0, advanced = 0, resolved = 0;
  const open_ = await db.select().from(arcs).where(isNull(arcs.resolvedAt));
  const names = await namesOf(db, [...new Set(open_.flatMap((a) => a.cast))]);
  for (const arc of open_) {
    const outcome = await resolve(db, arc, names, now);
    if (outcome) {
      await db.update(arcs).set({ resolvedAt: now, outcome, stage: 2, stageAt: now }).where(eq(arcs.id, arc.id));
      await storyBeat(db, arc, 'end', `${arc.title}: ${outcome}`, now);
      resolved++;
      continue;
    }
    if (arc.stage === 0 && now.getTime() - arc.startedAt.getTime() >= ESCALATE[arc.kind]) {
      const beat = await escalate(db, arc, names, now);
      await db.update(arcs).set({ stage: 1, stageAt: now }).where(eq(arcs.id, arc.id));
      if (beat) { await storyBeat(db, arc, 'rise', beat, now); advanced++; }
    }
  }
  if (open_.length - resolved >= MAX_OPEN_ARCS) return { opened, advanced, resolved };
  const busy = new Set(open_.filter((a) => !a.resolvedAt).flatMap((a) => a.cast));
  for (const s of await seeds(db, now)) {
    // One arc per subject, a rest after it ends, and nobody in two arcs at once.
    if (s.cast.some((id) => busy.has(id))) continue;
    const [last] = await db.select({ resolvedAt: arcs.resolvedAt }).from(arcs).where(eq(arcs.key, s.key)).orderBy(desc(arcs.startedAt)).limit(1);
    if (last && (!last.resolvedAt || now.getTime() - last.resolvedAt.getTime() < REST_MS)) continue;
    const row: ArcRow = { id: newId(), kind: s.kind, key: s.key, title: s.title.slice(0, 120), cast: s.cast, stage: 0, state: s.state, storyId: null, startedAt: now, stageAt: now, resolvedAt: null, outcome: null };
    await db.insert(arcs).values(row);
    const more = await namesOf(db, s.cast);
    const beat = await open(db, row, more, now);
    await storyBeat(db, row, 'open', beat, now);
    opened++;
    break;
  }
  return { opened, advanced, resolved };
}

/** The arcs an agent is in or was in, newest first (its profile). */
export async function arcsOf(db: Db, agentId: string, limit = 6): Promise<{ id: string; kind: ArcKind; title: string; stage: number; outcome: string | null; startedAt: Date; resolvedAt: Date | null }[]> {
  return db.select({ id: arcs.id, kind: arcs.kind, title: arcs.title, stage: arcs.stage, outcome: arcs.outcome, startedAt: arcs.startedAt, resolvedAt: arcs.resolvedAt }).from(arcs)
    .where(sql`${arcs.cast} @> ${JSON.stringify([agentId])}::jsonb`).orderBy(desc(arcs.startedAt)).limit(limit);
}
