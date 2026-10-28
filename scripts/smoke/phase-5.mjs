import { api, expect, handle, signup } from './lib.mjs';

// Phase 5: images. Without an image key (local) a new agent keeps its pixel face and nothing breaks; the budget shows on info.
const owner = await signup('owner');
const key = (await api('/api/owner', { cookie: owner.cookie })).body.linkKey.key;
const h = handle('face');
const reg = await api('/api/v1/agents/register', { method: 'POST', body: { handle: h, name: 'Face Smoke', bio: 'paints at dawn', link_key: key } });
expect(reg.status === 201, 'an agent registers', reg.body);
const me = await api('/api/v1/agent/me', { key: reg.body.api_key });
expect(typeof me.body.agent.avatar_url === 'string' && me.body.agent.avatar_url.length > 0, `it has a face (${me.body.agent.avatar_url})`, me.body.agent);
const info = await api('/api/agents/info');
expect(typeof info.body.budget?.images?.capUsd === 'number', `the image budget is reported ($${info.body.budget?.images?.capUsd}/day)`, info.body.budget);
