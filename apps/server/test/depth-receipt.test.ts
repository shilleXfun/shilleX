import { describe, it, expect, afterEach } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { depthToolRecord } from '../src/agents/depth/receipt.ts';
import { DepthRegistry, type ActDone } from '../src/agents/depth/registry.ts';
import { act } from '../src/agents/act.ts';
import { perceive } from '../src/agents/perceive.ts';
import { agentTurns, communityMembers, messages } from '../src/db/schema.ts';
import { runTool, type ToolOutcome } from '../src/world/tools.ts';
import { depthTestCtx } from './depth-helpers.ts';

let ctx: Awaited<ReturnType<typeof depthTestCtx>> | undefined;
afterEach(async () => { await ctx?.t.close(); ctx = undefined; });

const SECRET = 'the vault code is quokka-77';
const sealedRun = async (agentIdx: number, name: string, input: Record<string, unknown>) => {
  const a = ctx!.agents[agentIdx]!;
  return runTool(await ctx!.ctxFor(a), name, input);
};
const PRIV = (name: string, out: ToolOutcome) => ({ record: { name, input: { private: true }, ok: out.ok, result: { private: true } }, private: true });

/** A human with a DM to agent `idx` holding SECRET; returns the conversation id. */
async function humanDm(idx: number, username = 'dm_human') {
  const human = await ctx!.t.createUser(username);
  const conv = await ctx!.t.as(human).post('/api/conversations', { kind: 'dm', username: ctx!.agents[idx]!.username });
  await ctx!.t.as(human).post(`/api/conversations/${conv.body.conversation.id}/messages`, { body: SECRET });
  return { human, conversationId: conv.body.conversation.id as string };
}

describe('depth receipts: every human conversation read or write stays private', () => {
  it('read_room on a conversation with a human is private, even though the result holds the DM text', async () => {
    ctx = await depthTestCtx();
    const { conversationId } = await humanDm(0);
    const input = { channel_id: null, conversation_id: conversationId };
    const out = await sealedRun(0, 'read_room', input);
    expect(JSON.stringify(out.result)).toContain('quokka');
    expect(await depthToolRecord(ctx.t.db, 'read_room', input, out)).toEqual(PRIV('read_room', out));
  });
  it('list_conversations is always private', async () => {
    ctx = await depthTestCtx();
    await humanDm(1);
    const out = await sealedRun(1, 'list_conversations', {});
    expect(JSON.stringify(out.result)).toContain('quokka');
    expect(await depthToolRecord(ctx.t.db, 'list_conversations', {}, out)).toEqual(PRIV('list_conversations', out));
  });
  it('a channel in a private community, or in a public one with a human member, is private; an agent-only public room is not', async () => {
    ctx = await depthTestCtx();
    const a = ctx.agents[2]!;
    const human = await ctx.t.createUser('club_human');
    const priv = await ctx.t.as(human).post('/api/communities', { name: 'Hushclub', slug: 'hushclub', visibility: 'private' });
    const privId = priv.body.community?.community?.id ?? priv.body.community?.id;
    await ctx.t.db.insert(communityMembers).values({ communityId: privId, userId: a.id, role: 'member', status: 'active', joinedAt: ctx.t.clock.now() });
    const privChannel = priv.body.community.channels[0].id as string;
    const open = await ctx.t.as(human).post('/api/communities', { name: 'Openhall', slug: 'openhall', visibility: 'public' });
    const openChannel = open.body.community.channels[0].id as string;
    const mine = await sealedRun(2, 'create_community', { name: 'Agents Only', slug: 'agents-only', description: 'x', visibility: 'public' });
    const agentChannel = (mine.result as { channels: { id: string }[] }).channels[0]!.id;

    const fake: ToolOutcome = { ok: true, write: false, result: [{ body: SECRET }] };
    for (const id of [privChannel, openChannel]) {
      expect((await depthToolRecord(ctx.t.db, 'read_room', { channel_id: id, conversation_id: null }, fake)).private).toBe(true);
      expect((await depthToolRecord(ctx.t.db, 'chat', { channel_id: id, conversation_id: null, body: 'x', reply_to_id: null }, fake)).private).toBe(true);
    }
    for (const slug of ['hushclub', 'openhall']) {
      for (const name of ['read_community', 'leave_community', 'create_channel', 'join_community']) {
        expect((await depthToolRecord(ctx.t.db, name, { slug, invite_code: null, name: 'x', topic: 'x' }, fake)).private).toBe(true);
      }
    }
    const pub = await depthToolRecord(ctx.t.db, 'read_room', { channel_id: agentChannel, conversation_id: null }, fake);
    expect(pub).toEqual({ record: { name: 'read_room', input: { channel_id: agentChannel, conversation_id: null }, ok: true, result: [{ body: SECRET }], signatures: undefined }, private: false });
    expect((await depthToolRecord(ctx.t.db, 'read_community', { slug: 'agents-only' }, fake)).private).toBe(false);
  });
  it('unknown ids, failed lookups, unknown tools and memory tools are private; plain public tools are not', async () => {
    ctx = await depthTestCtx();
    const out: ToolOutcome = { ok: true, write: true, result: { x: SECRET } };
    expect((await depthToolRecord(ctx.t.db, 'read_room', { channel_id: null, conversation_id: 'nope' }, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'chat', { channel_id: 'nope', conversation_id: null }, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'chat', { channel_id: null, conversation_id: null }, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'some_future_tool', {}, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'remember', { note: SECRET }, out)).private).toBe(true);
    const broken = { select: () => { throw new Error('db down'); } } as never;
    expect((await depthToolRecord(broken, 'read_room', { channel_id: null, conversation_id: 'x' }, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'post', { body: 'hello' }, out)).private).toBe(false);
    expect((await depthToolRecord(ctx.t.db, 'buy', { mint: 'm', sol: 0.01, slippage_pct: 10 }, out)).private).toBe(false);
  });
  it('start_dm, start_group, add_to_group and leave_group touching a human are private, whatever the username case', async () => {
    ctx = await depthTestCtx();
    const { human, conversationId } = await humanDm(3, 'CaseHuman');
    const out: ToolOutcome = { ok: true, write: true, result: {} };
    const agentName = ctx.agents[4]!.username;
    for (const username of ['casehuman', '@CASEHUMAN', 'CaseHuman']) {
      expect((await depthToolRecord(ctx.t.db, 'start_dm', { username, body: 'hi' }, out)).private).toBe(true);
      expect((await depthToolRecord(ctx.t.db, 'start_group', { name: 'g', usernames: [agentName, username] }, out)).private).toBe(true);
    }
    expect((await depthToolRecord(ctx.t.db, 'start_dm', { username: agentName, body: 'hi' }, out)).private).toBe(false);
    expect((await depthToolRecord(ctx.t.db, 'start_dm', { username: 'no_such_user', body: 'hi' }, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'leave_group', { conversation_id: conversationId }, out)).private).toBe(true);
    expect((await depthToolRecord(ctx.t.db, 'add_to_group', { conversation_id: conversationId, username: agentName }, out)).private).toBe(true);
    expect(human.username).toBe('CaseHuman');
  });
  it('a reaction to a message in a human DM is private', async () => {
    ctx = await depthTestCtx();
    const { conversationId } = await humanDm(5);
    const [m] = await ctx.t.db.select().from(messages).where(eq(messages.conversationId, conversationId));
    const out: ToolOutcome = { ok: true, write: true, result: {} };
    expect((await depthToolRecord(ctx.t.db, 'react', { target_type: 'message', target_id: m!.id, emoji: '🔥' }, out)).private).toBe(true);
  });
});

describe('depth actions into a human conversation', () => {
  it('a depth execute that writes into a human DM leaves no text or line in ActResult or afterAct, and a private receipt', async () => {
    ctx = await depthTestCtx();
    const { conversationId } = await humanDm(6);
    const seen: ActDone[] = [];
    const d = { ...ctx.d, depth: new DepthRegistry([{
      name: 'whisper',
      execute: async (_d, _v, c, tool) => {
        if (c.kind !== 'leak') return null;
        const out = await tool('chat', { channel_id: null, conversation_id: conversationId, body: 'psst quokka-77', reply_to_id: null });
        return { ok: out.ok, text: 'psst quokka-77', line: { key: 'k', template: 'psst quokka-77', situation: 'idle' } };
      },
      afterAct: async (_d, _v, _c, r) => { seen.push(r); },
    }]) };
    const a = ctx.agents[6]!;
    const v = await perceive(d, a.id);
    const r = await act(d, v, { kind: 'leak', score: 1, reason: 'a whisper' });
    expect(r.ok).toBe(true);
    expect(r.text).toBeUndefined();
    expect(r.line).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toBeUndefined();
    expect(seen[0]!.line).toBeUndefined();
    const [turn] = await ctx.t.db.select().from(agentTurns).where(eq(agentTurns.agentId, a.id)).orderBy(desc(agentTurns.seq)).limit(1);
    expect(JSON.stringify(turn)).not.toContain('quokka');
  });
});
