import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { runTool, TOOLS } from '../src/world/tools.ts';
import { agents as agentsTable, chainTxs, messages, posts, users, worldCoins } from '../src/db/schema.ts';
import { liveNotes } from '../src/world/memory.ts';
import type { WorldEvent } from '../src/world/events.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
const seen: WorldEvent[] = [];
beforeAll(async () => { w = await worldTestCtx(); w.events.on((e) => seen.push(e)); });
afterAll(() => w.t.close());
const A = () => w.agents[0]!, B = () => w.agents[1]!, C = () => w.agents[2]!;
const run = async (agent = A(), name: string, input: unknown) => runTool(await w.ctxFor(agent), name, input);

describe('tool definitions', () => {
  it('are closed schemas with every property required', () => {
    for (const t of TOOLS) {
      const s = t.input_schema as unknown as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
      expect(s.additionalProperties).toBe(false);
      expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    }
  });
  it('mark at most 20 tools strict, the API limit (production 400 on 2026-10-11), and always the money tools', () => {
    const strict = TOOLS.filter((t) => (t as { strict?: boolean }).strict).map((t) => t.name);
    expect(strict.length).toBeLessThanOrEqual(20);
    expect(strict).toEqual(expect.arrayContaining(['launch_coin', 'buy', 'sell', 'send_sol', 'post', 'chat']));
  });
});

describe('identity', () => {
  it('sets its own profile', async () => {
    const r = await run(A(), 'set_profile', { display_name: 'Moth Queen', username: 'mothqueen', bio: 'i like lamps', avatar_emoji: '🦋', avatar_color: '#ff00aa' });
    expect(r).toMatchObject({ ok: true, write: true });
    const [u] = await w.t.db.select().from(users).where(eq(users.id, A().id));
    expect(u).toMatchObject({ displayName: 'Moth Queen', username: 'mothqueen', bio: 'i like lamps' });
    const [ag] = await w.t.db.select().from(agentsTable).where(eq(agentsTable.userId, A().id));
    expect(ag).toMatchObject({ avatarEmoji: '🦋', avatarColor: '#ff00aa' });
  });
  it('rejects a taken or invalid username as an error result', async () => {
    expect(await run(B(), 'set_profile', { display_name: null, username: 'MothQueen', bio: null, avatar_emoji: null, avatar_color: null })).toMatchObject({ ok: false, result: { code: 'USERNAME_TAKEN' } });
    expect(await run(B(), 'set_profile', { display_name: null, username: 'bad name!', bio: null, avatar_emoji: null, avatar_color: null })).toMatchObject({ ok: false, result: { code: 'BAD_USERNAME' } });
  });
});

describe('social tools go through the real routes', () => {
  it('posts, replies and reacts, linking each post to its turn', async () => {
    const ctx = await w.ctxFor(A());
    const p = await runTool(ctx, 'post', { body: 'gm from the void' });
    expect(p.ok).toBe(true);
    const postId = (p.result as { post_id: string }).post_id;
    const [row] = await w.t.db.select().from(posts).where(eq(posts.id, postId));
    expect(row?.agentTurnId).toBe(ctx.turnId);
    expect((await run(B(), 'reply', { post_id: postId, body: 'gm' })).ok).toBe(true);
    expect((await run(B(), 'react', { target_type: 'post', target_id: postId, emoji: '🔥' })).ok).toBe(true);
    expect((await run(B(), 'follow', { username: 'mothqueen', follow: true })).ok).toBe(true);
  });
  it('builds a community, invites, and chats', async () => {
    const made = await run(A(), 'create_community', { name: 'Lamp Cult', slug: 'lamp-cult', description: 'moths only', visibility: 'invite' });
    expect(made.ok).toBe(true);
    const general = (made.result as { channels: { id: string; name: string }[] }).channels[0]!;
    expect((await run(B(), 'chat', { channel_id: general.id, conversation_id: null, body: 'let me in', reply_to_id: null })).ok).toBe(false);
    const inv = await run(A(), 'create_invite', { slug: 'lamp-cult' });
    const code = (inv.result as { code: string }).code;
    expect((await run(B(), 'join_community', { slug: 'lamp-cult', invite_code: code })).ok).toBe(true);
    const sent = await run(B(), 'chat', { channel_id: general.id, conversation_id: null, body: 'hi cult', reply_to_id: null });
    expect(sent.ok).toBe(true);
    const [m] = await w.t.db.select().from(messages).where(eq(messages.id, (sent.result as { message_id: string }).message_id));
    expect(m?.agentTurnId).toBeTruthy();
    const room = await run(A(), 'read_room', { channel_id: general.id, conversation_id: null });
    expect(JSON.stringify(room.result)).toContain('hi cult');
  });
  it('starts a group chat and talks in it', async () => {
    const g = await run(A(), 'start_group', { name: 'the plan', usernames: [B().username, C().username] });
    expect(g.ok).toBe(true);
    const conversationId = (g.result as { conversation_id: string }).conversation_id;
    expect((await run(C(), 'chat', { channel_id: null, conversation_id: conversationId, body: 'what plan', reply_to_id: null })).ok).toBe(true);
  });
});

describe('money tools', () => {
  let mint = '';
  it('launches a coin with a first buy and records it', async () => {
    const r = await run(A(), 'launch_coin', { name: 'Lamp', symbol: 'LAMP', description: 'for moths', emoji: '💡', initial_buy_sol: 0.01 });
    expect(r.ok).toBe(true);
    mint = (r.result as { mint: string }).mint;
    expect(await w.t.db.select().from(worldCoins).where(eq(worldCoins.mint, mint))).toHaveLength(1);
    const [tx] = await w.t.db.select().from(chainTxs).where(eq(chainTxs.kind, 'launch'));
    expect(tx).toMatchObject({ agentId: A().id, mint });
    expect(seen.some((e) => e.type === 'launch' && e.mint === mint)).toBe(true);
  });
  it('buys and sells everything', async () => {
    const b = await run(B(), 'buy', { mint, sol: 0.02, slippage_pct: null });
    expect(b.ok).toBe(true);
    const s = await run(B(), 'sell', { mint, tokens: null, all: true, slippage_pct: null });
    expect(s.ok).toBe(true);
    const wallet = await run(B(), 'read_wallet', { username: null });
    expect((wallet.result as { positions: unknown[] }).positions).toHaveLength(0);
    expect(seen.filter((e) => e.type === 'trade')).toHaveLength(2);
  });
  it('sends SOL to another agent by username and records both sides', async () => {
    const r = await run(C(), 'send_sol', { to: `@${B().username}`, sol: 0.005 });
    expect(r.ok).toBe(true);
    const rows = await w.t.db.select().from(chainTxs).where(eq(chainTxs.signature, (r.result as { signature: string }).signature));
    expect(rows.map((x) => x.kind).sort()).toEqual(['receive', 'send']);
  });
  it('returns route and chain failures as error results', async () => {
    expect(await run(B(), 'buy', { mint: 'NotACoin111111111111111111111111111111111', sol: 0.01, slippage_pct: null })).toMatchObject({ ok: false, result: { code: 'UNKNOWN_MINT' } });
    expect(await run(B(), 'sell', { mint, tokens: 1_000_000_000, all: false, slippage_pct: null })).toMatchObject({ ok: false, result: { code: 'INSUFFICIENT_TOKENS' } });
    expect(await run(B(), 'buy', { mint, sol: 5, slippage_pct: null })).toMatchObject({ ok: false, result: { code: 'INSUFFICIENT_FUNDS' } });
    expect(await run(B(), 'reply', { post_id: 'nope', body: 'x' })).toMatchObject({ ok: false });
    expect(await run(B(), 'no_such_tool', {})).toMatchObject({ ok: false, result: { code: 'UNKNOWN_TOOL' } });
  });
  it('reads a coin with holders and trades', async () => {
    const r = await run(C(), 'read_coin', { mint });
    expect(r.result).toMatchObject({ symbol: 'LAMP', creator: 'mothqueen' });
    expect((r.result as { recentTrades: unknown[] }).recentTrades.length).toBeGreaterThanOrEqual(3);
  });
});

describe('memory and quiet turns', () => {
  it('remembers and rewrites notes', async () => {
    expect((await run(C(), 'remember', { note: 'agent_02 bought LAMP and dumped it' })).ok).toBe(true);
    const ids = (await liveNotes(w.t.db, C().id)).map((n) => n.id);
    expect((await run(C(), 'rewrite_memory', { replace_ids: ids, new_notes: ['do not trust agent_02'] })).ok).toBe(true);
    expect((await liveNotes(w.t.db, C().id)).map((n) => n.body)).toEqual(['do not trust agent_02']);
  });
  it('do_nothing ends the turn', async () => {
    expect(await run(C(), 'do_nothing', { reason: 'nothing to add' })).toMatchObject({ ok: true, write: false, endTurn: true });
  });
});
