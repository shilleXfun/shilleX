import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { createShareCard, shareCardSvg, type ShareKind } from '../src/agents/share.ts';
import { notifyFollowersOfMoment } from '../src/agents/follow-notify.ts';
import { imageInfo } from '../src/lib/image-size.ts';
import { follows, notifications, users } from '../src/db/schema.ts';
import { describeNotification } from '../src/services/notify.ts';
import { newId } from '../src/lib/ids.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
const agentA = newId(), agentB = newId();
beforeAll(async () => {
  t = await makeTestApp();
  await t.db.insert(users).values([
    { id: agentA, username: 'ledger_22', displayName: 'Ledger', kind: 'agent', createdAt: t.clock.now() },
    { id: agentB, username: 'ember_44', displayName: 'Ember <3', kind: 'agent', createdAt: t.clock.now() },
  ]);
});
afterAll(() => t.close());

describe('share cards', () => {
  it('renders a 1200×630 card and serves an unfurlable page', async () => {
    const card = await createShareCard({ db: t.db, now: t.clock.now }, {
      kind: 'rug', title: '@ledger_22 rugged his own cabal', subtitle: 'sold 92% of $LAMP for 0.41 SOL', agentIds: [agentA, agentB],
      stats: [{ label: 'holders hurt', value: '7' }], receipt: 'a1b2c3', href: '/p/POST1',
    });
    expect(card.url).toMatch(/^\/s\//);
    const img = await t.app.inject({ method: 'GET', url: card.imageUrl });
    expect(imageInfo(img.rawPayload)).toEqual({ mime: 'image/png', width: 1200, height: 630 });
    const page = await t.app.inject({ method: 'GET', url: card.url });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.body).toContain('<meta property="og:title" content="@ledger_22 rugged his own cabal">');
    expect(page.body).toContain(`<meta property="og:image" content="${t.app.deps.config.publicUrl}${card.imageUrl}">`);
    expect(page.body).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page.body).toContain('url=/p/POST1');
  });
  it('escapes titles in the page and refuses cards that name a human', async () => {
    const card = await createShareCard({ db: t.db, now: t.clock.now }, { kind: 'feud', title: '"><script>x</script>', subtitle: 's', agentIds: [agentB], stats: [], href: '/p/X' });
    const page = await t.app.inject({ method: 'GET', url: card.url });
    expect(page.body).not.toContain('<script>x</script>');
    const human = await t.createUser('a_human');
    await expect(createShareCard({ db: t.db, now: t.clock.now }, { kind: 'leak', title: 't', subtitle: 's', agentIds: [agentA, human.id], stats: [], href: '/p/X' })).rejects.toThrow('SHARE_HUMAN');
  });
  it('redirects only to same-origin paths', async () => {
    for (const href of ['/\\evil.com', '/\t/evil.com', '//evil.com', 'https://evil.com', '/a\\b', '/\n/evil.com', '/ok/../x\u0001']) {
      const card = await createShareCard({ db: t.db, now: t.clock.now }, { kind: 'feud', title: 'x', subtitle: 's', agentIds: [agentB], stats: [], href });
      const page = await t.app.inject({ method: 'GET', url: card.url });
      expect(page.body, JSON.stringify(href)).toContain('url=/">');
      expect(page.body).not.toContain('evil.com');
    }
    const ok = await createShareCard({ db: t.db, now: t.clock.now }, { kind: 'feud', title: 'x', subtitle: 's', agentIds: [agentB], stats: [], href: '/coins/M1?x=1#y' });
    expect((await t.app.inject({ method: 'GET', url: ok.url })).body).toContain('url=/coins/M1?x=1#y"');
  });
  it('404s an unknown card', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/s/doesnotexist1' })).statusCode).toBe(404);
  });
  it('draws every kind of card in the Swarm palette, with no violet left over', () => {
    const kinds: ShareKind[] = ['launch', 'rug', 'graduation', 'faction_formed', 'faction_split', 'feud', 'leak', 'comeback', 'revival'];
    const svgs = kinds.map((kind) => shareCardSvg({ kind, title: 't', subtitle: 's', agentIds: [], stats: [{ label: 'l', value: 'v' }], href: '/' }, ['ledger_22']).toLowerCase());
    expect(svgs[0]).toContain('#ffb86b'); // a launch card is the brand accent
    for (const svg of svgs) {
      expect(svg).toContain('#06070c');
      for (const old of ['#8b6cff', '#0b0716', '#1a1033', '#f4f1ff', '#d9d2f5', '#a59bc9', '#34d399', '#f87171', '#ff6078', '#27e0c0', '#ffb547']) expect(svg).not.toContain(old);
    }
  });
});

describe('follow notifications', () => {
  it('notifies human followers of a big moment, not agent followers', async () => {
    const h = await t.createUser('fan');
    await t.db.insert(follows).values([{ followerId: h.id, followeeId: agentA, createdAt: t.clock.now() }, { followerId: agentB, followeeId: agentA, createdAt: t.clock.now() }]);
    const n = await notifyFollowersOfMoment(t.app.deps, { agentId: agentA, summary: 'rugged $LAMP', href: '/p/POST1', targetType: 'post', targetId: 'POST1' });
    expect(n).toBe(1);
    const rows = (await t.db.select().from(notifications)).filter((r) => r.type === 'agent_moment');
    expect(rows.map((r) => r.userId)).toEqual([h.id]);
    expect(describeNotification('agent_moment', 'Ledger', { summary: 'rugged $LAMP', href: '/p/POST1' })).toEqual({ text: 'Ledger rugged $LAMP', href: '/p/POST1' });
  });
});

describe('follow notification share link', () => {
  it('carries the share card url in the data when given', async () => {
    const h = await t.createUser('fan2');
    await t.db.insert(follows).values({ followerId: h.id, followeeId: agentB, createdAt: t.clock.now() });
    await notifyFollowersOfMoment(t.app.deps, { agentId: agentB, summary: 'launched $EMB', href: '/p/P2', targetType: 'user', targetId: agentB, shareUrl: '/s/abc' });
    const row = (await t.db.select().from(notifications)).find((r) => r.type === 'agent_moment' && r.userId === h.id);
    expect(row?.data).toEqual({ summary: 'launched $EMB', href: '/p/P2', share: '/s/abc' });
  });
});
