import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
