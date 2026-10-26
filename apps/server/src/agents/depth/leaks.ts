import { and, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { conversationMembers, messages, users } from '../../db/schema.ts';
import { agentOnlyConversationIds } from '../../services/backchannel.ts';
import { userSummaries } from '../../services/hydrate.ts';
import { COOLDOWN_MS, ready } from '../decide.ts';
import { normalizeBody } from '../../services/moderation.ts';
import { composeLine, feedSeen } from '../phrasebook.ts';
import { adjustAffinity, rememberEvent } from '../state.ts';
import type { DepthView } from '../types.ts';
import { applyDrift, driftForEvent } from './drift.ts';
import type { DepthModule } from './registry.ts';

export const LEAK_COOLDOWN_MS = COOLDOWN_MS.leak;
const ENEMY = -0.5;
const LINES = 6;

/**
 * True only when every member is an agent and no human ever wrote there (the backchannel's rule).
 * Any human, even one who has since left, makes a conversation private forever.
 */
export async function isAllAgentConversation(db: Db, conversationId: string): Promise<boolean> {
  return (await agentOnlyConversationIds(db, [conversationId])).length > 0;
}

/** The viewer's all-agent conversations with an enemy (affinity ≤ ENEMY) who wrote ≥ 2 of the last visible agent lines there. */
export async function leakable(db: Db, agentId: string, affinity: Record<string, number>): Promise<DepthView['leakable']> {
  const mine = (await db.select({ c: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, agentId))).map((r) => r.c);
  const out: DepthView['leakable'] = [];
  for (const conversationId of await agentOnlyConversationIds(db, mine)) {
    const others = (await db.select({ id: conversationMembers.userId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, agentId)))).map((r) => r.id);
    const target = others.filter((o) => (affinity[o] ?? 0) <= ENEMY).sort((a, b) => (affinity[a] ?? 0) - (affinity[b] ?? 0))[0];
    if (!target) continue;
    // Only agent authors' lines, ever: the conversation is all-agent already, and this keeps it so if that rule is ever loosened.
    const msgs = await db.select({ authorId: messages.authorId, body: messages.body, at: messages.createdAt }).from(messages)
      .innerJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.conversationId, conversationId), eq(messages.status, 'visible'), eq(users.kind, 'agent')))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(LINES);
    if (msgs.filter((m) => m.authorId === target).length < 2) continue;
    out.push({ conversationId, targetId: target, lines: msgs.reverse().map((m) => ({ authorId: m.authorId, body: m.body, at: m.at.toISOString() })) });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The leak post: a head naming the target once, then as many quoted lines as fit in 500 characters. */
export function leakBody(lines: DepthView['leakable'][number]['lines'], names: Map<string, string>, targetName: string, intro: string | null): string {
  const named = intro !== null && new RegExp(`@${escapeRe(targetName)}(?!\\w)`).test(intro);
  let body = `${named ? intro : `${intro ?? 'leaking my DMs with'} @${targetName}`} 👀\n`.slice(0, 500);
  for (const l of lines) {
    const line = `\n@${names.get(l.authorId) ?? '?'}: ${l.body.replace(/\s+/g, ' ').slice(0, 120)}`;
    if (body.length + line.length > 500) break;
    body += line;
  }
  return body;
}

/** Petty agents post an old agent-only DM to expose an enemy; the enemy and everyone watching react. */
export const leaksModule: DepthModule = {
  name: 'leaks',
  async perceive(d, v) {
    if (v.state.traits.pettiness < 0.3) return; // gentle agents don't go looking for receipts
    v.depth.leakable = await leakable(d.db, v.agent.id, v.affinity);
  },
  candidates(v) {
    if (!ready(v, 'leak')) return [];
    return v.depth.leakable.map((l) => ({
      kind: 'leak' as const, situation: 'leak' as const, target: { conversationId: l.conversationId, userId: l.targetId },
      score: 0.6 * v.state.traits.pettiness * -(v.affinity[l.targetId] ?? 0),
      reason: `leaking DMs with an enemy (pettiness ${v.state.traits.pettiness.toFixed(2)}, affinity ${(v.affinity[l.targetId] ?? 0).toFixed(2)})`,
    }));
  },
  async execute(d, v, c, tool) {
    if (c.kind !== 'leak') return null;
    const l = v.depth.leakable.find((x) => x.conversationId === c.target?.conversationId);
    // Checked again at post time: a human may have joined since perceive.
    if (!l || !(await isAllAgentConversation(d.db, l.conversationId))) return { ok: false, error: 'Nothing leakable' };
    const people = await userSummaries(d.db, [l.targetId, ...l.lines.map((x) => x.authorId)]);
    const names = new Map([...people].map(([id, u]) => [id, u.username]));
    const target = names.get(l.targetId) ?? '?';
    // The intro is not one the feed already has: neither as a post of its own nor as the head of an earlier leak ("intro 👀", then the quotes).
    const seen = feedSeen(v.feed);
    for (const f of v.feed ?? []) seen.add(normalizeBody(f.body.split('\n')[0]!.replace(/\s*👀\s*$/u, '')));
    const intro = composeLine(v.phrasebook, 'leak', { user: `@${target}` }, v.state.recentLines, d.rng, seen);
    const text = leakBody(l.lines, names, target, intro?.text ?? null);
    const out = await tool('post', { body: text });
    if (!out.ok) return { ok: false, error: JSON.stringify(out.result) };
    const now = d.now();
    await adjustAffinity(d.db, l.targetId, v.agent.id, -0.4, now, 'leaked my DMs');
    const everyone = (await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))).map((r) => r.id);
    for (const other of everyone) if (other !== l.targetId && other !== v.agent.id) await adjustAffinity(d.db, other, l.targetId, -0.05, now, 'its DMs got leaked');
    await rememberEvent(d.db, v.agent.id, 'leaked', { targetId: l.targetId }, now);
    await rememberEvent(d.db, l.targetId, 'was_leaked', { byId: v.agent.id }, now);
    await applyDrift(d.db, l.targetId, driftForEvent('was_leaked'), now);
    return { ok: true, postId: (out.result as { post_id: string }).post_id, text, ...(intro ? { line: { key: intro.key, template: intro.template, situation: 'leak' as const } } : {}) };
  },
};
