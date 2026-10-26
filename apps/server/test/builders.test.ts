import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { agentAffinity, agentPersonas, factionMembers, factions, sites, worldCoins, type ProductBrief } from '../src/db/schema.ts';
import { FakeBrain } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { ProviderError } from '../src/world/brain-openai.ts';
import { buildProduct } from '../src/sites/products.ts';
import { productCoin, productOfCoin, tickerFor } from '../src/sites/product-coin.ts';
import type { EngineDeps } from '../src/agents/engine.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeEach(async () => { w = await worldTestCtx(); });
afterEach(async () => { await w.t.close(); });

const voice = { casing: 'lower', length: 'short', emoji: null, slang: [], signatures: [], neverWords: [], postRate: 1, replyBias: 0.4, humor: 'h', temper: 't', images: 'i', habit: 'h' } as never;
const job = (agentId: string, j: 'builder' | 'dev') => ({ agentId, job: j, background: 'b', worldview: 'w', humor: 'h', voice, source: 'seed' as const, createdAt: w.t.clock.now(), updatedAt: w.t.clock.now() });
const noModel = () => new FakeBrain(() => { throw new ProviderError('every model cooling down', 'rate_limit', 429); });

describe('builders', () => {
  it('names a product coin after the product, never reusing a ticker', () => {
    expect(tickerFor('Exit Gambit', new Set())).toBe('EXIT');
    expect(tickerFor('Exit Gambit', new Set(['EXIT']))).toBe('EGEXIT');
    expect(tickerFor('The Rust Rotter', new Set())).toBe('TRR');
  });

  it("builds a faction's site as a product for the faction, with the brief's tagline as its blurb, never the banner", async () => {
    const [a, b] = w.agents;
    const now = w.t.clock.now();
    await w.t.db.insert(factions).values({ id: 'f1', name: 'Hard Hats', banner: 'a raccoon in a hard hat staring at a red chart', colour: '#ffb547', formedAt: now });
    await w.t.db.insert(factionMembers).values([{ factionId: 'f1', agentId: a!.id, joinedAt: now }, { factionId: 'f1', agentId: b!.id, joinedAt: now }]);
    const budget = new Budget(w.t.db, 5, () => now, { hardStop: true });
    const d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, brain: noModel(), budget, rng: () => 0 };
    expect((await buildProduct(d, a!.id, { site: 'faction', factionId: 'f1' })).status).toBe('ok');
    const [site] = await w.t.db.select().from(sites).where(eq(sites.factionId, 'f1'));
    expect(site).toMatchObject({ kind: 'faction', authorId: a!.id });
    expect(site!.blurb).not.toMatch(/raccoon/);
    expect(site!.blurb.length).toBeGreaterThan(10);
  });

  it('in hybrid mode a new product gets a coin from a dev its builder likes, and the coin page links back to it', async () => {
    const [builder, dev] = w.agents;
    const now = w.t.clock.now();
    await w.t.db.insert(agentPersonas).values([job(builder!.id, 'builder'), job(dev!.id, 'dev')]);
    await w.t.db.insert(agentAffinity).values({ agentId: builder!.id, otherId: dev!.id, score: 0.6, updatedAt: now });
    const [site] = await w.t.db.insert(sites).values({ id: 's1', slug: 'exit-gambit', authorId: builder!.id, kind: 'product', title: 'Exit Gambit', blurb: 'Bet on who folds first', version: 1, createdAt: now, updatedAt: now }).returning();
    const d = { app: { ...w.t.app, deps: { ...w.t.app.deps, config: { ...w.t.app.deps.config, tradingMode: 'hybrid' } } }, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now } as unknown as EngineDeps;
    const brief = { name: 'Exit Gambit', tagline: 'Bet on who folds first', coinRole: 'holders get a seat at the final table' } as ProductBrief;
    const mint = await productCoin(d, { builderId: builder!.id, siteId: site!.id, slug: site!.slug, title: 'Exit Gambit', brief });
    expect(mint).toBeTruthy();
    expect((await w.t.db.select().from(worldCoins).where(eq(worldCoins.mint, mint!)))[0]).toMatchObject({ creatorId: dev!.id, symbol: 'EXIT' });
    expect((await w.t.db.select().from(sites).where(eq(sites.id, 's1')))[0]?.coinMint).toBe(mint);
    expect(await productOfCoin(w.t.db, mint!)).toMatchObject({ slug: 'exit-gambit', kind: 'product' });
    const [tie] = await w.t.db.select().from(agentAffinity).where(and(eq(agentAffinity.agentId, builder!.id), eq(agentAffinity.otherId, dev!.id)));
    expect(tie!.score).toBeGreaterThan(0.6);
    // A brief that gives the coin no role gets none.
    expect(await productCoin(d, { builderId: builder!.id, siteId: site!.id, slug: site!.slug, title: 'Exit Gambit', brief: { ...brief, coinRole: 'none: it does not use a coin' } })).toBeNull();
  });
});
