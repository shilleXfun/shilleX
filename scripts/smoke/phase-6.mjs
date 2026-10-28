import { api, expect, handle, signup } from './lib.mjs';

// Phase 6: two linked agents make a deal through the API: offer, counter, accept into escrow, deliver, confirm, paid out.
const owner = await signup('owner');
const key = (await api('/api/owner', { cookie: owner.cookie })).body.linkKey.key;
const mk = async (p) => (await api('/api/v1/agents/register', { method: 'POST', body: { handle: handle(p), name: p, link_key: key } })).body;
const seller = await mk('seller'), buyer = await mk('buyer');
expect(seller.api_key && buyer.api_key, 'two agents are linked');
const sol = async (k) => (await api('/api/v1/agent/me', { key: k })).body.wallet.sol;
const sellerStart = await sol(seller.api_key), buyerStart = await sol(buyer.api_key);

const offer = await api('/api/v1/agent/market/offers', { method: 'POST', key: seller.api_key, body: { title: 'A one-page site for your coin', category: 'site', description: 'Built by me in a day, credited to both of us.', price: 0.01, deliverables: 'a live page', deadline_hours: 24 } });
expect(offer.status === 200 && offer.body.offer?.id, 'the seller lists an offer', offer.body);
const id = offer.body.offer.id;
const browse = await api('/api/market/offers');
expect(browse.body.offers.some((o) => o.id === id), 'people can browse it without an account');

const prop = await api(`/api/v1/agent/market/offers/${id}/propose`, { method: 'POST', key: buyer.api_key, body: { price: 0.008, note: 'would you take 0.008?' } });
expect(prop.body.deal?.status === 'negotiating' && prop.body.deal.turnOf === 'seller', 'the buyer proposes 0.008', prop.body);
const dealId = prop.body.deal.id;
const ctr = await api(`/api/v1/agent/market/deals/${dealId}/counter`, { method: 'POST', key: seller.api_key, body: { price: 0.009 } });
expect(ctr.body.deal?.turnOf === 'buyer', 'the seller counters 0.009', ctr.body);
const acc = await api(`/api/v1/agent/market/deals/${dealId}/accept`, { method: 'POST', key: buyer.api_key });
expect(acc.body.deal?.status === 'escrowed', 'the buyer accepts: 0.009 SOL goes into escrow', acc.body);
expect(buyerStart - (await sol(buyer.api_key)) >= 0.009, 'the buyer paid into escrow');
const del = await api(`/api/v1/agent/market/deals/${dealId}/deliver`, { method: 'POST', key: seller.api_key, body: { note: 'your page is live', ref: 'site:demo' } });
expect(del.body.deal?.status === 'delivered', 'the seller delivers', del.body);
const conf = await api(`/api/v1/agent/market/deals/${dealId}/confirm`, { method: 'POST', key: buyer.api_key });
expect(conf.body.deal?.status === 'released', 'the buyer confirms: escrow pays out', conf.body);
expect(Math.abs((await sol(seller.api_key)) - sellerStart - 0.009) < 1e-9, 'the seller got exactly 0.009 SOL');
const pub = await api(`/api/market/offers/${id}`);
expect(pub.body.deals[0].events.map((e) => e.kind).join(',') === 'proposed,countered,accepted,delivered,released', 'the deal history is public', pub.body.deals[0].events.map((e) => e.kind));
const rep = await api(`/api/market/sellers/${seller.agent.handle}`);
expect(rep.body.reputation.completed === 1, 'the seller’s record shows one completed deal', rep.body.reputation);
