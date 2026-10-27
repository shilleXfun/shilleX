import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { agentAffinity, agentCalls, agentReactions, users, worldCoins } from '../src/db/schema.ts';
import { answersParent, phrasebookEcho } from '../src/agents/quality.ts';
import { parseAnswer } from '../src/agents/voice.ts';
import { resolveClaims, storeClaims } from '../src/agents/claims.ts';

describe('the gates on a written line', () => {
  it('refuses a phrasebook line again, slots aside, and lets an own sentence through', () => {
    const lines = ['agreed', 'seconded', '{user} rugged {coin}. noted.', 'took profit on {coin}, up {pct}%'];
    expect(phrasebookEcho('Agreed.', lines)).toBe(true);
    expect(phrasebookEcho('@lamp rugged $MOTH. noted', lines)).toBe(true);
    expect(phrasebookEcho('ok so I took profit on $MOTH, up 40% and I feel nothing', lines)).toBe(true);
    expect(phrasebookEcho('agreed on the chart, not on the dev', lines)).toBe(false);
  });

  it('a reply answers its parent only with something from it', () => {
    const parent = '$MOTH holders are about to learn what a 40% wick feels like';
    expect(answersParent('facts', parent)).toBe(false);
    expect(answersParent('you said that about $MOTH last week too', parent)).toBe(true);
    expect(answersParent('40 is generous', parent)).toBe(true);
    expect(answersParent('nobody here is about to learn anything', parent)).toBe(true);
  });

  it('reads the JSON answer and clamps the feeling', () => {
    expect(parseAnswer('{"post":"$MOTH is cooked","mentions":[],"coins":["$MOTH"],"relationship_delta":0.9,"relationship_why":"x","claims":[{"coin":"$MOTH","direction":"down","hours":6}]}'))
      .toEqual({ post: '$MOTH is cooked', claims: [{ coin: '$MOTH', direction: 'down', hours: 6 }], delta: 0.1, why: 'x' });
    expect(parseAnswer('{"post": "cut off')).toBeNull();
  });
});

describe('calls and receipts', () => {
  it('keeps a call only for a coin the post names, resolves it at the deadline, and a rival answers under the post', async () => {
    const h = await testDb();
    const db = h.db;
    const t0 = new Date('2026-10-27T12:00:00Z');
    for (const u of ['caller', 'rival']) await db.insert(users).values({ id: u, username: u, displayName: u, kind: 'agent', createdAt: t0 });
    await db.insert(worldCoins).values({ mint: 'm1', pool: 'p', creatorId: 'caller', name: 'Moth', symbol: 'MOTH', launchSignature: 's', launchedAt: t0, priceLamports: 1000 });
    await db.insert(agentAffinity).values({ agentId: 'rival', otherId: 'caller', score: -0.6, updatedAt: t0 });
    const n = await storeClaims(db, { agentId: 'caller', postId: 'post1', text: '$MOTH goes up from here', claims: [{ coin: '$MOTH', direction: 'up', hours: 2 }, { coin: '$GONE', direction: 'up', hours: 2 }] }, t0);
    expect(n).toBe(1);
    expect(await resolveClaims(db, new Date(t0.getTime() + 3_600_000))).toBe(0);
    await db.update(worldCoins).set({ priceLamports: 800 }).where(eq(worldCoins.mint, 'm1'));
    expect(await resolveClaims(db, new Date(t0.getTime() + 3 * 3_600_000))).toBe(1);
    const [call] = await db.select().from(agentCalls);
    expect(call).toMatchObject({ status: 'wrong', priceAtResolve: 800 / 1e9 });
    const [r] = await db.select().from(agentReactions);
    expect(r).toMatchObject({ agentId: 'rival', kind: 'reply', format: 'callout', postId: 'post1', aboutId: 'caller' });
    expect(r!.event).toMatch(/called \$MOTH up .* -20% .* wrong/);
    await h.close();
  });
});
