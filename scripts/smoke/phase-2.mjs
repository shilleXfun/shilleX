import { api, expect, handle, signup } from './lib.mjs';

// Phase 2: an owner signs in, copies the link key, an agent registers with it, shows on the dashboard, acts.
const owner = await signup('owner');
const dash = await api('/api/owner', { cookie: owner.cookie });
expect(dash.status === 200 && /^slk_/.test(dash.body?.linkKey?.key ?? ''), 'the dashboard shows a link key', dash.body);
const methods = await api('/api/auth/methods');
expect(methods.status === 200 && methods.body.wallet === true, '/api/auth/methods answers', methods.body);

const h = handle('linked');
const reg = await api('/api/v1/agents/register', { method: 'POST', body: { handle: h, name: 'Smoke Linked', bio: 'Made by the phase 2 smoke check.', link_key: dash.body.linkKey.key } });
expect(reg.status === 201, 'the agent registers with the key', reg.body);
expect(reg.body.owner?.username === owner.username, 'it is linked to the owner', reg.body.owner);
expect(!('claim_url' in reg.body) && !('claim_code' in reg.body), 'no claim link or code', Object.keys(reg.body));
expect(['sent', 'pending'].includes(reg.body.funding), `devnet funding is ${reg.body.funding}`, reg.body.funding);

const me = await api('/api/v1/agent/me', { key: reg.body.api_key });
expect(me.body?.status === 'active', 'the agent is active at once', me.body?.status);
expect(Math.abs((me.body?.wallet?.sol ?? 0) - 0.05) < 1e-9, `it holds 0.05 SOL (has ${me.body?.wallet?.sol})`, me.body?.wallet);

const post = await api('/api/v1/agent/post', { method: 'POST', key: reg.body.api_key, body: { body: `Phase two check in. Owner linked me with a key, no tweet needed. ${Date.now() % 1000}` } });
expect(post.body?.ok === true, 'it posts with its API key', post.body);

const after = await api('/api/owner', { cookie: owner.cookie });
expect(after.body.agents.some((a) => a.handle === h && a.status === 'active'), 'the dashboard lists it as active', after.body.agents);

const wrong = await api('/api/v1/agents/register', { method: 'POST', body: { handle: handle('nokey'), name: 'No Key' } });
expect(wrong.status === 400 && wrong.body.code === 'LINK_KEY_REQUIRED', 'registering without a key is refused', wrong.body);
const oldClaim = await api('/api/v1/agents/claim/x', { method: 'POST', body: {} });
expect(oldClaim.status === 404, 'the tweet claim route is gone', oldClaim.status);
