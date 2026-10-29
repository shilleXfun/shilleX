import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents } from '../src/world/boot.ts';
import { agents, users } from '../src/db/schema.ts';

/**
 * Owners and link keys (2026-10-28 brief §1): an owner signs in, copies the agent link key from the dashboard, and the agent
 * registers with it: linked to that owner and active at once, with its own wallet. No tweet, no claim link.
 */
const worldConfig = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ...extra });

async function setup(extra: Record<string, string> = {}) {
  const t = await makeTestApp({ config: worldConfig(extra) });
  const world = await bootAgents(t.app, {});
  const call = async (method: 'GET' | 'POST', url: string, opts: { body?: unknown; key?: string; cookie?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.key) headers.authorization = `Bearer ${opts.key}`;
    if (opts.cookie) headers.cookie = opts.cookie;
    const r = await t.app.inject({ method, url, payload: opts.body as never, headers });
    return { status: r.statusCode, body: r.json() as Record<string, any>, raw: r.body };
  };
  const signup = await t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'ownerone', displayName: 'Owner One', password: 'password-123' } });
  const cookie = String(signup.headers['set-cookie']).split(';')[0]!;
  return { t, world, call, cookie };
}

describe('linking an agent with the owner’s key', () => {
  it('links it at once: active, owned, with a wallet, and no secret in the answer', async () => {
    const { t, world, call, cookie } = await setup();
    const dash = await call('GET', '/api/owner', { cookie });
    expect(dash.status).toBe(200);
    const linkKey = dash.body.linkKey.key as string;
    expect(linkKey).toMatch(/^slk_/);
    const reg = await call('POST', '/api/v1/agents/register', { body: { handle: 'tinkerbot', name: 'Tinker', bio: 'Builds small things.', link_key: linkKey } });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ agent: { handle: 'tinkerbot' }, owner: { username: 'ownerone' } });
    expect(reg.body.wallet.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(reg.body.api_key).not.toBe(linkKey);
    expect(reg.raw).not.toMatch(/secret|encrypted/i);
    expect(reg.raw).not.toContain(linkKey);
    const [row] = await t.db.select().from(agents).where(eq(agents.userId, reg.body.agent.id));
    expect(row).toMatchObject({ status: 'active', origin: 'external' });
    expect(row!.ownerId).toBeTruthy();
    const me = await call('GET', '/api/v1/agent/me', { key: reg.body.api_key });
    expect(me.body).toMatchObject({ agent: { handle: 'tinkerbot' }, status: 'active' });
    expect((await call('POST', '/api/v1/agent/post', { key: reg.body.api_key, body: { body: 'First day here. Reading the room before I say much.' } })).body).toMatchObject({ ok: true });
    expect((await call('GET', '/api/owner', { cookie })).body.agents.map((a: { handle: string }) => a.handle)).toEqual(['tinkerbot']);
    await world.stop();
  }, 60_000);

  it('refuses no key, a wrong key and a key the owner regenerated', async () => {
    const { world, call, cookie } = await setup();
    const old = (await call('GET', '/api/owner', { cookie })).body.linkKey.key as string;
    expect((await call('POST', '/api/v1/agents/register', { body: { handle: 'nokeybot', name: 'No Key' } })).body.code).toBe('LINK_KEY_REQUIRED');
    const wrong = await call('POST', '/api/v1/agents/register', { body: { handle: 'wrongbot', name: 'Wrong', link_key: 'slk_notarealkeyatallnotarealkey12' } });
    expect([wrong.status, wrong.body.code]).toEqual([401, 'LINK_KEY_INVALID']);
    const fresh = (await call('POST', '/api/owner/link-key/regenerate', { cookie })).body.linkKey.key as string;
    expect(fresh).not.toBe(old);
    expect((await call('POST', '/api/v1/agents/register', { body: { handle: 'oldkeybot', name: 'Old', link_key: old } })).status).toBe(401);
    expect((await call('POST', '/api/v1/agents/register', { body: { handle: 'newkeybot', name: 'New', link_key: fresh } })).status).toBe(201);
    await world.stop();
  }, 60_000);

  it('stops at the owner’s cap and leaves nothing behind', async () => {
    const { t, world, call, cookie } = await setup({ OWNER_AGENTS_MAX: '1' });
    const key = (await call('GET', '/api/owner', { cookie })).body.linkKey.key as string;
    expect((await call('POST', '/api/v1/agents/register', { body: { handle: 'firstbot', name: 'First', link_key: key } })).status).toBe(201);
    const second = await call('POST', '/api/v1/agents/register', { body: { handle: 'secondbot', name: 'Second', link_key: key } });
    expect([second.status, second.body.code]).toEqual([409, 'OWNER_FULL']);
    expect(await t.db.select().from(users).where(eq(users.username, 'secondbot'))).toHaveLength(0);
    await world.stop();
  }, 60_000);

  it('tells its owner it joined, renames once, and saves limits with no wallet', async () => {
    const { t, world, call, cookie } = await setup({ SOLANA_NETWORK: 'devnet' });
    const linkKey = (await call('GET', '/api/owner', { cookie })).body.linkKey.key as string;
    await call('POST', '/api/v1/agents/register', { body: { handle: 'chimebot', name: 'Chime', bio: 'Rings once.', link_key: linkKey } });
    await new Promise((r) => setTimeout(r, 50));
    const notes = (await call('GET', '/api/notifications', { cookie })).body.items as { type: string; href: string }[];
    expect(notes.find((n) => n.type === 'agent_linked')).toMatchObject({ href: '/owner/agents/chimebot' });
    const put = (body: unknown) => t.app.inject({ method: 'PUT', url: '/api/owner/agents/chimebot/settings', payload: body as object, headers: { cookie } });
    expect((await put({ limits: { maxSolPerTrade: 0.02 } })).statusCode).toBe(200);
    expect((await put({ name: 'Bell' })).statusCode).toBe(200);
    expect((await put({ name: 'Gong' })).json()).toMatchObject({ code: 'RENAMED_ALREADY' });
    expect((await call('GET', '/api/owner/agents/chimebot', { cookie })).body.agent).toMatchObject({ name: 'Bell', canRename: false });
    await world.stop();
  }, 60_000);

  it('lets an admin delete an outside agent for good, so its owner registers the same handle again', async () => {
    const { t, world, call, cookie } = await setup({ ADMIN_USERNAMES: 'boss' });
    const linkKey = (await call('GET', '/api/owner', { cookie })).body.linkKey.key as string;
    const reg = await call('POST', '/api/v1/agents/register', { body: { handle: 'tinkerbot', name: 'Tinker', bio: 'Builds small things.', link_key: linkKey } });
    expect((await call('POST', '/api/v1/agent/post', { key: reg.body.api_key, body: { body: 'First day here. Reading the room before I say much.' } })).body).toMatchObject({ ok: true });
    const boss = await t.createUser('boss');
    expect((await call('POST', `/api/admin/outsiders/${reg.body.agent.id}/delete`, { cookie })).status).toBe(403);
    const del = await call('POST', `/api/admin/outsiders/${reg.body.agent.id}/delete`, { cookie: boss.cookie });
    expect(del.body).toEqual({ deleted: 'tinkerbot' });
    expect((await call('GET', '/api/owner', { cookie })).body.agents).toEqual([]);
    expect((await call('GET', '/api/v1/agent/me', { key: reg.body.api_key })).status).toBe(401);
    const again = await call('POST', '/api/v1/agents/register', { body: { handle: 'tinkerbot', name: 'Tinker', bio: 'Builds small things.', link_key: linkKey } });
    expect(again.status).toBe(201);
    expect(again.body.agent.id).not.toBe(reg.body.agent.id);
    await world.stop();
  }, 60_000);
});

describe('the link key after SESSION_SECRET changes', () => {
  it('makes a new key instead of failing, and the old one stops linking', async () => {
    const { testDb } = await import('./helpers.ts');
    const { linkKeyFor, ownerForLinkKey } = await import('../src/agents/external/link.ts');
    const { db } = await testDb();
    const now = new Date('2026-10-28T12:00:00Z');
    await db.insert(users).values({ id: 'o1', username: 'ownerx', displayName: 'Owner X', createdAt: now });
    const first = await linkKeyFor(db, 'secret-one', 'o1', now);
    const second = await linkKeyFor(db, 'secret-two', 'o1', now);
    expect(second.key).not.toBe(first.key);
    expect(await ownerForLinkKey(db, first.key)).toBeNull();
    expect((await ownerForLinkKey(db, second.key))?.id).toBe('o1');
  });
});
