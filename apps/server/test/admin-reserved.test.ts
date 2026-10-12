import { describe, it, expect } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents } from '../src/world/boot.ts';
import { runTool } from '../src/world/tools.ts';
import { ROUTE_WORDS, isReservedUsername } from '../src/lib/reserved.ts';

const rename = (username: string) => ({ display_name: null, username, bio: null, avatar_emoji: null, avatar_color: null });

describe('reserved usernames', () => {
  it('signup cannot take an admin username, in any case', async () => {
    const w = await worldTestCtx();
    const r = await w.t.as(null).post('/api/auth/signup', { username: 'Admin', displayName: 'x', password: 'password1' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: 'USERNAME_RESERVED' });
    await w.t.close();
  });
  it('an agent cannot rename itself to an admin username', async () => {
    const w = await worldTestCtx();
    const out = await runTool(await w.ctxFor(w.agents[0]!), 'set_profile', rename('admin'));
    expect(out).toMatchObject({ ok: false, result: { code: 'USERNAME_RESERVED' } });
    await w.t.close();
  });
  it('reserves exactly the static words of the /api/agents routes the agent world registers', async () => {
    const t = await makeTestApp({ config: loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' }) });
    const urls: string[] = [];
    t.app.addHook('onRoute', (r) => { urls.push(r.url); });
    const world = await bootAgents(t.app, {});
    try {
      // /api/agents/<word> or /api/agents/<word>/…: a literal first segment shadows (all or part of) /api/agents/:username.
      const words = new Set(urls.map((u) => /^\/api\/agents\/([^/:]+)/.exec(u)?.[1]).filter((w): w is string => Boolean(w)));
      expect(words.size).toBeGreaterThan(0);
      expect([...words].sort()).toEqual([...ROUTE_WORDS].sort());
    } finally { await world.stop(); await t.close(); }
  });
  it('the /api/agents static route words are reserved for signup and agent renames', async () => {
    const w = await worldTestCtx();
    for (const name of ['info', 'Backchannel', 'graph', 'Overview', 'avatars']) {
      const r = await w.t.as(null).post('/api/auth/signup', { username: name, displayName: 'x', password: 'password1' });
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'USERNAME_RESERVED' });
      const out = await runTool(await w.ctxFor(w.agents[0]!), 'set_profile', rename(name));
      expect(out).toMatchObject({ ok: false, result: { code: 'USERNAME_RESERVED' } });
    }
    await w.t.close();
  });
  it('isReservedUsername ignores case and padding', () => {
    expect(isReservedUsername({ adminUsernames: ['admin'] }, ' ADMIN ')).toBe(true);
    expect(isReservedUsername({ adminUsernames: ['admin'] }, 'alice')).toBe(false);
  });
});
