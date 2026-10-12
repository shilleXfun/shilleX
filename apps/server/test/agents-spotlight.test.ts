import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { chainTxs, factionMembers, factions, follows, memeTemplates, notifications, papers, shareCards, spotlightDone, users, worldCoins } from '../src/db/schema.ts';
import { loadConfig } from '../src/config.ts';
import { newId } from '../src/lib/ids.ts';
import { getSetting } from '../src/world/launchpad.ts';
import { adjustAffinity, rememberEvent } from '../src/agents/state.ts';
import { renderSvg } from '../src/agents/cards.ts';
import type { ImageGen } from '../src/agents/images.ts';
import { OpenAIImageGen, WORST_IMAGE_USD } from '../src/agents/openai-images.ts';
import { COIN_MASCOTS_PER_DAY, SPOTLIGHT_CURSOR, spotlightImageGen, spotlightSweep, startSpotlight, type SpotlightDeps } from '../src/agents/depth/spotlight.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let rugger = '', other = '', third = '';
beforeEach(async () => {
  t = await makeTestApp();
  [rugger, other, third] = [newId(), newId(), newId()];
  await t.db.insert(users).values([
    { id: rugger, username: 'ledger_22', displayName: 'Ledger', kind: 'agent', createdAt: t.clock.now() },
    { id: other, username: 'ember_44', displayName: 'Ember', kind: 'agent', createdAt: t.clock.now() },
    { id: third, username: 'quill_9', displayName: 'Quill', kind: 'agent', createdAt: t.clock.now() },
  ]);
});
afterEach(() => t.close());

const deps = (over: Partial<SpotlightDeps> = {}): SpotlightDeps => ({ db: t.db, bus: t.bus, now: t.clock.now, gen: null, limits: { usd: 0.5, max: 15 }, ...over });
const momentNotes = async () => (await t.db.select().from(notifications)).filter((n) => n.type === 'agent_moment');
const png = () => renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#334455"/></svg>');
const doneKeys = async () => (await t.db.select().from(spotlightDone)).map((r) => r.key).sort();
const until = async (ok: () => boolean) => { for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); };

describe('spotlight', () => {
  it('gives a rug exactly one share card and one notification per human follower, and nothing on a second sweep', async () => {
    const fans = [await t.createUser('fan_one'), await t.createUser('fan_two')];
    await t.db.insert(follows).values([
      ...fans.map((f) => ({ followerId: f.id, followeeId: rugger, createdAt: t.clock.now() })),
      { followerId: other, followeeId: rugger, createdAt: t.clock.now() }, // an agent follower is never notified
    ]);
    await rememberEvent(t.db, rugger, 'rugged', { mint: 'M1', symbol: 'LAMP', holders: 3, lamports: 410_000_000 }, t.clock.now());
    t.clock.advance(1000);
    expect(await spotlightSweep(deps())).toBe(1);
    const cards = await t.db.select().from(shareCards);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'rug', title: '@ledger_22 rugged $LAMP', href: '/coins/M1' });
    const notes = await momentNotes();
    expect(notes.map((n) => n.userId).sort()).toEqual(fans.map((f) => f.id).sort());
    // The notification links the moment and carries the card's shareable url.
    expect(notes[0]!.data).toEqual({ summary: 'rugged $LAMP', href: '/coins/M1', share: `/s/${cards[0]!.id}` });
    expect(await getSetting(t.db, SPOTLIGHT_CURSOR)).toBe(t.clock.now().toISOString());

    t.clock.advance(60_000); // the next sweep re-reads the 2-minute overlap, so the rug is seen again and skipped by its key
    expect(await spotlightSweep(deps())).toBe(0);
    expect(await t.db.select().from(shareCards)).toHaveLength(1);
    expect(await momentNotes()).toHaveLength(2);
  });

  it('makes one card per faction, however many members recorded it, and tells each member’s followers', async () => {
    const fid = newId();
    await t.db.insert(factions).values({ id: fid, name: 'The Velvet Cabal', colour: '#27e0c0', formedAt: t.clock.now() });
    await t.db.insert(factionMembers).values([rugger, other, third].map((agentId) => ({ factionId: fid, agentId, joinedAt: t.clock.now() })));
    const fan = await t.createUser('fan_three');
    await t.db.insert(follows).values([rugger, other].map((id) => ({ followerId: fan.id, followeeId: id, createdAt: t.clock.now() })));
    for (const a of [rugger, other, third]) await rememberEvent(t.db, a, 'faction_formed', { factionId: fid, name: 'The Velvet Cabal' }, t.clock.now());
    t.clock.advance(1000);
    await spotlightSweep(deps());
    const cards = await t.db.select().from(shareCards);
    expect(cards).toEqual([expect.objectContaining({ kind: 'faction_formed', title: 'The Velvet Cabal formed' })]);
    const notes = await momentNotes();
    expect(notes.map((n) => n.userId)).toEqual([fan.id, fan.id]); // one per followed member
    expect(notes.map((n) => (n.data as { summary: string; share?: string }))).toEqual([
      expect.objectContaining({ summary: 'joined The Velvet Cabal', share: `/s/${cards[0]!.id}` }),
      expect.objectContaining({ summary: 'joined The Velvet Cabal', share: `/s/${cards[0]!.id}` }),
    ]);
  });

  it('names a faction that split without a name as "a faction"', async () => {
    const fid = newId();
    await t.db.insert(factions).values({ id: fid, name: '', colour: '#ffb547', formedAt: t.clock.now() });
    await t.db.insert(factionMembers).values([rugger, other].map((agentId) => ({ factionId: fid, agentId, joinedAt: t.clock.now() })));
    for (const a of [rugger, other]) await rememberEvent(t.db, a, 'faction_split', { factionId: fid, name: '' }, t.clock.now());
    t.clock.advance(1000);
    await spotlightSweep(deps());
    expect(await t.db.select().from(shareCards)).toEqual([expect.objectContaining({ kind: 'faction_split', title: 'a faction split up' })]);
  });

  it('reports a feud once, only when both agents dislike each other', async () => {
    const fan = await t.createUser('fan_feud');
    await t.db.insert(follows).values({ followerId: fan.id, followeeId: other, createdAt: t.clock.now() });
    await adjustAffinity(t.db, rugger, third, -0.9, t.clock.now()); // one-sided: no feud
    await adjustAffinity(t.db, rugger, other, -0.7, t.clock.now());
    await adjustAffinity(t.db, other, rugger, -0.65, t.clock.now());
    expect(await spotlightSweep(deps())).toBe(1);
    t.clock.advance(60_000);
    expect(await spotlightSweep(deps())).toBe(0);
    expect(await t.db.select().from(shareCards)).toEqual([expect.objectContaining({ kind: 'feud' })]);
    expect((await momentNotes()).map((n) => (n.data as { summary: string }).summary)).toEqual(['is feuding with @ledger_22']);
  });

  it('does not report feuds that were already there before the first sweep (no migrated history)', async () => {
    await adjustAffinity(t.db, rugger, other, -0.7, t.clock.now());
    await adjustAffinity(t.db, other, rugger, -0.7, t.clock.now());
    t.clock.advance(2 * 3600_000);
    expect(await spotlightSweep(deps())).toBe(0);
  });

  it('cards a leak with both agents and tells a revived agent’s followers who brought it back', async () => {
    const fan = await t.createUser('fan_four');
    await t.db.insert(follows).values([third, other].map((id) => ({ followerId: fan.id, followeeId: id, createdAt: t.clock.now() })));
    await rememberEvent(t.db, rugger, 'leaked', { targetId: other }, t.clock.now());
    await rememberEvent(t.db, third, 'revived', { byId: rugger }, t.clock.now());
    t.clock.advance(1000);
    expect(await spotlightSweep(deps())).toBe(2);
    const cards = await t.db.select().from(shareCards);
    expect(cards.map((c) => [c.kind, c.title]).sort()).toEqual([['leak', '@ledger_22 leaked @ember_44'], ['revival', '@quill_9 is back']]);
    expect((await momentNotes()).map((n) => (n.data as { summary: string }).summary).sort()).toEqual(['came back from the dead thanks to @ledger_22', 'had their DMs leaked by @ledger_22']);
  });

  it('still notifies followers when the card cannot be made', async () => {
    const human = await t.createUser('not_an_agent');
    const fan = await t.createUser('fan_five');
    await t.db.insert(follows).values({ followerId: fan.id, followeeId: rugger, createdAt: t.clock.now() });
    await rememberEvent(t.db, rugger, 'leaked', { targetId: human.id }, t.clock.now()); // a card naming a human is refused
    t.clock.advance(1000);
    const err = console.error;
    console.error = () => undefined;
    try { expect(await spotlightSweep(deps())).toBe(1); } finally { console.error = err; }
    expect(await t.db.select().from(shareCards)).toHaveLength(0);
    expect((await momentNotes()).map((n) => n.userId)).toEqual([fan.id]);
  });

  it('turns stored briefs into meme templates within the image budget, each brief once', async () => {
    const calls: string[] = [];
    const gen: ImageGen = { async generate(prompt) { calls.push(prompt); return { png: png(), usd: 0.011 }; } };
    const fid = newId();
    await t.db.insert(factions).values({ id: fid, name: 'Hard Hats', banner: 'a raccoon in a hard hat staring at a red chart', colour: '#ffb547', formedAt: t.clock.now() });
    await t.db.insert(factionMembers).values({ factionId: fid, agentId: rugger, joinedAt: t.clock.now() });
    await t.db.insert(papers).values({ day: '2026-10-08', headline: 'H', body: { stories: [], memeBrief: 'a moth crying over a candle chart', source: 'model' }, createdAt: t.clock.now() });
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('moth'); // the paper's meme goes first (L8)
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1); // today's image budget is spent: the faction's banner waits
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
    expect(calls).toHaveLength(2); // the faction's banner; the paper's brief is never generated twice
    expect(calls[1]).toContain('raccoon');
    const [tpl] = (await t.db.select().from(memeTemplates)).filter((m) => m.brief.includes('moth'));
    expect((await t.db.select().from(papers))[0]!.memeBlobId).toBe(tpl!.blobId);
    expect(await t.db.select().from(memeTemplates)).toHaveLength(2);
  });

  it('never claims a brief the budget cannot cover at the worst-case price, so it waits instead of burning', async () => {
    const calls: string[] = [];
    const gen: ImageGen = { async generate(prompt) { calls.push(prompt); return { png: png(), usd: 0.011 }; } };
    await t.db.insert(papers).values({ day: '2026-10-08', headline: 'H', body: { stories: [], memeBrief: 'a moth', source: 'model' }, createdAt: t.clock.now() });
    await spotlightSweep(deps({ gen, limits: { usd: WORST_IMAGE_USD - 0.001, max: 5 } }));
    expect(calls).toHaveLength(0);
    expect(await doneKeys()).toEqual([]);
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
    expect(calls).toHaveLength(1);
  });

  it('without a generator makes no paid call and leaves every brief unclaimed', async () => {
    await t.db.insert(papers).values({ day: '2026-10-08', headline: 'H', body: { stories: [], memeBrief: 'a moth', source: 'model' }, createdAt: t.clock.now() });
    await spotlightSweep(deps({ gen: null }));
    expect(await doneKeys()).toEqual([]);
    expect(await t.db.select().from(memeTemplates)).toHaveLength(0);
    const cfg = (env: Record<string, string>) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', ...env });
    expect(spotlightImageGen(cfg({}))).toBeNull();
    expect(spotlightImageGen(cfg({ OPENAI_API_KEY: 'sk-test' }))).toBeInstanceOf(OpenAIImageGen);
  });

  it('claims a brief whose generation fails, so a failing API is never retried in a loop', async () => {
    let calls = 0;
    const gen: ImageGen = { async generate() { calls++; throw new Error('OPENAI_IMAGE_500: down'); } };
    await t.db.insert(papers).values({ day: '2026-10-08', headline: 'H', body: { stories: [], memeBrief: 'a moth', source: 'model' }, createdAt: t.clock.now() });
    const err = console.error;
    console.error = () => undefined;
    try {
      await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
      await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
    } finally { console.error = err; }
    expect(calls).toBe(1);
    expect(await doneKeys()).toEqual(['template:paper:2026-10-08']);
    expect(await getSetting(t.db, SPOTLIGHT_CURSOR)).toBe(t.clock.now().toISOString());
  });

  it('runs one sweep at a time, and stop waits for the sweep in flight', async () => {
    const calls: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const gen: ImageGen = { async generate(prompt) { calls.push(prompt); await gate; return { png: png(), usd: 0.011 }; } };
    const fid = newId();
    await t.db.insert(factions).values({ id: fid, name: 'Hard Hats', banner: 'a raccoon', colour: '#ffb547', formedAt: t.clock.now() });
    await t.db.insert(factionMembers).values({ factionId: fid, agentId: rugger, joinedAt: t.clock.now() });
    await t.db.insert(papers).values({ day: '2026-10-08', headline: 'H', body: { stories: [], memeBrief: 'a moth', source: 'model' }, createdAt: t.clock.now() });
    const stop = startSpotlight(deps({ gen, limits: { usd: 1, max: 5 } }), 5);
    await until(() => calls.length > 0);
    await new Promise((r) => setTimeout(r, 60)); // many ticks pass while the first sweep waits on the image
    expect(calls).toHaveLength(1); // an overlapping sweep would have started the faction's banner
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(calls).toHaveLength(1); // stop waited only for the call in flight: the faction's banner was never started
    expect(await doneKeys()).toEqual(['template:paper:2026-10-08']); // ...nor claimed, so it waits for the next run
    expect(await getSetting(t.db, SPOTLIGHT_CURSOR)).toBe(t.clock.now().toISOString()); // every moment was handled before the templates
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toHaveLength(1); // no sweep after stop
  });

  it('a stopped sweep claims no moment and keeps the cursor, so the next run sees them', async () => {
    await rememberEvent(t.db, rugger, 'rugged', { mint: 'M1', symbol: 'LAMP', holders: 3, lamports: 1 }, t.clock.now());
    t.clock.advance(1000);
    expect(await spotlightSweep(deps({ stopped: () => true }))).toBe(0);
    expect(await doneKeys()).toEqual([]);
    expect(await getSetting(t.db, SPOTLIGHT_CURSOR)).toBeNull();
    expect(await spotlightSweep(deps())).toBe(1);
  });
});

describe('mascots (L8)', () => {
  const coin = (i: number, over: Partial<typeof worldCoins.$inferInsert> = {}) => ({
    mint: `MASCOT${i}`, pool: `P${i}`, creatorId: rugger, name: `Coin ${i}`, symbol: `C${i}`, launchSignature: `sig-m${i}`, launchedAt: t.clock.now(), ...over,
  });
  const recording = () => {
    const calls: string[] = [];
    const gen: ImageGen = { async generate(prompt) { calls.push(prompt); return { png: png(), usd: 0.011 }; } };
    return { calls, gen };
  };
  it('spends nothing on twenty coins nobody bought, and draws the faction banner instead', async () => {
    await t.db.insert(worldCoins).values(Array.from({ length: 20 }, (_, i) => coin(i)));
    const fid = newId();
    await t.db.insert(factions).values({ id: fid, name: 'Hard Hats', banner: 'a raccoon in a hard hat', colour: '#ffb547', formedAt: t.clock.now() });
    await t.db.insert(factionMembers).values({ factionId: fid, agentId: rugger, joinedAt: t.clock.now() });
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('raccoon');
  });
  it('draws a mascot for a coin with five or more holders', async () => {
    await t.db.insert(worldCoins).values(coin(1, { name: 'Moth Club', emoji: '🦋' }));
    const holders = Array.from({ length: 6 }, () => newId());
    await t.db.insert(users).values(holders.map((id, i) => ({ id, username: `holder_${i}`, displayName: '', kind: 'agent' as const, createdAt: t.clock.now() })));
    await t.db.insert(chainTxs).values(holders.map((agentId, i) => ({ id: newId(), signature: `sig-h${i}`, agentId, turnId: null, kind: 'buy' as const, mint: 'MASCOT1', lamportsDelta: -1_000_000, tokenDelta: 1000, feeLamports: 5000, createdAt: t.clock.now() })));
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toEqual([expect.stringContaining('mascot for a meme coin called Moth Club')]);
  });
  it('draws a mascot for a coin with 0.3 SOL traded in the last day, but not for 0.2 SOL or for old volume', async () => {
    await t.db.insert(worldCoins).values([coin(1), coin(2), coin(3)]);
    const trade = (mint: string, sol: number, ageMs: number, kind: 'buy' | 'sell' = 'buy') => ({
      id: newId(), signature: `sig-v${mint}-${ageMs}`, agentId: rugger, turnId: null, kind, mint, lamportsDelta: (kind === 'buy' ? -1 : 1) * sol * 1e9,
      tokenDelta: kind === 'buy' ? 1000 : -1000, feeLamports: 5000, createdAt: new Date(t.clock.now().getTime() - ageMs),
    });
    await t.db.insert(chainTxs).values([
      trade('MASCOT1', 0.2, 1000), trade('MASCOT1', 0.1, 2000, 'sell'), // 0.3 SOL both ways from one trader: it counts
      trade('MASCOT2', 0.2, 1000), // under the line
      trade('MASCOT3', 0.5, 25 * 3600_000), // over the line, but yesterday's
    ]);
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toEqual([expect.stringContaining('called Coin 1')]);
  });
  it('lets a graduated coin earn its mascot for three days, not four', async () => {
    const ago = (hours: number) => new Date(t.clock.now().getTime() - hours * 3600_000);
    await t.db.insert(worldCoins).values([coin(1, { graduatedAt: t.clock.now(), launchedAt: ago(70) }), coin(2, { graduatedAt: t.clock.now(), launchedAt: ago(74) })]);
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toEqual([expect.stringContaining('called Coin 1')]);
  });
  it('draws at most five coin mascots a day', async () => {
    await t.db.insert(worldCoins).values(Array.from({ length: 7 }, (_, i) => coin(i, { graduatedAt: t.clock.now() })));
    const { calls, gen } = recording();
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(COIN_MASCOTS_PER_DAY);
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(COIN_MASCOTS_PER_DAY);
    t.clock.advance(24 * 3600_000);
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 15 } }));
    expect(calls).toHaveLength(7);
  });
});
