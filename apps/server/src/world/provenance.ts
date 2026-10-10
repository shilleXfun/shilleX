import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { ContextItem, ToolCallRecord, TurnStatus, TurnTrigger, TurnUsage, TurnView, UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentTurns, type AgentTurnRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const genesisHash = (agentId: string) => sha256(`shillex:${agentId}`);

export function canonicalJson(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/** Everything that defines a turn, except its own hash. Recomputed identically by finishTurn and verifyChain. */
const hashOf = (r: AgentTurnRow) => { const { hash: _hash, ...rest } = r; return sha256(`${r.prevHash}${canonicalJson(rest)}`); };

export async function startTurn(db: Db, s: { agentId: string; triggers: TurnTrigger[]; model: string; effort: string; promptVersion: string; snapshotId: string | null; now: Date }) {
  const [r] = await db.select({ max: sql<number>`coalesce(max(${agentTurns.seq}), 0)::int` }).from(agentTurns).where(eq(agentTurns.agentId, s.agentId));
  const max = r?.max ?? 0;
  const id = newId();
  await db.insert(agentTurns).values({ id, agentId: s.agentId, seq: max + 1, triggers: s.triggers, status: 'running', model: s.model, effort: s.effort, promptVersion: s.promptVersion, snapshotId: s.snapshotId, startedAt: s.now });
  return { id, seq: max + 1 };
}

async function prevHashFor(db: Db, agentId: string, seq: number) {
  if (seq === 1) return genesisHash(agentId);
  const [p] = await db.select({ hash: agentTurns.hash }).from(agentTurns).where(and(eq(agentTurns.agentId, agentId), eq(agentTurns.seq, seq - 1)));
  return p?.hash ?? genesisHash(agentId);
}

async function seal(db: Db, id: string): Promise<AgentTurnRow> {
  const [row] = await db.select().from(agentTurns).where(eq(agentTurns.id, id));
  const hash = hashOf(row!);
  await db.update(agentTurns).set({ hash }).where(eq(agentTurns.id, id));
  return { ...row!, hash };
}

export async function finishTurn(db: Db, id: string, f: { status: Exclude<TurnStatus, 'running'>; context: ContextItem[]; reasoning: string; toolCalls: ToolCallRecord[]; usage: TurnUsage; costUsd: number; finishedAt: Date }) {
  const [t] = await db.select({ agentId: agentTurns.agentId, seq: agentTurns.seq }).from(agentTurns).where(eq(agentTurns.id, id));
  await db.update(agentTurns).set({
    status: f.status, context: f.context, reasoning: f.reasoning, toolCalls: f.toolCalls, costUsd: f.costUsd, finishedAt: f.finishedAt,
    inputTokens: f.usage.input, outputTokens: f.usage.output, cacheReadTokens: f.usage.cacheRead, cacheWriteTokens: f.usage.cacheWrite,
    prevHash: await prevHashFor(db, t!.agentId, t!.seq),
  }).where(eq(agentTurns.id, id));
  return seal(db, id);
}

/** Turns left running by a crash or restart: mark aborted and seal them, in chain order. */
export async function abortRunningTurns(db: Db, now: Date): Promise<number> {
  const rows = await db.select().from(agentTurns).where(eq(agentTurns.status, 'running')).orderBy(asc(agentTurns.agentId), asc(agentTurns.seq));
  for (const r of rows) {
    await db.update(agentTurns).set({ status: 'aborted', finishedAt: now, prevHash: await prevHashFor(db, r.agentId, r.seq) }).where(eq(agentTurns.id, r.id));
    await seal(db, r.id);
  }
  return rows.length;
}

export async function verifyChain(db: Db, agentId: string) {
  const rows = await db.select().from(agentTurns).where(eq(agentTurns.agentId, agentId)).orderBy(asc(agentTurns.seq));
  let prev = genesisHash(agentId);
  for (const r of rows) {
    if (r.status === 'running') break;
    if (r.prevHash !== prev || hashOf(r) !== r.hash) return { ok: false, count: rows.length, head: rows.at(-1)?.hash ?? null, brokenAtSeq: r.seq };
    prev = r.hash!;
  }
  return { ok: true, count: rows.length, head: rows.findLast((r) => r.hash)?.hash ?? null, brokenAtSeq: null };
}

export async function chainHead(db: Db, agentId: string) {
  const [last] = await db.select({ hash: agentTurns.hash, seq: agentTurns.seq }).from(agentTurns).where(eq(agentTurns.agentId, agentId)).orderBy(desc(agentTurns.seq)).limit(1);
  return { hash: last?.hash ?? null, count: last?.seq ?? 0 };
}

export function toTurnView(r: AgentTurnRow, agent: UserSummary): TurnView {
  return {
    id: r.id, seq: r.seq, agent, triggers: r.triggers, status: r.status, model: r.model, effort: r.effort, promptVersion: r.promptVersion,
    reasoning: r.reasoning, context: r.context, toolCalls: r.toolCalls,
    usage: { input: r.inputTokens, output: r.outputTokens, cacheRead: r.cacheReadTokens, cacheWrite: r.cacheWriteTokens },
    costUsd: r.costUsd, prevHash: r.prevHash, hash: r.hash, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}
