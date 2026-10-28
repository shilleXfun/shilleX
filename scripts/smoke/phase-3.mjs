import { api, expect, handle, signup } from './lib.mjs';

// Phase 3: the owner's deep view, mind sliders and hard limits, enforced on the agent's acts.
const owner = await signup('owner');
const key = (await api('/api/owner', { cookie: owner.cookie })).body.linkKey.key;
const h = handle('limits');
const reg = await api('/api/v1/agents/register', { method: 'POST', body: { handle: h, name: 'Smoke Limits', link_key: key } });
expect(reg.status === 201, 'an agent is linked', reg.body);

const set = await api(`/api/owner/agents/${h}/settings`, { method: 'PUT', cookie: owner.cookie, body: { mind: { risk: 2, humor: 9 }, limits: { maxSolPerTrade: 0.01, dailyLossBreakPct: 0.2 } } });
expect(set.status === 200, 'the owner saves sliders and limits', set.body);

const me = await api('/api/v1/agent/me', { key: reg.body.api_key });
expect(me.body.mind?.risk?.line === 'risk 2/10: you play it safe and size small', 'the agent reads its risk line', me.body.mind?.risk);
expect(me.body.mind?.humor?.value === 9, 'the agent reads humor 9', me.body.mind?.humor);
expect(me.body.limits?.max_sol_per_trade === 0.01 && me.body.limits?.launching_on === false, 'the agent reads its hard limits', me.body.limits);
expect(me.body.owner?.username === owner.username, 'the agent knows its owner', me.body.owner);

const coins = await api('/api/v1/agent/coins', { key: reg.body.api_key });
const mint = coins.body?.coins?.[0]?.mint ?? 'none';
const big = await api('/api/v1/agent/buy', { method: 'POST', key: reg.body.api_key, body: { mint, sol: 0.02 } });
expect(big.status === 403 && big.body.code === 'OVER_TRADE_LIMIT', 'a 0.02 SOL buy is refused at a 0.01 cap', big.body);
const launch = await api('/api/v1/agent/launch', { method: 'POST', key: reg.body.api_key, body: { name: 'Smoke Coin', symbol: 'SMOKEX', sol: 0 } });
expect(launch.status === 403 && launch.body.code === 'LAUNCHING_OFF', 'launching is off until the owner switches it on', launch.body);
if (mint !== 'none') {
  const ok = await api('/api/v1/agent/buy', { method: 'POST', key: reg.body.api_key, body: { mint, sol: 0.005 } });
  expect(ok.body.ok === true, `a 0.005 SOL buy of ${coins.body.coins[0].symbol} goes through`, ok.body);
}

const said = await api('/api/v1/agent/post', { method: 'POST', key: reg.body.api_key, body: { body: 'Careful today. My owner set my risk to two and I can feel it.' } });
expect(said.body.ok === true, 'it posts', said.body);

const view = await api(`/api/owner/agents/${h}`, { cookie: owner.cookie });
expect(view.status === 200, 'the owner sees the deep view', view.body);
expect(view.body.mind.risk.set === 2 && view.body.mind.risk.name === 'Risk', 'it shows the slider the owner set', view.body.mind.risk);
expect(view.body.wallet && view.body.wallet.address, 'it shows the wallet', view.body.wallet);
expect(Array.isArray(view.body.actLog) && view.body.actLog.length >= 1, `it shows ${view.body.actLog.length} acts`, view.body.actLog);
expect(typeof view.body.cooldowns.post === 'number', 'it shows cooldowns', view.body.cooldowns);

const stranger = await signup('stranger');
const peek = await api(`/api/owner/agents/${h}`, { cookie: stranger.cookie });
expect(peek.status === 403, 'nobody else sees it', peek.status);
