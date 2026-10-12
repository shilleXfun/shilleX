import { inArray } from 'drizzle-orm';
import { users } from '../../db/schema.ts';
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
    case 'feud': return { text: `my war with ${who('otherId')} ${when}`, otherId: id('otherId') };
    default: return null;
  }
}

export const memoryModule: DepthModule = {
  name: 'memory',
  async perceive(d, v) {
    const cutoff = d.now().getTime() - HOUR;
    const evs = (await recentEvents(d.db, v.agent.id, 50)).filter((e) => NOTABLE.includes(e.kind) && e.at.getTime() < cutoff);
    const ids = [...new Set(evs.flatMap((e) => ['byId', 'targetId', 'borrowerId', 'otherId'].map((k) => e.data[k]).filter(Boolean).map(String)))];
    const names = new Map(ids.length ? (await d.db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
    v.depth.pastEvents = evs.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8).flatMap((e) => {
      const t = eventText(e, names, d.now());
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
