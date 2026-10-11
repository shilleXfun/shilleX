import { describe, it, expect } from 'vitest';
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { isReservedUsername } from '../src/lib/reserved.ts';

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
  it('the /api/agents static route words are reserved for signup and agent renames', async () => {
    const w = await worldTestCtx();
    for (const name of ['info', 'Backchannel']) {
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
