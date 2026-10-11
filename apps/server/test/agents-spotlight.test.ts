import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { factionMembers, factions, follows, memeTemplates, notifications, papers, shareCards, spotlightDone, users } from '../src/db/schema.ts';
import { loadConfig } from '../src/config.ts';
import { newId } from '../src/lib/ids.ts';
import { getSetting } from '../src/world/launchpad.ts';
import { adjustAffinity, rememberEvent } from '../src/agents/state.ts';
import { renderSvg } from '../src/agents/cards.ts';
import type { ImageGen } from '../src/agents/images.ts';
import { OpenAIImageGen, WORST_IMAGE_USD } from '../src/agents/openai-images.ts';
import { SPOTLIGHT_CURSOR, spotlightImageGen, spotlightSweep, startSpotlight, type SpotlightDeps } from '../src/agents/depth/spotlight.ts';

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
    expect(calls[0]).toContain('raccoon');
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 1 } }));
    expect(calls).toHaveLength(1); // today's image budget is spent: the paper's brief waits
    await spotlightSweep(deps({ gen, limits: { usd: 1, max: 5 } }));
    expect(calls).toHaveLength(2); // the paper's brief; the faction's banner is never generated twice
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
    expect(calls).toHaveLength(1); // an overlapping sweep would have started the paper's brief
    let stopped = false;
    const stopping = stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(await getSetting(t.db, SPOTLIGHT_CURSOR)).toBe(t.clock.now().toISOString());
    const n = calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toHaveLength(n); // no sweep after stop
  });
});
