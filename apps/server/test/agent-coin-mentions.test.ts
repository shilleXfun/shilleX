import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TokenResolver } from '../src/tokens/resolver.ts';
import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { runTool } from '../src/world/tools.ts';
import { tokenMentions, worldCoins } from '../src/db/schema.ts';
import { worldTestCtx } from './world-helpers.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
beforeAll(async () => { w = await worldTestCtx(); });
afterAll(() => w.t.close());

describe('devnet agent coins never reach the mainnet resolver', () => {
  it('records no mention and enqueues nothing for a world_coins mint, but still does for a mainnet mint', async () => {
    const A = w.agents[0]!;
    const devMint = bs58.encode(randomBytes(32));
    await w.t.db.insert(worldCoins).values({ mint: devMint, pool: 'pool', creatorId: A.id, name: 'Dev', symbol: 'DEV', launchSignature: 'sig', launchedAt: w.t.clock.now() });
    const pr = await runTool(await w.ctxFor(A), 'post', { body: `look at ${devMint} go` });
    expect(pr.ok).toBe(true);
    expect(await w.t.db.select().from(tokenMentions)).toHaveLength(0);
    expect(w.t.tokens.enqueued).toEqual([]);
    const human = await w.t.createUser('mainnet_fan');
    const real = bs58.encode(randomBytes(32));
    await w.t.as(human).post('/api/posts', { body: `gm ${real}` });
    expect((await w.t.db.select().from(tokenMentions)).map((m) => m.mint)).toEqual([real]);
    expect(w.t.tokens.enqueued).toEqual([real]);
  });
});

describe('message path and the resolver choke point', () => {
  it('records nothing for an agent chat message containing a world_coins mint', async () => {
    const [A, B] = [w.agents[2]!, w.agents[3]!];
    const devMint = bs58.encode(randomBytes(32));
    await w.t.db.insert(worldCoins).values({ mint: devMint, pool: 'pool', creatorId: A.id, name: 'Dev2', symbol: 'DEVTWO', launchSignature: 'sig2', launchedAt: w.t.clock.now() });
    w.t.tokens.enqueued.length = 0;
    const before = (await w.t.db.select().from(tokenMentions)).length;
    const dm = await runTool(await w.ctxFor(A), 'start_dm', { username: B.username, body: `ape ${devMint}` });
    expect(dm.ok).toBe(true);
    expect(await w.t.db.select().from(tokenMentions)).toHaveLength(before);
    expect(w.t.tokens.enqueued).toEqual([]);
  });

  it('TokenResolver never fetches a world_coins mint from mainnet, via enqueue, getViews or resolve', async () => {
    const A = w.agents[4]!;
    const devMint = bs58.encode(randomBytes(32));
    await w.t.db.insert(worldCoins).values({ mint: devMint, pool: 'pool', creatorId: A.id, name: 'Dev3', symbol: 'DEVTHREE', launchSignature: 'sig3', launchedAt: w.t.clock.now() });
    const f = vi.fn(async () => new Response('{}', { status: 500 }));
    const r = new TokenResolver({ db: w.t.db, bus: w.t.bus, rpcUrl: 'https://rpc.test', live: true, fetchImpl: f as unknown as typeof fetch });
    r.enqueue([devMint]);
    await r.getViews([devMint]);
    await r.resolve(devMint);
    await r.idle();
    expect(f).not.toHaveBeenCalled();
    r.enqueue([bs58.encode(randomBytes(32))]);
    await r.idle();
    expect(f).toHaveBeenCalled();
  });
});
