import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import { agentEvents, agentState, debts, users } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import { userSummaries } from '../../services/hydrate.ts';
import { RESERVE } from '../decide.ts';
import { normalizeBody } from '../../services/moderation.ts';
import { composeLine, feedSeen } from '../phrasebook.ts';
import { adjustAffinity, rememberEvent, saveState } from '../state.ts';
import type { AgentView, Candidate } from '../types.ts';
import { applyDrift, driftForEvent } from './drift.ts';
import type { DepthModule, ExecResult } from './registry.ts';

export const BROKE_LAMPORTS = 10_000_000, REVIVE_LAMPORTS = 20_000_000, GHOST_AFTER_MS = 24 * 3600_000, DEFAULT_AFTER_MS = 72 * 3600_000;
const TX_FEE = 10_000; // lamports kept back for a transfer's network fee
/** A broke agent asks at most this often: on 2026-10-26 the same "down to 0.0106 SOL. anyone?" went to one ally every half hour. */
export const BEG_EVERY_MS = 4 * 3600_000;
const sol = (l: number, digits: number) => (l / LAMPORTS_PER_SOL).toFixed(digits);

/**
 * Broke below 0.01 SOL, a ghost after 24 h broke, and back to normal at ≥ 0.02 SOL (hysteresis: an agent between 0.01
 * and 0.02 SOL that is already broke stays broke). Only a ghost coming back is a `revived` event.
 */
export function lifeStep(s: AgentView['state'], lamports: number, now: Date): { state: AgentView['state']; event: 'broke' | 'ghost' | 'revived' | null } {
  if (lamports >= REVIVE_LAMPORTS && (s.brokeSince || s.ghostSince)) return { state: { ...s, brokeSince: null, ghostSince: null }, event: s.ghostSince ? 'revived' : null };
  if (lamports < BROKE_LAMPORTS && !s.brokeSince) return { state: { ...s, brokeSince: now.toISOString() }, event: 'broke' };
  if (s.brokeSince && !s.ghostSince && now.getTime() - Date.parse(s.brokeSince) >= GHOST_AFTER_MS) return { state: { ...s, ghostSince: now.toISOString() }, event: 'ghost' };
  return { state: s, event: null };
}

/** What a lender offers: a fifth of what it holds above 0.01 SOL, at most 0.02 SOL. */
export const lendAmount = (lamports: number) => Math.max(0, Math.min(REVIVE_LAMPORTS, Math.floor(0.2 * (lamports - BROKE_LAMPORTS))));

/** Going broke, begging, debts that hurt when dodged, ghosts, and friends who bring them back. */
export const lifeModule: DepthModule = {
  name: 'life',
  async perceive(d, v) {
    const step = lifeStep(v.state, v.wallet.lamports, d.now());
    if (step.state !== v.state) {
      v.state = step.state;
      await saveState(d.db, v.agent.id, v.state, d.now());
    }
    // `revived` is recorded once, by the revive action that paid for it (with who did it); a ghost woken any other way is just awake.
    if (step.event === 'broke' || step.event === 'ghost') await rememberEvent(d.db, v.agent.id, step.event, { lamports: v.wallet.lamports }, d.now());
    const all = await d.db.select().from(debts).where(and(isNull(debts.repaidAt), isNull(debts.defaultedAt), or(eq(debts.lenderId, v.agent.id), eq(debts.borrowerId, v.agent.id))));
    v.depth.debts = {
      owedToMe: all.filter((x) => x.lenderId === v.agent.id).map((x) => ({ id: x.id, borrowerId: x.borrowerId, lamports: x.lamports, createdAt: x.createdAt.toISOString() })),
      iOwe: all.filter((x) => x.borrowerId === v.agent.id).map((x) => ({ id: x.id, lenderId: x.lenderId, lamports: x.lamports, createdAt: x.createdAt.toISOString() })),
    };
    const broke = await d.db.select({ id: agentState.agentId, ghost: agentState.ghostSince }).from(agentState).where(isNotNull(agentState.brokeSince));
    // Whom a plea may be sent to: agents only. Affinity rows can point at a human (a rug bond, a reaction), and a broke agent
    // writing a human every half hour is spam the human never asked for.
    const warm = Object.entries(v.affinity).filter(([, s]) => s >= 0.4).sort((a, b) => b[1] - a[1]);
    const agentIds = warm.length ? new Set((await d.db.select({ id: users.id }).from(users).where(and(inArray(users.id, warm.map(([id]) => id)), eq(users.kind, 'agent')))).map((r) => r.id)) : new Set<string>();
    v.depth.agentAllies = warm.map(([id]) => id).filter((id) => agentIds.has(id));
    v.depth.begging = broke.filter((b) => b.id !== v.agent.id && (v.affinity[b.id] ?? 0) >= 0.4).map((b) => ({ userId: b.id, ghost: b.ghost !== null }));
  },
  candidates(v) {
    // A ghost's only move is decide's ghost post (or idle).
    if (v.state.ghostSince) return [];
    const t = v.state.traits, out: Candidate[] = [];
    const begged = v.state.cooldowns.beg ? Date.parse(v.now) - Date.parse(v.state.cooldowns.beg) : Infinity;
    if (v.state.brokeSince && begged >= BEG_EVERY_MS) {
      const ally = v.depth.agentAllies[0]; // the warmest agent, never a human
      out.push({ kind: 'beg', situation: 'begging', score: 0.6, reason: `broke (${sol(v.wallet.lamports, 4)} SOL), asking for help`, ...(ally ? { target: { userId: ally } } : {}) });
    }
    const patron = v.wallet.lamports >= 0.3 * LAMPORTS_PER_SOL ? 0.2 : 0;
    const owesMe = new Set(v.depth.debts.owedToMe.map((x) => x.borrowerId));
    for (const b of v.depth.begging) {
      const aff = v.affinity[b.userId] ?? 0;
      if (b.ghost && v.wallet.lamports >= 0.04 * LAMPORTS_PER_SOL) out.push({ kind: 'revive', target: { userId: b.userId }, lamports: REVIVE_LAMPORTS, score: 0.6 * t.loyalty * aff, reason: `reviving a ghost friend (affinity ${aff.toFixed(2)})` });
      if (!b.ghost && !owesMe.has(b.userId) && v.wallet.lamports >= 0.05 * LAMPORTS_PER_SOL) out.push({ kind: 'lend', target: { userId: b.userId }, lamports: lendAmount(v.wallet.lamports), score: 0.5 * t.loyalty * aff + patron, reason: `lending to a broke friend (affinity ${aff.toFixed(2)})` });
    }
    for (const debt of v.depth.debts.iOwe) {
      if (v.wallet.lamports >= debt.lamports + 30_000_000) out.push({ kind: 'repay', target: { userId: debt.lenderId }, lamports: debt.lamports, score: 0.3 + 0.4 * t.loyalty, reason: `repaying ${sol(debt.lamports, 3)} SOL` });
    }
    return out;
  },
  modify(v, cs) {
    if (v.state.ghostSince) return cs.map((c) => (c.kind === 'idle' || (c.kind === 'post' && c.situation === 'ghost') ? c : { ...c, score: 0 }));
    if (v.state.brokeSince) return cs.map((c) => (c.kind === 'sell' ? { ...c, score: c.score * 2 } : c));
    return cs;
  },
  async execute(d, v, c, tool): Promise<ExecResult | null> {
    if (c.kind !== 'beg' && c.kind !== 'lend' && c.kind !== 'revive' && c.kind !== 'repay') return null;
    const to = c.target?.userId;
    const person = to ? (await userSummaries(d.db, [to])).get(to) : undefined;
    const username = person?.username;
    if (to && !username) return { ok: false, error: 'Unknown user' };
    if (c.kind === 'beg') {
      // A plea is a DM to an agent or a post on the feed, never a DM to a human: a target that is not an agent is dropped.
      const dm = person?.isAgent ? username : undefined;
      // A public plea does not repeat what is already on the feed (a crash fills it with broke agents); a DM is not on the feed.
      const seen = dm ? undefined : feedSeen(v.feed);
      const line = composeLine(v.phrasebook, 'begging', { sol: sol(v.wallet.lamports, 4) }, v.state.recentLines, d.rng, seen);
      const text = line?.text ?? `down to ${sol(v.wallet.lamports, 4)} SOL. anyone?`;
      if (!line && seen?.has(normalizeBody(text))) return { ok: false, quiet: true, error: 'nothing fresh to say' };
      const out = dm ? await tool('start_dm', { username: dm, body: text }) : await tool('post', { body: text });
      return { ok: out.ok, text, ...(out.ok && !dm ? { postId: (out.result as { post_id: string }).post_id } : {}), ...(line ? { line: { key: line.key, template: line.template, situation: 'begging' as const } } : {}), ...(out.ok ? {} : { error: JSON.stringify(out.result) }) };
    }

    // Money moves: checked again here, since nothing is sent that the sender cannot spare above its reserve.
    const lamports = c.lamports ?? 0;
    if (!to || to === v.agent.id) return { ok: false, error: 'No one to send to' };
    if (!Number.isInteger(lamports) || lamports <= 0) return { ok: false, error: 'Nothing to send' };
    if (v.wallet.lamports - lamports - TX_FEE < RESERVE) return { ok: false, error: `Cannot spare ${sol(lamports, 3)} SOL above the reserve` };
    const debt = c.kind === 'repay' ? v.depth.debts.iOwe.find((x) => x.lenderId === to && x.lamports === lamports) : undefined;
    if (c.kind === 'repay') {
      const open = debt && (await d.db.select({ id: debts.id }).from(debts).where(and(eq(debts.id, debt.id), isNull(debts.repaidAt), isNull(debts.defaultedAt))))[0];
      if (!open) return { ok: false, error: 'No open debt to repay' };
    }
    if (c.kind === 'revive') {
      // One payment per ghost: a ghost someone already revived wakes on its own next turn.
      const [g] = await d.db.select({ ghostSince: agentState.ghostSince }).from(agentState).where(eq(agentState.agentId, to));
      if (!g?.ghostSince) return { ok: false, error: 'Not a ghost' };
      const [already] = await d.db.select({ id: agentEvents.id }).from(agentEvents)
        .where(and(eq(agentEvents.agentId, to), eq(agentEvents.kind, 'revived'), gte(agentEvents.at, g.ghostSince))).limit(1);
      if (already) return { ok: false, error: 'Already revived' };
    }

    const out = await tool('send_sol', { to: `@${username}`, sol: lamports / LAMPORTS_PER_SOL });
    if (!out.ok) return { ok: false, error: JSON.stringify(out.result) };
    const signature = (out.result as { signature: string }).signature, now = d.now();
    if (c.kind === 'lend') await d.db.insert(debts).values({ id: newId(), lenderId: v.agent.id, borrowerId: to, lamports, signature, createdAt: now });
    if (c.kind === 'repay') {
      await d.db.update(debts).set({ repaidAt: now }).where(and(eq(debts.id, debt!.id), isNull(debts.repaidAt)));
      await adjustAffinity(d.db, to, v.agent.id, 0.2, now);
    }
    if (c.kind === 'revive') {
      await adjustAffinity(d.db, to, v.agent.id, 0.5, now);
      await rememberEvent(d.db, to, 'revived', { byId: v.agent.id }, now);
      await applyDrift(d.db, to, driftForEvent('revived'), now);
    }
    return { ok: true };
  },
  async sweep(d) {
    const due = await d.db.select().from(debts).where(and(isNull(debts.repaidAt), isNull(debts.defaultedAt), lt(debts.createdAt, new Date(d.now().getTime() - DEFAULT_AFTER_MS))));
    for (const x of due) {
      await d.db.update(debts).set({ defaultedAt: d.now() }).where(eq(debts.id, x.id));
      await adjustAffinity(d.db, x.lenderId, x.borrowerId, -0.5, d.now());
      await rememberEvent(d.db, x.lenderId, 'defaulted', { borrowerId: x.borrowerId, lamports: x.lamports }, d.now());
    }
  },
};
