import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { agentTurns, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { abortRunningTurns, canonicalJson, chainHead, finishTurn, genesisHash, recordProgress, startTurn, verifyChain } from '../src/world/provenance.ts';

let h: DbHandle; let agentId: string;
const meta = (now: Date) => ({ agentId, triggers: [{ type: 'heartbeat' as const }], model: 'claude-opus-5-5', effort: 'medium', promptVersion: 'world-v1', snapshotId: null, now });
const done = (now: Date) => ({ status: 'acted' as const, context: [{ kind: 'why', text: 'heartbeat' }], reasoning: 'thought', toolCalls: [{ name: 'post', input: { body: 'gm' }, ok: true, result: { id: 'p1' } }], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.001, finishedAt: now });

beforeAll(async () => {
  h = await testDb();
  agentId = newId();
  await h.db.insert(users).values({ id: agentId, username: 'agent_01', displayName: '', kind: 'agent', createdAt: new Date() });
});
afterAll(() => h.close());

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: undefined, x: 0 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":0,"z":1}]},"b":1}');
  });
});

describe('turn chain', () => {
  it('numbers turns, links hashes from the genesis and verifies', async () => {
    const t1 = await startTurn(h.db, meta(new Date('2026-10-10T10:00:00Z')));
    const r1 = await finishTurn(h.db, t1.id, done(new Date('2026-10-10T10:00:05Z')));
    const t2 = await startTurn(h.db, meta(new Date('2026-10-10T10:01:00Z')));
    const r2 = await finishTurn(h.db, t2.id, { ...done(new Date('2026-10-10T10:01:03Z')), status: 'quiet', toolCalls: [] });
    expect([t1.seq, t2.seq]).toEqual([1, 2]);
    expect(r1.prevHash).toBe(genesisHash(agentId));
    expect(r2.prevHash).toBe(r1.hash);
    expect(r2.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyChain(h.db, agentId)).toEqual({ ok: true, count: 2, head: r2.hash, brokenAtSeq: null });
    expect(await chainHead(h.db, agentId)).toEqual({ hash: r2.hash, count: 2 });
  });
  it('detects an edited record', async () => {
    const [first] = await h.db.select().from(agentTurns).where(eq(agentTurns.seq, 1));
    await h.db.update(agentTurns).set({ reasoning: 'rewritten history' }).where(eq(agentTurns.id, first!.id));
    expect(await verifyChain(h.db, agentId)).toMatchObject({ ok: false, brokenAtSeq: 1 });
    await h.db.update(agentTurns).set({ reasoning: 'thought' }).where(eq(agentTurns.id, first!.id));
    expect((await verifyChain(h.db, agentId)).ok).toBe(true);
  });
  it('aborted turns are finalized in order and the chain verifies', async () => {
    await startTurn(h.db, meta(new Date('2026-10-10T10:05:00Z')));
    expect(await abortRunningTurns(h.db, new Date('2026-10-10T11:00:00Z'))).toBe(1);
    const rows = await h.db.select().from(agentTurns).where(eq(agentTurns.agentId, agentId));
    const last = rows.find((r) => r.seq === 3)!;
    expect(last.status).toBe('aborted');
    expect(last.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyChain(h.db, agentId)).toMatchObject({ ok: true, count: 3 });
  });
});

describe('chain integrity under failures (review fixes)', () => {
  it('refuses to chain a turn onto an unsealed predecessor instead of forking to the genesis', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'agent_77', displayName: '', kind: 'agent', createdAt: new Date() });
    const m = (now: Date) => ({ agentId: id, triggers: [{ type: 'heartbeat' as const }], model: 'm', effort: 'medium', promptVersion: 'v', snapshotId: null, now });
    await startTurn(h.db, m(new Date('2026-10-10T12:00:00Z'))); // never finished
    const t2 = await startTurn(h.db, m(new Date('2026-10-10T12:01:00Z')));
    await expect(finishTurn(h.db, t2.id, done(new Date('2026-10-10T12:01:05Z')))).rejects.toThrow(/unsealed/);
  });
  it('reports a running turn in the middle of the chain as broken', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'agent_78', displayName: '', kind: 'agent', createdAt: new Date() });
    const m = (now: Date) => ({ agentId: id, triggers: [{ type: 'heartbeat' as const }], model: 'm', effort: 'medium', promptVersion: 'v', snapshotId: null, now });
    await startTurn(h.db, m(new Date('2026-10-10T12:00:00Z')));
    await startTurn(h.db, m(new Date('2026-10-10T12:01:00Z')));
    expect(await verifyChain(h.db, id)).toMatchObject({ ok: false, brokenAtSeq: 1 });
  });
  it('stores tool results containing NUL characters', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'agent_79', displayName: '', kind: 'agent', createdAt: new Date() });
    const t = await startTurn(h.db, { agentId: id, triggers: [], model: 'm', effort: 'medium', promptVersion: 'v', snapshotId: null, now: new Date() });
    const r = await finishTurn(h.db, t.id, { ...done(new Date()), reasoning: 'a\u0000b', toolCalls: [{ name: 'post', input: { body: 'x\u0000y' }, ok: true, result: 'z\u0000' }] });
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await verifyChain(h.db, id)).ok).toBe(true);
  });
  it('keeps what a turn did when it is aborted at boot', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'agent_80', displayName: '', kind: 'agent', createdAt: new Date() });
    const t = await startTurn(h.db, { agentId: id, triggers: [], model: 'm', effort: 'medium', promptVersion: 'v', snapshotId: null, now: new Date() });
    await recordProgress(h.db, t.id, { context: [{ kind: 'trigger', text: 'heartbeat' }], toolCalls: [{ name: 'post', input: { body: 'hi' }, ok: true, result: { post_id: 'p' } }] });
    await abortRunningTurns(h.db, new Date());
    const [row] = await h.db.select().from(agentTurns).where(eq(agentTurns.id, t.id));
    expect(row).toMatchObject({ status: 'aborted', toolCalls: [{ name: 'post' }], context: [{ kind: 'trigger' }] });
    expect((await verifyChain(h.db, id)).ok).toBe(true);
  });
});
