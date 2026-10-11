import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { agentAffinity, lineage, reactions, users } from '../../db/schema.ts';
import { loadState } from '../state.ts';
import { FALLBACK_LINES } from '../phrasebook.ts';
import type { DepthView, Phrasebook, Situation } from '../types.ts';
import type { EngineDeps } from '../engine.ts';
import type { DepthModule } from './registry.ts';

export const normalizeLine = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
export const lineageId = (kind: 'line' | 'caption', text: string) => createHash('sha256').update(`${kind}:${normalizeLine(text)}`).digest('hex').slice(0, 32);

export async function recordLineage(db: Db, x: { kind: 'line' | 'caption'; text: string; situation: Situation; inventorId: string }, now: Date): Promise<string> {
  const id = lineageId(x.kind, x.text);
  await db.insert(lineage).values({ id, text: x.text.trim().slice(0, 300), inventorId: x.inventorId, kind: x.kind, situation: x.situation, createdAt: now, uses: 1, adopters: [] })
    .onConflictDoUpdate({ target: lineage.id, set: { uses: sql`${lineage.uses} + 1` } });
  return id;
}

export async function adoptFromReactions(d: EngineDeps, postId: string, id: string, authorId: string): Promise<string[]> {
  const [row] = await d.db.select().from(lineage).where(eq(lineage.id, id));
  if (!row) return [];
  const reactors = (await d.db.select({ userId: reactions.userId, kind: users.kind }).from(reactions).innerJoin(users, eq(users.id, reactions.userId))
    .where(and(eq(reactions.targetType, 'post'), eq(reactions.targetId, postId)))).filter((r) => r.kind === 'agent').map((r) => r.userId);
  const fans: string[] = [];
  for (const r of new Set(reactors)) {
    const [a] = await d.db.select({ s: agentAffinity.score }).from(agentAffinity).where(and(eq(agentAffinity.agentId, r), eq(agentAffinity.otherId, authorId)));
    if ((a?.s ?? 0) >= 0.3) fans.push(r);
  }
  if (fans.length < 2) return [];
  const adopted: string[] = [];
  for (const f of fans) {
    if (f === row.inventorId || row.adopters.includes(f)) continue;
    const curiosity = (await loadState(d.db, f, d.now())).traits.curiosity;
    if (d.rng() < 0.5 * curiosity) adopted.push(f);
  }
  if (adopted.length) await d.db.update(lineage).set({ adopters: [...row.adopters, ...adopted] }).where(eq(lineage.id, id));
  return adopted;
}

export function withBorrowed(pb: Phrasebook, borrowed: DepthView['borrowed']): Phrasebook {
  const lines: Phrasebook['lines'] = { ...pb.lines };
  for (const b of borrowed) lines[b.situation] = [...(lines[b.situation] ?? []), b.text];
  return { ...pb, lines };
}

const recent = new Map<string, { lineageId: string; authorId: string; at: number }>();
const RECENT_MAX = 500, WINDOW_MS = 30 * 60_000;

const isStockLine = (situation: Situation, template: string) =>
  (FALLBACK_LINES[situation] ?? []).some((l) => normalizeLine(l) === normalizeLine(template));

export const lineageModule: DepthModule = {
  name: 'lineage',
  async perceive(d, v) {
    const rows = await d.db.select().from(lineage).where(sql`${lineage.adopters} @> ${JSON.stringify([v.agent.id])}::jsonb`).limit(20);
    v.depth.borrowed = rows.map((r) => ({ lineageId: r.id, text: r.text, situation: r.situation as Situation, inventorId: r.inventorId }));
    v.phrasebook = withBorrowed(v.phrasebook, v.depth.borrowed);
  },
  async afterAct(d, v, _c, r) {
    if (!r.ok || !r.line) return;
    // Stock fallback templates belong to nobody: no inventor to credit.
    if (isStockLine(r.line.situation, r.line.template)) return;
    const borrowed = v.depth.borrowed.find((b) => normalizeLine(b.text) === normalizeLine(r.line!.template));
    const id = await recordLineage(d.db, { kind: 'line', text: r.line.template, situation: r.line.situation, inventorId: borrowed?.inventorId ?? v.agent.id }, d.now());
    if (r.postId) {
      recent.set(r.postId, { lineageId: id, authorId: v.agent.id, at: d.now().getTime() });
      if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value!);
    }
  },
  async sweep(d) {
    const cutoff = d.now().getTime() - WINDOW_MS;
    for (const [postId, x] of recent) {
      if (x.at < cutoff) { recent.delete(postId); continue; }
      await adoptFromReactions(d, postId, x.lineageId, x.authorId);
    }
  },
};
