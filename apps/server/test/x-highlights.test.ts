import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { FakeXApi, XApiError, xConfig } from './x-helpers.ts';
import { agentEvents, factionMembers, factions, papers, shareCards, xHighlights, xTopics } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { createShareCard } from '../src/agents/share.ts';
import { HIGHLIGHT_GAP_MS, coinText, draftHighlights, highlightTextOk, plainText, postDueHighlights } from '../src/x/highlights.ts';
import { xSpendToday } from '../src/x/spend.ts';

let w: Awaited<ReturnType<typeof worldTestCtx>>;
let api: FakeXApi;
beforeEach(async () => { w = await worldTestCtx(); api = new FakeXApi(); });
afterEach(async () => { await w.t.close(); });
const URL_ = 'https://shillex.example';
const deps = (over = {}) => ({ db: w.t.db, now: w.t.clock.now, config: xConfig({ highlights: 'drafts', ...over }), publicUrl: URL_ });
const event = (agentId: string, kind: string, data: Record<string, unknown>) => w.t.db.insert(agentEvents).values({ id: newId(), agentId, kind, data, at: w.t.clock.now() });
const rows = () => w.t.db.select().from(xHighlights).orderBy(asc(xHighlights.createdAt), asc(xHighlights.key));

describe('highlight text (x-feed §6)', () => {
  it('writes coins plainly as devnet coins and strips @ and #', () => {
    expect(coinText('$moth')).toBe('MOTH (devnet coin)');
    expect(plainText('@lamp rugged $MOTH #rekt')).toBe('lamp rugged MOTH (devnet coin) rekt');
    expect(highlightTextOk('MOTH (devnet coin) graduated', null)).toBe(true);
    expect(highlightTextOk('x'.repeat(250), 'https://shillex.example/times/2026-10-09')).toBe(false);
    expect(highlightTextOk('hi @you', null)).toBe(false);
  });
  it('Review: refuses a bare domain X would link, and fullwidth ＠ ＃ ＄ that X reads as @ # $', () => {
    for (const bad of ['Lamp rugged it on pump.fun', 'The t.me/xyz Club formed', '＠lamp formed a faction', 'the ＃rekt gang', 'ＭＯＴＨ．ＣＯＭ fans', 'up ＄5']) expect(highlightTextOk(bad, null), bad).toBe(false);
    for (const good of ['ORBIT (devnet coin) graduated on Shillex.', 'Lamp rugged MOTH (devnet coin) on Shillex: sold for 0.090 SOL while 4 other AI agents still held it.']) expect(highlightTextOk(good, null), good).toBe(true);
  });
});

describe('draftHighlights (x-feed §6)', () => {
  it('drafts the paper with the link, the biggest rug with its card, then stops at the daily cap', async () => {
    const [a, b] = [w.agents[0]!, w.agents[1]!];
    await w.t.db.insert(papers).values({ day: '2026-10-09', headline: '@lamp rugged $MOTH', body: { stories: [], memeBrief: null, source: 'local' }, createdAt: w.t.clock.now() });
    await event(a.id, 'rugged', { mint: 'm1', symbol: 'MOTH', lamports: 50_000_000, holders: 4 });
    await event(b.id, 'rugged', { mint: 'm2', symbol: 'LAMP', lamports: 90_000_000, holders: 2 });
    const card = await createShareCard({ db: w.t.db, now: w.t.clock.now }, { kind: 'rug', title: 'x', subtitle: 'y', agentIds: [b.id], stats: [], href: '/coins/m2' });
    await event(a.id, 'graduated', { mint: 'm3', symbol: 'ORBIT' });
    expect(await draftHighlights(deps({ highlightsPerDay: 2 }))).toBe(2);
    const [paper, rug] = await rows();
    expect(paper).toMatchObject({ kind: 'paper', status: 'draft', link: `${URL_}/times/2026-10-09` });
    expect(paper!.body).toMatch(/lamp rugged MOTH \(devnet coin\)/);
    expect(paper!.body).not.toMatch(/[@#$]/);
    expect(rug).toMatchObject({ kind: 'rug', key: expect.stringMatching(/^rug:/), shareCardId: card.id });
    expect(rug!.body).toMatch(/LAMP \(devnet coin\).*0\.090 SOL/);
    expect(await draftHighlights(deps({ highlightsPerDay: 2 }))).toBe(0);
  });
  it('auto mode drafts straight to approved; off drafts nothing; a moment is never drafted twice', async () => {
    await event(w.agents[0]!.id, 'graduated', { mint: 'm3', symbol: 'ORBIT' });
    expect(await draftHighlights(deps({ highlights: 'off' }))).toBe(0);
    expect(await draftHighlights(deps({ highlights: 'auto' }))).toBe(1);
    expect((await rows())[0]!.status).toBe('approved');
    expect(await draftHighlights(deps({ highlights: 'auto' }))).toBe(0);
  });
  it('Review Focus 4: a faction whose name is too long or is a human’s username is stored as skipped, and the next faction gets its turn', async () => {
    await w.t.createUser('ella_real');
    const long = newId(), named = newId(), fine = newId();
    await w.t.db.insert(factions).values([
      { id: long, name: 'L'.repeat(240), colour: '#fff', formedAt: w.t.clock.now() },
      { id: named, name: 'Ella_Real fans', colour: '#fff', formedAt: w.t.clock.now() },
      { id: fine, name: 'The Lamp Club', colour: '#fff', formedAt: w.t.clock.now() },
    ]);
    await w.t.db.insert(factionMembers).values([long, named, fine].map((factionId, i) => ({ factionId, agentId: w.agents[i]!.id, joinedAt: w.t.clock.now() })));
    await event(w.agents[2]!.id, 'faction_formed', { factionId: fine, name: 'The Lamp Club' });
    w.t.clock.advance(1000);
    await event(w.agents[1]!.id, 'faction_formed', { factionId: named, name: 'Ella_Real fans' });
    w.t.clock.advance(1000);
    await event(w.agents[0]!.id, 'faction_formed', { factionId: long, name: 'L'.repeat(240) });
    expect(await draftHighlights(deps())).toBe(1);
    const byKey = new Map((await rows()).map((r) => [r.key, r]));
    expect(byKey.get(`faction_formed:${long}`)).toMatchObject({ status: 'skipped', error: 'broke the highlight text rules' });
    expect(byKey.get(`faction_formed:${named}`)).toMatchObject({ status: 'skipped' });
    expect(byKey.get(`faction_formed:${fine}`)).toMatchObject({ status: 'draft', body: 'A new faction formed among the AI agents on Shillex: The Lamp Club, 1 member.' });
  });
  it('Review Focus 4: a 200-character faction name is skipped even though the whole post would fit in 280', async () => {
    const id = newId(), name = 'L'.repeat(200);
    await w.t.db.insert(factions).values({ id, name, colour: '#fff', formedAt: w.t.clock.now() });
    await w.t.db.insert(factionMembers).values({ factionId: id, agentId: w.agents[0]!.id, joinedAt: w.t.clock.now() });
    await event(w.agents[0]!.id, 'faction_formed', { factionId: id, name });
    expect(await draftHighlights(deps())).toBe(0);
    expect((await rows())[0]).toMatchObject({ key: `faction_formed:${id}`, status: 'skipped' });
  });
  it('Review: the paper never carries a trending X topic back to X', async () => {
    await w.t.db.insert(xTopics).values({ id: newId(), label: 'senator smith etf remarks', words: ['senator'], avoidSymbols: [], sentiment: 0, heat: 1, sourcePostIds: ['1'], sourceHandle: null,
      createdAt: w.t.clock.now(), expiresAt: new Date(w.t.clock.now().getTime() + 3 * 3600_000) });
    await w.t.db.insert(papers).values({ day: '2026-10-09', headline: 'FROM X: SENATOR SMITH ETF REMARKS', body: { stories: [], memeBrief: null, source: 'local' }, createdAt: w.t.clock.now() });
    expect(await draftHighlights(deps())).toBe(1);
    const [paper] = await rows();
    expect(paper).toMatchObject({ kind: 'paper', status: 'draft', link: `${URL_}/times/2026-10-09` });
    expect(paper!.body.toLowerCase()).not.toMatch(/senator|smith|from x/);
  });
});

describe('postDueHighlights (x-feed §6)', () => {
  async function approved(over: Partial<typeof xHighlights.$inferInsert> = {}) {
    const id = newId();
    await w.t.db.insert(xHighlights).values({ id, key: `k:${id}`, kind: 'graduation', body: 'ORBIT (devnet coin) graduated on Shillex.', status: 'approved', createdAt: w.t.clock.now(), ...over });
    return id;
  }
  const post = (over = {}) => postDueHighlights({ ...deps(over), api });
  it('posts an approved highlight with its card image and books it; drafts wait', async () => {
    const card = await createShareCard({ db: w.t.db, now: w.t.clock.now }, { kind: 'graduation', title: 'ORBIT graduated', subtitle: 's', agentIds: [w.agents[0]!.id], stats: [], href: '/coins/m3' });
    const blobId = (await w.t.db.select({ blobId: shareCards.blobId }).from(shareCards).where(eq(shareCards.id, card.id)))[0]!.blobId;
    await approved({ blobId, shareCardId: card.id });
    await approved({ status: 'draft', key: 'draft-one' });
    expect(await post()).toEqual({ posted: 1, halted: null });
    expect(api.uploaded).toHaveLength(1);
    expect(api.created[0]).toEqual({ text: 'ORBIT (devnet coin) graduated on Shillex.', mediaIds: ['m1'] });
    expect(await xSpendToday(w.t.db, w.t.clock.now())).toMatchObject({ postsCreated: 1, mediaUploads: 1, linkedPosts: 0, usd: 0.015 });
    expect((await rows()).find((r) => r.key === 'draft-one')!.status).toBe('draft');
  });
  it('keeps 3 hours between posts, one linked post a day, and never posts the same text twice', async () => {
    await approved({ kind: 'paper', link: `${URL_}/times/2026-10-09`, body: 'Today in the Shillex Times: a quiet day.' });
    expect(await post()).toEqual({ posted: 1, halted: null });
    expect(api.created[0]!.text).toBe(`Today in the Shillex Times: a quiet day. ${URL_}/times/2026-10-09`);
    await approved({ kind: 'paper', key: 'paper:2', link: `${URL_}/times/2026-10-10`, body: 'Today in the Shillex Times: chaos.' });
    expect((await post()).posted).toBe(0); // inside 3 hours
    w.t.clock.advance(HIGHLIGHT_GAP_MS);
    await post();
    expect(api.created[1]!.text).toBe('Today in the Shillex Times: chaos.'); // the day's one link is spent
    await approved({ key: 'again', body: 'Today in the Shillex Times: chaos.' });
    w.t.clock.advance(HIGHLIGHT_GAP_MS);
    await post();
    expect((await rows()).find((r) => r.key === 'again')!.status).toBe('skipped');
    expect(api.created).toHaveLength(2);
  });
  it('retries a failure once, then marks it failed; a 401 halts posting and keeps the highlight', async () => {
    const id = await approved();
    api.failNext = new XApiError(500, 'boom');
    await post();
    expect((await w.t.db.select().from(xHighlights).where(eq(xHighlights.id, id)))[0]).toMatchObject({ status: 'approved', attempts: 1 });
    api.failNext = new XApiError(500, 'boom again');
    await post();
    expect((await w.t.db.select().from(xHighlights).where(eq(xHighlights.id, id)))[0]).toMatchObject({ status: 'failed', attempts: 2 });
    await approved({ key: 'next' });
    api.failNext = new XApiError(401, 'Unauthorized');
    expect((await post()).halted).toMatch(/401/);
    expect((await rows()).find((r) => r.key === 'next')!.status).toBe('approved');
  });
  it('Review: posts at most X_HIGHLIGHTS_PER_DAY in a UTC day, however many were approved', async () => {
    for (let i = 0; i < 5; i++) await approved({ key: `many:${i}`, body: `ORBIT${i} (devnet coin) graduated on Shillex.` });
    for (let i = 0; i < 4; i++) { await post(); w.t.clock.advance(HIGHLIGHT_GAP_MS); } // 12:00, 15:00, 18:00, 21:00 UTC
    expect(api.created).toHaveLength(3);
    w.t.clock.advance(HIGHLIGHT_GAP_MS); // 03:00 the next day
    await post();
    expect(api.created).toHaveLength(4);
  });
  it('Review: a post X may have taken (a timeout) is marked failed at once, never sent again', async () => {
    const id = await approved();
    api.failNext = new XApiError(408, 'X did not answer in time');
    await post();
    expect((await w.t.db.select().from(xHighlights).where(eq(xHighlights.id, id)))[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(api.created).toEqual([]);
  });
  it('stops at the X budget', async () => {
    await approved();
    expect((await post({ dailyBudgetUsd: 0.01 })).posted).toBe(0);
    expect(api.created).toEqual([]);
  });
});
