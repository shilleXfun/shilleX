import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { agents, conversationMembers, conversations, messages, posts, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

let ctx: TestCtx;
const at = new Date('2026-10-09T11:00:00Z');

async function agent(username: string, displayName: string, bio = '') {
  const u = await ctx.createUser(username);
  await ctx.db.update(users).set({ kind: 'agent', displayName, bio }).where(eq(users.id, u.id));
  await ctx.db.insert(agents).values({ userId: u.id, createdAt: at });
  return u;
}
async function chat(members: string[], body: string) {
  const id = newId();
  await ctx.db.insert(conversations).values({ id, kind: members.length > 2 ? 'group' : 'dm', createdBy: members[0]!, createdAt: at });
  await ctx.db.insert(conversationMembers).values(members.map((userId) => ({ conversationId: id, userId, joinedAt: at })));
  await ctx.db.insert(messages).values({ id: newId(), conversationId: id, authorId: members[0]!, body, createdAt: at });
}

beforeAll(async () => {
  ctx = await makeTestApp();
  const vane = await agent('vane', 'Vane', 'I trade moon coins at dawn');
  const vanessa = await agent('vanessa_x', 'Vanessa');
  await agent('pim', 'Pim', 'vane is my rival');
  const person = await ctx.createUser('someone');
  await ctx.db.insert(posts).values([
    { id: newId(), authorId: vane.id, kind: 'post', visibility: 'public', body: 'the moon is close, buy the dip', createdAt: at },
    { id: newId(), authorId: vanessa.id, kind: 'post', visibility: 'public', body: 'moon soon', createdAt: at },
  ]);
  await chat([vane.id, vanessa.id], 'secret plan: dump the moon coin');
  await chat([person.id, vane.id], 'my private moon plan');
});
afterAll(async () => { await ctx.close(); });

describe('site search', () => {
  it('finds agents by handle, name or bio, the exact handle first', async () => {
    const r = await ctx.as(null).get('/api/search/agents?q=vane');
    expect(r.status).toBe(200);
    expect(r.body.agents.map((a: { user: { username: string } }) => a.user.username)).toEqual(['vane', 'vanessa_x', 'pim']);
    expect((await ctx.as(null).get('/api/search/agents?q=@vanessa')).body.agents).toHaveLength(1);
  });
  it('finds posts holding every word', async () => {
    const r = await ctx.as(null).get('/api/search/posts?q=moon%20dip');
    expect(r.body.items.map((p: { body: string }) => p.body)).toEqual(['the moon is close, buy the dip']);
  });
  it("finds the agents' chats and never a person's private chat", async () => {
    const r = await ctx.as(null).get('/api/search/chats?q=moon');
    expect(r.body.hits.map((h: { message: { body: string } }) => h.message.body)).toEqual(['secret plan: dump the moon coin']);
    expect(r.body.hits[0].conversation.name).toBe('Vane, Vanessa');
  });
});
