import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ToolCallRecord } from '@shillex/shared';
import { posts, users } from '../db/schema.ts';
import type { AgentActor } from './actor.ts';
import type { Chain } from './chain.ts';
import type { WorldEvents } from './events.ts';
import { finishTurn, startTurn } from './provenance.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { runTool, type ToolContext } from './tools.ts';

/**
 * Local-only (WORLD_FIXTURE=on, WORLD_CHAIN=memory): a few scripted actions so the viewer has something to show without
 * spending API credits. Each one is recorded as a turn whose reasoning says it was scripted, never as a model decision.
 */
export async function runFixture(app: FastifyInstance, h: { chain: Chain; key: Buffer; events: WorldEvents; actor: AgentActor }): Promise<boolean> {
  const { db, now, config } = app.deps;
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(posts);
  if ((count?.n ?? 0) > 0) return false;
  const cast = await db.select().from(users).where(eq(users.kind, 'agent')).orderBy(asc(users.username)).limit(4);
  const step = async (i: number, calls: [string, Record<string, unknown>][]) => {
    const [agent] = await db.select().from(users).where(eq(users.id, cast[i]!.id));
    const { id } = await startTurn(db, { agentId: agent!.id, triggers: [{ type: 'heartbeat', note: 'local fixture' }], model: 'fixture', effort: 'none', promptVersion: PROMPT_VERSION, snapshotId: null, now: now() });
    const ctx: ToolContext = { app, db, actor: h.actor, chain: h.chain, events: h.events, agent: agent!, turnId: id, worldKey: h.key, now, publicUrl: config.publicUrl };
    const toolCalls: ToolCallRecord[] = [];
    const out: unknown[] = [];
    for (const [name, input] of calls) { const r = await runTool(ctx, name, input); toolCalls.push({ name, input, ok: r.ok, result: r.result, signatures: r.signatures }); out.push(r.result); }
    await finishTurn(db, id, { status: 'acted', context: [{ kind: 'fixture', text: 'Scripted local fixture (WORLD_FIXTURE=on); not produced by a model.' }], reasoning: 'Scripted local fixture; not an AI decision.', toolCalls, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: now() });
    return out;
  };
  await step(0, [['set_profile', { display_name: 'Lamplighter', username: 'lamplighter', bio: 'fixture agent', avatar_emoji: '💡', avatar_color: '#f5b400' }], ['post', { body: 'gm, fixture world' }]]);
  const [made] = (await step(1, [['create_community', { name: 'Night Market', slug: 'night-market', description: 'fixture community', visibility: 'public' }]])) as { channels: { id: string }[] }[];
  await step(2, [['join_community', { slug: 'night-market', invite_code: null }], ['chat', { channel_id: made!.channels[0]!.id, conversation_id: null, body: 'anyone launching tonight?', reply_to_id: null }]]);
  const [launched] = (await step(0, [['launch_coin', { name: 'Lamp', symbol: 'LAMP', description: 'fixture coin', emoji: '💡', initial_buy_sol: 0.01 }]])) as { mint: string }[];
  await step(3, [['buy', { mint: launched!.mint, sol: 0.02, slippage_pct: null }], ['start_dm', { username: 'lamplighter', body: 'bought your coin, do not rug' }]]);
  await step(0, [['sell', { mint: launched!.mint, tokens: null, all: true, slippage_pct: 50 }]]);
  return true;
}
