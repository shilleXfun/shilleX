import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { launchWords, pickSymbol, postWords } from '../src/agents/tickers.ts';
import { currentWeather, nextRegime } from '../src/agents/depth/weather.ts';
import { paperFacts } from '../src/agents/depth/paper.ts';
import { weather, worldCoins, xTopics } from '../src/db/schema.ts';
import { makeTestApp } from './helpers.ts';
import { depthTestCtx } from './depth-helpers.ts';
import { newId } from '../src/lib/ids.ts';
import { mulberry32 } from '../src/seed/rng.ts';
import { perceive } from '../src/agents/perceive.ts';
import { act } from '../src/agents/act.ts';
import { clearNewsCache } from '../src/x/news.ts';

const H = 3600_000;
const topicRow = (now: Date, over: Partial<typeof xTopics.$inferInsert> = {}) => ({ id: newId(), label: 'solana etf filing', words: ['solana'], avoidSymbols: [], sentiment: 0, heat: 1,
  sourcePostIds: ['1'], sourceHandle: null, createdAt: now, expiresAt: new Date(now.getTime() + 3 * H), ...over });

describe('themed launches (x-feed §5.3)', () => {
  it('draws on a live topic’s words 40% of the time, and leaves the order alone without topics', () => {
    const base = { interests: ['coffee'], ownPosts: [], grudges: [] };
    expect(launchWords({ ...base, topics: ['solana'] }, () => 0.1)[0]).toBe('solana');
    expect(launchWords({ ...base, topics: ['solana'] }, () => 0.9)[0]).not.toBe('solana');
    expect(launchWords(base, mulberry32(3))).toEqual(launchWords({ ...base, topics: [] }, mulberry32(3)));
  });
  it('never names a coin after a news post’s source link or the X handle in it', () => {
    expect(postWords(['solana etf filing. thoughts?\nvia x.com/lamplighter · https://x.com/lamplighter/status/1800000000000000010', 'look\nhttps://x.com/i/web/status/9'])).toEqual(['solana', 'etf', 'filing']);
  });
  it('a launch never takes a symbol trending on X', async () => {
    const c = await depthTestCtx(11);
    try {
      await c.t.db.insert(xTopics).values(topicRow(c.t.clock.now(), { words: ['moth'], avoidSymbols: ['MOTH'] }));
      clearNewsCache(c.t.db);
      const agent = c.agents[9]!;
      const v = await perceive(c.d, agent.id);
      expect(v.news?.avoidSymbols).toEqual(['MOTH']);
      const r = await act(c.d, { ...v, phrasebook: { ...v.phrasebook, interests: ['moth'] } }, { kind: 'launch', score: 1, lamports: 0, situation: 'launching', reason: 'test' });
      expect(r.ok).toBe(true);
      const [coin] = await c.t.db.select().from(worldCoins).where(eq(worldCoins.creatorId, agent.id));
      expect(coin!.symbol).not.toBe('MOTH');
    } finally { await c.t.close(); }
  });
});

describe('the weather tilt (x-feed §5.4)', () => {
  const share = (tilt: number, regime: string) => {
    const r = mulberry32(5);
    let n = 0;
    for (let i = 0; i < 20_000; i++) if (nextRegime('grind', r, tilt).regime === regime) n++;
    return n / 20_000;
  };
  it('doubles fear’s weight at ≤ -0.4 and euphoria’s at ≥ 0.4, and nothing in between', () => {
    expect(share(0, 'fear')).toBeCloseTo(0.25, 1);
    expect(share(-0.5, 'fear')).toBeCloseTo(0.4, 1);   // 0.5 of 1.25
    expect(share(0.5, 'euphoria')).toBeCloseTo(0.4, 1);
    expect(share(0.3, 'euphoria')).toBeCloseTo(0.25, 1);
  });
  it('keeps the rules: never opens in fear, chaos never repeats', () => {
    for (let i = 0; i < 500; i++) expect(nextRegime(null, mulberry32(i), -1).regime).not.toBe('fear');
    for (let i = 0; i < 500; i++) expect(nextRegime('chaos', mulberry32(i), 1).regime).not.toBe('chaos');
  });
  it('the next regime reads the live topics’ mood', async () => {
    const roll = async (sentiment: number | null) => {
      const t = await makeTestApp();
      try {
        const now = t.clock.now();
        await t.db.insert(weather).values({ id: newId(), regime: 'grind', startedAt: new Date(now.getTime() - 3 * H), endsAt: new Date(now.getTime() - 60_000) });
        if (sentiment !== null) await t.db.insert(xTopics).values(topicRow(now, { sentiment }));
        return (await currentWeather(t.db, now, () => 0.3)).regime;
      } finally { await t.close(); }
    };
    expect(await roll(null)).toBe('grind');      // 0.3 of 1.0 lands in grind
    expect(await roll(0.8)).toBe('euphoria');    // 0.375 of 1.25 lands in a doubled euphoria
  });
});

describe('the paper (x-feed §5.5)', () => {
  it('gets one "From X" item with the day’s three hottest topics', async () => {
    const t = await makeTestApp();
    try {
      const now = t.clock.now();
      await t.db.insert(xTopics).values([0.9, 0.8, 0.7, 0.1].map((heat, i) => topicRow(now, { label: `topic ${i}`, heat })));
      const facts = await paperFacts(t.db, now.toISOString().slice(0, 10));
      expect(facts.items.filter((i) => i.kind === 'from_x')).toEqual([{ kind: 'from_x', agentId: null, weight: 3.5, text: 'From X: topic 0; topic 1; topic 2' }]);
    } finally { await t.close(); }
  });
});
