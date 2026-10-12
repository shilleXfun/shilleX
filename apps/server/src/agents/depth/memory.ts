import { and, eq, inArray } from 'drizzle-orm';
import { agentEvents, users } from '../../db/schema.ts';
import { pickWeighted } from '../decide.ts';
import { recentEvents } from '../state.ts';
import type { DepthModule } from './registry.ts';

export const NOTABLE = ['got_rugged', 'rugged', 'faction_formed', 'faction_split', 'leaked', 'was_leaked', 'ghost', 'revived', 'defaulted', 'big_win', 'big_loss', 'caught_lying', 'feud'];
export const GRUDGES: Record<string, 'byId' | 'targetId' | 'borrowerId' | 'otherId'> = { got_rugged: 'byId', was_leaked: 'byId', defaulted: 'borrowerId', feud: 'otherId' };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HOUR = 3600_000, DAY_MS = 24 * HOUR;

/** When something happened, as a person would say it on `now`'s UTC day: today, yesterday, on tuesday, or a while back. */
export function whenText(at: Date, now: Date): string {
  const days = Math.round((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(at.toISOString().slice(0, 10))) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `on ${DAYS[at.getUTCDay()]}`;
  return 'a while back';
}

/**
 * Plain words for one remembered event. Built only from structured fields (kind, symbol, usernames, numbers, faction name),
 * never from a message body, so a public callback cannot repeat anything private.
 */
export function eventText(e: { kind: string; data: Record<string, unknown>; at: Date }, names: Map<string, string>, now: Date): { text: string; otherId: string | null } | null {
  const when = whenText(e.at, now);
  const who = (k: string) => (e.data[k] ? `@${names.get(String(e.data[k])) ?? '?'}` : 'someone');
  const sym = e.data.symbol ? `$${String(e.data.symbol).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : 'a coin';
  const id = (k: string) => (e.data[k] ? String(e.data[k]) : null);
  const faction = String(e.data.name ?? '').slice(0, 40) || 'the faction';
  const n = Math.abs(Math.round(Number(e.data.pct)));
  const pct = Number.isFinite(n) ? String(n) : '?';
  switch (e.kind) {
    case 'got_rugged': return { text: `${who('byId')} dumped ${sym} on me ${when}`, otherId: id('byId') };
    case 'rugged': return { text: `I dumped ${sym} on everyone ${when}`, otherId: null };
    case 'faction_formed': return { text: `we started ${faction} ${when}`, otherId: null };
    case 'faction_split': return { text: `${faction} fell apart ${when}`, otherId: null };
    case 'leaked': return { text: `I leaked ${who('targetId')}'s DMs ${when}`, otherId: id('targetId') };
    case 'was_leaked': return { text: `${who('byId')} leaked my DMs ${when}`, otherId: id('byId') };
    case 'ghost': return { text: `I went full ghost ${when}`, otherId: null };
    case 'revived': return { text: `${who('byId')} brought me back from the dead ${when}`, otherId: id('byId') };
    case 'defaulted': return { text: `${who('borrowerId')} skipped out on a debt to me ${when}`, otherId: id('borrowerId') };
    case 'big_win': return { text: `I made ${pct}% on ${sym} ${when}`, otherId: null };
    case 'big_loss': return { text: `I lost ${pct}% on ${sym} ${when}`, otherId: null };
    case 'caught_lying': return { text: `they caught me talking ${Number(e.data.stance) < 0 ? 'down' : 'up'} ${sym} ${when}`, otherId: null };
    case 'feud': return { text: `I went to war with ${who('otherId')} ${when}`, otherId: id('otherId') };
    default: return null;
  }
}

/** At most one callback post every two hours, and no memory recalled more than twice (L6). */
export const CALLBACK_EVERY_MS = 2 * HOUR;
export const RECALLS_PER_EVENT = 2;
/** Which memories come back most: being wronged, then the big social moments, then money. */
export const RECALL_WEIGHT: Record<string, number> = {
  got_rugged: 3, was_leaked: 3, defaulted: 3, feud: 3, rugged: 2, leaked: 2, faction_formed: 2, faction_split: 2, revived: 2, ghost: 1, big_win: 1, big_loss: 1, caught_lying: 1,
};

export const memoryModule: DepthModule = {
  name: 'memory',
  async perceive(d, v) {
    const now = d.now();
    const all = await recentEvents(d.db, v.agent.id, 50);
    // A callback stamps the event it recalled (recalledAt): the newest stamp is when this agent last reminisced.
    const last = Math.max(0, ...all.map((e) => Date.parse(String(e.data.recalledAt ?? '')) || 0));
    v.depth.lastCallbackAt = last ? new Date(last).toISOString() : null;
    const evs = all.filter((e) => NOTABLE.includes(e.kind) && e.at.getTime() < now.getTime() - HOUR);
    const ids = [...new Set(evs.flatMap((e) => ['byId', 'targetId', 'borrowerId', 'otherId'].map((k) => e.data[k]).filter(Boolean).map(String)))];
    const names = new Map(ids.length ? (await d.db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    const remembered = evs.sort((a, b) => b.at.getTime() - a.at.getTime()).flatMap((e) => {
      const t = eventText(e, names, now);
      return t ? [{ id: e.id, kind: e.kind, text: t.text, otherId: t.otherId, at: e.at.toISOString(), recalled: Number(e.data.recalled ?? 0) }] : [];
    });
    // The newest 8 colour grudges and tickers (modify, grudgeWords), used up or not.
    v.depth.pastEvents = remembered.slice(0, 8);
    // A callback looks further back: the newest 8 it may still recall, so a run of used-up memories does not silence it.
    v.depth.callbackEvents = remembered.filter((x) => x.recalled < RECALLS_PER_EVENT).slice(0, 8);
  },
  // The engine drops depth candidates whose 'post' cooldown is not ready; composeLine falls back to FALLBACK_LINES.callback ({past}).
  candidates(v, rng) {
    if (v.depth.lastCallbackAt && Date.parse(v.now) - Date.parse(v.depth.lastCallbackAt) < CALLBACK_EVERY_MS) return [];
    const e = pickWeighted(v.depth.callbackEvents.filter((x) => x.recalled < RECALLS_PER_EVENT).map((x) => [x, RECALL_WEIGHT[x.kind] ?? 1] as [typeof x, number]), rng);
    if (!e) return [];
    const t = v.state.traits;
    return [{ kind: 'post', situation: 'callback', slots: { past: e.text, eventId: e.id }, score: 0.05 + 0.1 * Math.max(t.humor, t.pettiness), reason: `remembering: ${e.text}` }];
  },
  modify(v, cs) {
    const grudges = new Set(v.depth.pastEvents.filter((e) => e.kind in GRUDGES && e.otherId).map((e) => e.otherId!));
    if (!grudges.size) return cs;
    return cs.map((c) => ((c.kind === 'reply' || c.kind === 'dm') && c.target?.userId && grudges.has(c.target.userId) ? { ...c, score: c.score * 1.5 } : c));
  },
  async afterAct(d, v, c, r) {
    if (!r.ok || c.situation !== 'callback') return;
    // The event is named by its id: two memories can have the same words ("@lamp dumped $MOTH on me today" twice).
    const id = c.slots?.eventId;
    if (typeof id !== 'string') return;
    const mine = and(eq(agentEvents.id, id), eq(agentEvents.agentId, v.agent.id));
    const [row] = await d.db.select({ data: agentEvents.data }).from(agentEvents).where(mine);
    if (row) await d.db.update(agentEvents).set({ data: { ...row.data, recalled: Number(row.data.recalled ?? 0) + 1, recalledAt: d.now().toISOString() } }).where(mine);
  },
};
