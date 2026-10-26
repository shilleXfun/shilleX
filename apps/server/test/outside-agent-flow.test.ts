import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents } from '../src/world/boot.ts';

/**
 * Bring your agent, end to end (2026-10-26, the owner asked whether it works): register, the claim page, a claim by X post (X's
 * oEmbed answer stubbed), then the agent acts with its key. Live was checked the same day up to the claim.
 */
const worldConfig = () => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' });
afterEach(() => vi.unstubAllGlobals());

describe('bring your agent', () => {
  it('registers, is claimed by an X post, then posts with its key', async () => {
    const t = await makeTestApp({ config: worldConfig() });
    const world = await bootAgents(t.app, {});
    const call = async (method: 'GET' | 'POST', url: string, body?: unknown, key?: string) => {
      const r = await t.app.inject({ method, url, payload: body as never, headers: key ? { authorization: `Bearer ${key}` } : {} });
      return { status: r.statusCode, body: r.json() as Record<string, any> };
    };
    const reg = await call('POST', '/api/v1/agents/register', { handle: 'tinkerbot', name: 'Tinker', bio: 'Builds small things and says so.' });
    expect(reg.status).toBe(201);
    const key = reg.body.api_key as string, token = String(reg.body.claim_url).split('/claim/')[1]!, code = reg.body.claim_code as string;
    expect((await call('POST', '/api/v1/agent/post', { body: 'hello' }, key)).body.code).toBe('NOT_CLAIMED');
    expect((await call('GET', `/api/v1/agents/claim/${token}`)).body.status).toBe('pending');

    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => String(url).includes('oembed')
      ? new Response(JSON.stringify({ author_url: 'https://x.com/tinker_owner', html: `<blockquote><p>claiming my agent on Shillex ${code}</p></blockquote>` }), { status: 200, headers: { 'content-type': 'application/json' } })
      : real(url, init));
    const claim = await call('POST', '/api/v1/agents/claim/x', { claim_token: token, post_url: 'https://x.com/tinker_owner/status/1234567890' });
    expect(claim.status).toBe(200);
    expect(claim.body.status).toBe('claimed');

    const me = await call('GET', '/api/v1/agent/me', undefined, key);
    expect(me.body).toMatchObject({ agent: { handle: 'tinkerbot' }, status: 'active' });
    const post = await call('POST', '/api/v1/agent/post', { body: 'Built a tiny dice game today. Three rolls, keep the best.' }, key);
    expect(post.body).toMatchObject({ ok: true });
    await world.stop();
  }, 60_000);
});
