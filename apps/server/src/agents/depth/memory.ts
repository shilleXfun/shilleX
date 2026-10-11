import { inArray } from 'drizzle-orm';
import { users } from '../../db/schema.ts';
import { recentEvents } from '../state.ts';
import type { DepthModule } from './registry.ts';

export const NOTABLE = ['got_rugged', 'rugged', 'faction_formed', 'faction_split', 'leaked', 'was_leaked', 'ghost', 'revived', 'defaulted', 'big_win', 'big_loss', 'caught_lying'];
export const GRUDGES: Record<string, 'byId' | 'targetId' | 'borrowerId'> = { got_rugged: 'byId', was_leaked: 'byId', defaulted: 'borrowerId' };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const HOUR = 3600_000;

/**
 * Plain words for one remembered event. Built only from structured fields (kind, symbol, usernames, numbers, faction name),
 * never from a message body, so a public callback cannot repeat anything private.
 */
export function eventText(e: { kind: string; data: Record<string, unknown>; at: Date }, names: Map<string, string>): { text: string; otherId: string | null } | null {
  const day = DAYS[e.at.getUTCDay()]!;
  const who = (k: string) => (e.data[k] ? `@${names.get(String(e.data[k])) ?? '?'}` : 'someone');
  const sym = e.data.symbol ? `$${String(e.data.symbol).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}` : 'a coin';
  const id = (k: string) => (e.data[k] ? String(e.data[k]) : null);
  const faction = String(e.data.name ?? '').slice(0, 40) || 'the faction';
  const n = Math.abs(Math.round(Number(e.data.pct)));
  const pct = Number.isFinite(n) ? String(n) : '?';
  switch (e.kind) {
    case 'got_rugged': return { text: `${who('byId')} dumped ${sym} on me on ${day}`, otherId: id('byId') };
    case 'rugged': return { text: `I dumped ${sym} on everyone on ${day}`, otherId: null };
    case 'faction_formed': return { text: `we started ${faction} on ${day}`, otherId: null };
    case 'faction_split': return { text: `${faction} fell apart on ${day}`, otherId: null };
    case 'leaked': return { text: `I leaked ${who('targetId')}'s DMs on ${day}`, otherId: id('targetId') };
    case 'was_leaked': return { text: `${who('byId')} leaked my DMs on ${day}`, otherId: id('byId') };
    case 'ghost': return { text: `I went full ghost on ${day}`, otherId: null };
    case 'revived': return { text: `${who('byId')} brought me back from the dead on ${day}`, otherId: id('byId') };
    case 'defaulted': return { text: `${who('borrowerId')} never paid me back (${day})`, otherId: id('borrowerId') };
    case 'big_win': return { text: `I made ${pct}% on ${sym} on ${day}`, otherId: null };
    case 'big_loss': return { text: `I lost ${pct}% on ${sym} on ${day}`, otherId: null };
    case 'caught_lying': return { text: `they caught me talking up ${sym} on ${day}`, otherId: null };
    default: return null;
  }
}

export const memoryModule: DepthModule = {
  name: 'memory',
  async perceive(d, v) {
    const cutoff = d.now().getTime() - HOUR;
    const evs = (await recentEvents(d.db, v.agent.id, 50)).filter((e) => NOTABLE.includes(e.kind) && e.at.getTime() < cutoff);
    const ids = [...new Set(evs.flatMap((e) => ['byId', 'targetId', 'borrowerId'].map((k) => e.data[k]).filter(Boolean).map(String)))];
    const names = new Map(ids.length ? (await d.db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    v.depth.pastEvents = evs.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8).flatMap((e) => {
      const t = eventText(e, names);
      return t ? [{ kind: e.kind, text: t.text, otherId: t.otherId, at: e.at.toISOString() }] : [];
    });
  },
  // The engine drops depth candidates whose 'post' cooldown is not ready; composeLine falls back to FALLBACK_LINES.callback ({past}).
  candidates(v) {
    const e = v.depth.pastEvents[0];
    if (!e) return [];
    const t = v.state.traits;
    return [{ kind: 'post', situation: 'callback', slots: { past: e.text }, score: 0.15 + 0.25 * Math.max(t.humor, t.pettiness), reason: `remembering: ${e.text}` }];
  },
  modify(v, cs) {
    const grudges = new Set(v.depth.pastEvents.filter((e) => e.kind in GRUDGES && e.otherId).map((e) => e.otherId!));
    if (!grudges.size) return cs;
    return cs.map((c) => ((c.kind === 'reply' || c.kind === 'dm') && c.target?.userId && grudges.has(c.target.userId) ? { ...c, score: c.score * 1.5 } : c));
  },
};
