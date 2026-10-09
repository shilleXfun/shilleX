# Phase 4 — Demo world and privacy (Tasks 14–15)

Read the plan index `../2026-10-09-shillex.md` first.

---

### Task 14: Seed data and demo activity simulator

**Files:**
- Create: `apps/server/src/seed/rng.ts`, `seed/personas.ts`, `seed/world.ts`, `seed/lines.ts`, `seed/seed.ts`, `seed/cli.ts`, `seed/simulator.ts`
- Modify: `apps/server/src/index.ts` (seed on empty, start simulator)
- Test: `apps/server/test/seed.test.ts`, `apps/server/test/simulator.test.ts`

**Interfaces:**
- Consumes: schema, `recordMentions`, `computeMentionVisibility`, `markRead`, `sendMessage`, `createPost`, `app.guards`, `InMemoryPresence.setVirtual`.
- Produces:
  - `mulberry32(seed: number): () => number`; `pick<T>(r, xs: T[]): T`; `int(r, min, max)`; `chance(r, p)`; `shuffle(r, xs)`
  - `demoMint(label: string): string` — deterministic fictional mint: `bs58.encode(sha256('shillex-demo:' + label))` (valid 32-byte format, not an on-chain token)
  - `PERSONAS: { username: string; displayName: string; bio: string; style: 'degen' | 'analyst' | 'builder' | 'memer' | 'newbie' }[]` (40 entries)
  - `COMMUNITIES` (8 defs), `DEMO_TOKENS` (20 defs) in `world.ts`
  - `POST_LINES`, `CHAT_LINES`, `REPLY_LINES`, `DM_LINES` in `lines.ts` with placeholders `{TOKEN}` (mint), `{SYM}`, `{USER}`
  - `seed(db: Db, opts: { now: Date; seed?: number }): Promise<SeedSummary>` where `SeedSummary = { users: number; communities: number; posts: number; messages: number; tokens: number }`; wipes all tables first
  - `isDatabaseEmpty(db): Promise<boolean>`
  - `startSimulator(app: FastifyInstance, opts?: { minMs?: number; maxMs?: number; seed?: number }): { tick(): Promise<void>; stop(): void }`

**Content rules** (from spec §13 and Global Constraints): all seeded rows set `is_demo = true`; demo tokens have `source = 'demo'`; liquidity/market cap values are fictional and only shown with the DEMO tag; no line may claim profit multiples, PnL, win rates, or "guaranteed" outcomes — lines talk about watching, liquidity, dev wallets, holders, communities, memes and risk. Two demo tokens are `promoted = true`.

- [ ] **Step 1: RNG, personas, world, lines**

`apps/server/src/seed/rng.ts`:
```ts
import { createHash } from 'node:crypto';
import bs58 from 'bs58';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
export const int = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
export const chance = (r: () => number, p: number) => r() < p;
export function shuffle<T>(r: () => number, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
export const demoMint = (label: string) => bs58.encode(createHash('sha256').update(`shillex-demo:${label}`).digest());
```
Add `"bs58": "6.0.0"` to `apps/server/package.json` dependencies and run `npm install`.

`apps/server/src/seed/personas.ts` — exactly 40 entries; write all of them (illustrative first entries below, continue in the same voice with distinct handles, display names and one-line bios; mix styles roughly 12 degen, 8 analyst, 6 builder, 8 memer, 6 newbie):
```ts
export type Style = 'degen' | 'analyst' | 'builder' | 'memer' | 'newbie';
export const PERSONAS: { username: string; displayName: string; bio: string; style: Style }[] = [
  { username: 'alpha_jane', displayName: 'Jane ☀️', bio: 'early-hours trench walker. reads contracts before vibes.', style: 'analyst' },
  { username: 'dex_dan', displayName: 'Dan', bio: 'watches liquidity like a hawk. never trusts a fresh dev wallet.', style: 'analyst' },
  { username: 'moonmeadow', displayName: 'meadow', bio: 'memes first, questions later. community > chart.', style: 'memer' },
  { username: 'rugradar', displayName: 'Rug Radar', bio: 'posting red flags so you don’t have to learn the hard way.', style: 'analyst' },
  { username: 'solsailor', displayName: 'Sol Sailor ⛵', bio: 'sailing the trenches since the first dog coins.', style: 'degen' },
  { username: 'pixelpup', displayName: 'pixelpup', bio: 'i draw the mascots. sometimes they get a coin.', style: 'memer' },
  { username: 'quietbuilder', displayName: 'Quiet Builder', bio: 'shipping tools for holders. dms open for feedback.', style: 'builder' },
  { username: 'nightshift_nik', displayName: 'Nik', bio: 'awake when asia opens. bad at sleeping, good at threads.', style: 'degen' },
  { username: 'fresh_fern', displayName: 'Fern', bio: 'week two in the trenches. asking the dumb questions so you can too.', style: 'newbie' },
  { username: 'chartless', displayName: 'chartless', bio: 'no charts, only communities.', style: 'memer' },
  // … 30 more, same shape
];
```
Add a unit assertion in `seed.test.ts` that there are exactly 40 unique usernames matching `/^[a-z0-9_]{3,20}$/`.

`apps/server/src/seed/world.ts`:
```ts
import { demoMint } from './rng.ts';

export interface CommunityDef { slug: string; name: string; description: string; visibility: 'public' | 'private' | 'invite'; rules: string; channels: { name: string; topic: string; slowModeSeconds?: number }[]; tokenFocus: string[] }
export const COMMUNITIES: CommunityDef[] = [
  { slug: 'trenches', name: 'The Trenches', description: 'The main room. New launches, live takes, constant noise.', visibility: 'public', rules: '1. No DM-me-for-alpha. 2. Post the contract address, not just a ticker. 3. Be decent.',
    channels: [{ name: 'general', topic: 'Say gm, share what you’re watching' }, { name: 'new-launches', topic: 'Fresh mints only — CA required', slowModeSeconds: 15 }, { name: 'memes', topic: 'Images welcome' }], tokenFocus: ['BLINK', 'GRUB', 'ZAPPY'] },
  { slug: 'due-diligence', name: 'Due Diligence Desk', description: 'Slow, careful threads about holders, liquidity and dev behavior.', visibility: 'public', rules: 'Sources or it didn’t happen.',
    channels: [{ name: 'general', topic: 'Questions welcome' }, { name: 'red-flags', topic: 'Post what looks wrong and why' }], tokenFocus: ['GRUB', 'MOTH'] },
  { slug: 'mascot-club', name: 'Mascot Club', description: 'Artists, memers and lore writers building characters.', visibility: 'public', rules: 'Credit artists. No AI-art passing as hand-drawn.',
    channels: [{ name: 'general', topic: 'Show your drawings' }, { name: 'lore', topic: 'Write the story' }], tokenFocus: ['PUPPO', 'MOTH'] },
  { slug: 'builders-den', name: 'Builders Den', description: 'Bots, dashboards and tools for holders.', visibility: 'public', rules: 'Ship > shill.',
    channels: [{ name: 'general', topic: 'What are you building?' }, { name: 'feedback', topic: 'Roast my tool' }], tokenFocus: ['FORGE'] },
  { slug: 'night-owls', name: 'Night Owls', description: 'Asia-hours crew. Quiet chat, long threads.', visibility: 'public', rules: 'Keep it chill.',
    channels: [{ name: 'general', topic: '3am thoughts' }], tokenFocus: ['OWLY', 'ZAPPY'] },
  { slug: 'inner-circle', name: 'Inner Circle', description: 'Small private group for long-form research.', visibility: 'private', rules: 'What’s said here stays here.',
    channels: [{ name: 'general', topic: 'Members only' }, { name: 'research', topic: 'Drafts and sources' }], tokenFocus: ['VAULTY'] },
  { slug: 'art-collective', name: 'Art Collective', description: 'Private studio for the mascot artists.', visibility: 'private', rules: 'Work-in-progress stays private.',
    channels: [{ name: 'general', topic: 'Sketches' }], tokenFocus: ['PUPPO'] },
  { slug: 'beta-testers', name: 'Beta Testers', description: 'Invite-only room testing Quiet Builder’s holder tools.', visibility: 'invite', rules: 'Report bugs, not prices.',
    channels: [{ name: 'general', topic: 'Bug reports' }], tokenFocus: ['FORGE', 'SECRT'] },
];

export interface TokenDef { symbol: string; name: string; mint: string; liquidityUsd: number | null; marketCapUsd: number | null; ageHours: number; promoted?: boolean; status: 'resolved' | 'unindexed' }
const t = (symbol: string, name: string, liquidityUsd: number | null, marketCapUsd: number | null, ageHours: number, extra: Partial<TokenDef> = {}): TokenDef =>
  ({ symbol, name, mint: demoMint(symbol), liquidityUsd, marketCapUsd, ageHours, status: 'resolved', ...extra });
export const DEMO_TOKENS: TokenDef[] = [
  t('BLINK', 'Blinkfish', 48_200, 310_000, 5), t('GRUB', 'Grubworm', 122_000, 1_450_000, 30), t('ZAPPY', 'Zappy Eel', 9_800, 64_000, 2),
  t('MOTH', 'Lamp Moth', 230_000, 3_900_000, 140), t('PUPPO', 'Puppo', 61_000, 720_000, 70), t('FORGE', 'Holder Forge', 15_500, 98_000, 18),
  t('OWLY', 'Owly', 33_000, 260_000, 46), t('VAULTY', 'Vaulty', 7_100, 41_000, 9), t('SECRT', 'Secret Sauce', null, null, 3, { status: 'unindexed' }),
  t('CRUMB', 'Crumb', 4_400, 22_000, 1), t('SNAIL', 'Snail Mail', 88_000, 940_000, 200), t('FIZZ', 'Fizzwick', 19_000, 150_000, 12),
  t('MOSS', 'Moss Golem', 51_000, 480_000, 96), t('PEBL', 'Pebble', 2_900, 15_000, 0.5), t('KITE', 'Kite Season', 27_000, 230_000, 22),
  t('DRIP', 'Drip Frog', 140_000, 2_100_000, 300), t('LOOP', 'Loopy', 11_000, 70_000, 7), t('GLOW', 'Glowcap', 36_000, 410_000, 55, { promoted: true }),
  t('YAWN', 'Yawncat', 6_600, 38_000, 4, { promoted: true }), t('BRICK', 'Brick by Brick', null, null, 1, { status: 'unindexed' }),
];
export const tokenBySymbol = (s: string) => DEMO_TOKENS.find((x) => x.symbol === s)!;
```
Note: `SECRT` and `VAULTY` are only mentioned inside private/invite communities and DMs by the seed — they must never appear in public discovery (Task 15 asserts this).

`apps/server/src/seed/lines.ts` — at least 40 `CHAT_LINES`, 30 `POST_LINES`, 30 `REPLY_LINES`, 15 `DM_LINES`; examples of the voice (continue in kind, observing the content rules):
```ts
export const POST_LINES = [
  'watching {TOKEN} — liquidity looks real but the top 10 holders still own a lot. small size only.',
  'thread on why I stopped buying anything with a fresh dev wallet 🧵 (incl. {TOKEN} as an example of doing it right)',
  'the {SYM} community is genuinely funny. that matters more than people admit.',
  'reminder: a ticker is not an address. if you can’t paste the CA, don’t call it.',
  'new mascot art for {SYM} dropped in Mascot Club, go look',
  'not touching {TOKEN} until the LP situation is explained. happy to be wrong.',
];
export const CHAT_LINES = [
  'gm trenches', 'anyone looked at {TOKEN} yet?', 'dev wallet on {SYM} hasn’t moved in 6h, interesting',
  'volume is fake on half the new stuff today, careful', '{USER} what made you look at {SYM}?',
  'lol the {SYM} meme channel is unhinged', 'liquidity on {TOKEN} just doubled, someone added', 'gn, holding nothing tonight',
];
export const REPLY_LINES = [
  'agree on the holder concentration, that’s my main worry too', 'source for the dev wallet thing?',
  'this is the kind of thread I joined for', 'counterpoint: the community is doing the work here', 'bookmarked 🫡',
];
export const DM_LINES = [
  'hey, saw your thread — mind if I ask about {SYM}?', 'sending you the holder breakdown I mentioned',
  'are you still in the Inner Circle research channel?', 'lol that meme was perfect', 'let’s compare notes on {TOKEN} tomorrow',
];
export function fill(line: string, v: { mint: string; symbol: string; user: string }) {
  return line.replaceAll('{TOKEN}', v.mint).replaceAll('{SYM}', `$${v.symbol}`).replaceAll('{USER}', `@${v.user}`);
}
```

- [ ] **Step 2: Failing seed tests**

`apps/server/test/seed.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/db/client.ts';
import { seed, isDatabaseEmpty } from '../src/seed/seed.ts';
import { PERSONAS } from '../src/seed/personas.ts';
import { DEMO_TOKENS } from '../src/seed/world.ts';
import { users, communities, tokens, tokenMentions, conversations, conversationMembers, readMarkers, posts, callUpdates } from '../src/db/schema.ts';
import { isValidSolanaAddress } from '@shillex/shared';

let h: DbHandle; const now = new Date('2026-10-09T12:00:00Z');
beforeAll(async () => { h = await createDb({}); expect(await isDatabaseEmpty(h.db)).toBe(true); await seed(h.db, { now }); });
afterAll(() => h.close());

describe('seed', () => {
  it('has 40 valid unique personas plus @demo, all flagged demo', async () => {
    expect(new Set(PERSONAS.map((p) => p.username)).size).toBe(40);
    expect(PERSONAS.every((p) => /^[a-z0-9_]{3,20}$/.test(p.username))).toBe(true);
    const all = await h.db.select().from(users);
    expect(all).toHaveLength(41);
    expect(all.every((u) => u.isDemo)).toBe(true);
    expect(all.find((u) => u.username === 'demo')).toBeTruthy();
    expect(await isDatabaseEmpty(h.db)).toBe(false);
  });
  it('has every community visibility type', async () => {
    const vis = (await h.db.select().from(communities)).map((c) => c.visibility);
    expect(new Set(vis)).toEqual(new Set(['public', 'private', 'invite']));
  });
  it('demo tokens are labeled demo with valid-format mints; two are promoted', async () => {
    const rows = await h.db.select().from(tokens);
    expect(rows).toHaveLength(DEMO_TOKENS.length);
    expect(rows.every((t) => t.source === 'demo' && isValidSolanaAddress(t.mint))).toBe(true);
    expect(rows.filter((t) => t.promoted).map((t) => t.symbol).sort()).toEqual(['GLOW', 'YAWN']);
  });
  it('private-only tokens never have public mentions', async () => {
    for (const sym of ['SECRT', 'VAULTY']) {
      const mint = DEMO_TOKENS.find((t) => t.symbol === sym)!.mint;
      const pub = await h.db.select().from(tokenMentions).where(and(eq(tokenMentions.mint, mint), eq(tokenMentions.isPublic, true)));
      expect(pub).toHaveLength(0);
      const any = await h.db.select().from(tokenMentions).where(eq(tokenMentions.mint, mint));
      expect(any.length).toBeGreaterThan(0);
    }
  });
  it('gives @demo DMs, a group, joined communities with unread, a feed and call updates to look at', async () => {
    const [demo] = await h.db.select().from(users).where(eq(users.username, 'demo'));
    const convs = await h.db.select({ k: conversations.kind }).from(conversationMembers).innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId)).where(eq(conversationMembers.userId, demo!.id));
    expect(convs.filter((c) => c.k === 'dm').length).toBeGreaterThanOrEqual(4);
    expect(convs.filter((c) => c.k === 'group').length).toBeGreaterThanOrEqual(2);
    expect((await h.db.select().from(readMarkers).where(eq(readMarkers.userId, demo!.id))).length).toBeGreaterThan(0);
    const [{ n }] = await h.db.select({ n: sql<number>`count(*)::int` }).from(posts);
    expect(n).toBeGreaterThanOrEqual(250);
    expect((await h.db.select().from(callUpdates)).length).toBeGreaterThanOrEqual(10);
  });
  it('is deterministic and re-runnable', async () => {
    const before = (await h.db.select({ u: users.username }).from(users)).map((r) => r.u).sort();
    await seed(h.db, { now });
    const after = (await h.db.select({ u: users.username }).from(users)).map((r) => r.u).sort();
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 3: Implement `seed.ts`**

`apps/server/src/seed/seed.ts` — structure (write the full implementation following these exact steps; every insert sets `isDemo: true` where the column exists):
```ts
import { sql, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { recordMentions } from '../services/mentions.ts';
import { computeMentionVisibility } from '../services/visibility.ts';
import { markRead } from '../services/unread.ts';
import { CALL_STATUSES } from '@shillex/shared';
import { mulberry32, pick, int, chance, shuffle } from './rng.ts';
import { PERSONAS } from './personas.ts';
import { COMMUNITIES, DEMO_TOKENS, tokenBySymbol } from './world.ts';
import { POST_LINES, CHAT_LINES, REPLY_LINES, DM_LINES, fill } from './lines.ts';

export interface SeedSummary { users: number; communities: number; posts: number; messages: number; tokens: number }

const TABLES = ['reports', 'notification_prefs', 'notifications', 'subscriptions', 'token_mentions', 'tokens', 'read_markers', 'messages',
  'conversation_members', 'conversations', 'pins', 'channels', 'invites', 'community_members', 'communities', 'call_updates', 'bookmarks',
  'reactions', 'posts', 'uploads', 'wallet_links', 'mutes', 'blocks', 'follows', 'sessions', 'users'];

export async function isDatabaseEmpty(db: Db) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  return (r?.n ?? 0) === 0;
}

export async function seed(db: Db, opts: { now: Date; seed?: number }): Promise<SeedSummary> {
  const r = mulberry32(opts.seed ?? 20261009);
  const now = opts.now.getTime();
  const ago = (ms: number) => new Date(now - ms);
  const H = 3600_000, M = 60_000;
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`));
  // 1. users: @demo (displayName 'You (demo)', bio 'Exploring the Shillex demo world.', createdAt 30d ago) + PERSONAS (createdAt 20–400 days ago)
  // 2. follows: demo follows 14 personas; each persona follows 5–15 others (no self-follows)
  // 3. tokens: DEMO_TOKENS → tokens rows { source: 'demo', status, name, symbol, liquidityUsd, marketCapUsd, pairCreatedAt: ago(ageHours*H), promoted, fetchedAt: opts.now }
  // 4. communities: owner = a persona whose style fits (builders-den → quietbuilder, etc.); 8–30 active members each;
  //    demo joins all public communities except night-owls, plus inner-circle (active); demo has a *pending* request for art-collective;
  //    beta-testers (invite) includes demo. Make demo a mod of mascot-club (so mod tools are visible). Channels from defs (slow mode where set).
  // 5. channel messages: for each channel, 40–120 messages spread over the last 48h, denser in the last 2h; authors are members;
  //    ~35% include a token from the community's tokenFocus (use fill()); ~15% reply to a recent message; add reactions to ~25%.
  //    Record mentions with computeMentionVisibility({ kind: 'channel_message', communityVisibility }).
  // 6. read markers for demo: for each joined channel, mark read up to a message 3–15 messages before the latest (so unread > 0).
  // 7. posts: ~180 top-level public posts over the last 72h (POST_LINES; ~55% mention a public-focus token; 6 posts carry generated art media
  //    { url: `/media/art/${id}.svg`, width: 800, height: 450, alt: 'Generated illustration' });
  //    ~70 replies (REPLY_LINES) forming threads up to depth 3; ~20 quotes; ~25 reposts; reactions; bookmarks for demo (5);
  //    community thread posts: 4–8 per community (private ones mention VAULTY / SECRT and are recorded non-public).
  //    Record post mentions with computeMentionVisibility({ kind: 'post', communityVisibility }).
  // 8. call updates: 14 token posts get 1–3 ordered updates from their author (statuses in order from CALL_STATUSES subsets, e.g.
  //    watching → bought → taking_profit); demo subscribes to 4 of them.
  // 9. demo's own content: 3 posts (one with a token + 'watching' call update), so the profile is not empty.
  // 10. conversations: 5 DMs with personas (6–20 messages each, DM_LINES; at least one shares a token card attachment of SECRT),
  //     2 groups ('Desk', 4 members; 'Mascot crew', 6 members) with 15–40 messages; read markers leave 1–4 unread in three of them.
  //     Record DM/group mentions with computeMentionVisibility({ kind: 'conversation_message' }) (always false).
  // 11. pins: 1–2 pinned messages per public community; 1 pinned thread post in due-diligence.
  // 12. notifications for demo: 12 recent rows across types reply, mention, follow, reaction, quote, call_update, join_request (from mascot-club pending
  //     request by a persona), token_discussion; 5 unread. Demo subscribes to token GRUB.
  // 13. demo token subscriptions: GRUB.
  return { users: 41, communities: COMMUNITIES.length, posts: 0, messages: 0, tokens: DEMO_TOKENS.length }; // fill real counts
}
```
Implementation notes:
- Generate ids with `newId()` but derive `createdAt` from the simulated timeline; because ULIDs are time-ordered by *generation* time, sort each scope's generated items by `createdAt` before inserting so that `id` order matches time order (messages pagination and unread rely on id order). Do this by building arrays first, sorting by `createdAt`, then assigning `newId()` in that order.
- Batch inserts in chunks of 200 rows.
- Use `r` for every random choice (determinism).
- Return real counts.

`apps/server/src/seed/cli.ts`:
```ts
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { seed } from './seed.ts';

const config = loadConfig();
const h = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const summary = await seed(h.db, { now: new Date() });
console.log('Seeded demo world:', summary);
await h.close();
```

Run: `npm test -w @shillex/server -- seed` → PASS. Then `npm run seed` → prints the summary.

- [ ] **Step 4: Failing simulator test**

`apps/server/test/simulator.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { seed } from '../src/seed/seed.ts';
import { startSimulator } from '../src/seed/simulator.ts';
import { messages, posts, users } from '../src/db/schema.ts';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeTestApp(); await seed(ctx.db, { now: ctx.clock.now() }); });
afterAll(() => ctx.close());

const count = async (t: typeof messages | typeof posts) => (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n;

describe('demo simulator', () => {
  it('generates activity through real services as demo personas, never as @demo', async () => {
    const sim = startSimulator(ctx.app, { seed: 7, minMs: 1_000_000, maxMs: 1_000_000 }); // timers effectively disabled
    const [m0, p0] = [await count(messages), await count(posts)];
    for (let i = 0; i < 12; i++) { ctx.clock.advance(61_000); await sim.tick(); }
    sim.stop();
    expect((await count(messages)) + (await count(posts))).toBeGreaterThan(m0 + p0);
    expect(ctx.bus.find('typing').length + ctx.bus.find('message:new').length).toBeGreaterThan(0);
    const [demo] = await ctx.db.select().from(users).where(sql`${users.username} = 'demo'`);
    const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(messages).where(sql`${messages.authorId} = ${demo!.id} and ${messages.createdAt} > ${ctx.clock.now()} - interval '1 hour'`);
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 5: Implement the simulator**

`apps/server/src/seed/simulator.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { channels, communities, communityMembers, posts, users, type UserRow } from '../db/schema.ts';
import { sendMessage } from '../services/messages.ts';
import { createPost } from '../services/posts.ts';
import { toUserSummary } from '../services/users.ts';
import { InMemoryPresence } from '../services/presence.ts';
import { mulberry32, pick, chance } from './rng.ts';
import { CHAT_LINES, POST_LINES, REPLY_LINES, fill } from './lines.ts';
import { COMMUNITIES, tokenBySymbol } from './world.ts';

export function startSimulator(app: FastifyInstance, opts: { minMs?: number; maxMs?: number; seed?: number } = {}) {
  const deps = app.deps;
  const { db, bus, presence } = deps;
  const r = mulberry32(opts.seed ?? Date.now() % 2 ** 31);
  const minMs = opts.minMs ?? 4000, maxMs = opts.maxMs ?? 12000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const virtualOnline = new Set<string>();

  async function rotatePresence(personas: UserRow[]) {
    if (!(presence instanceof InMemoryPresence)) return;
    const want = new Set(personas.filter(() => chance(r, 0.35)).map((p) => p.id));
    for (const id of virtualOnline) if (!want.has(id)) { presence.setVirtual(id, false); virtualOnline.delete(id); }
    for (const id of want) if (!virtualOnline.has(id)) { presence.setVirtual(id, true); virtualOnline.add(id); }
  }

  async function tick() {
    const personas = await db.select().from(users).where(and(eq(users.isDemo, true), ne(users.username, 'demo')));
    if (!personas.length) return;
    if (chance(r, 0.15)) await rotatePresence(personas);
    const roll = r();
    try {
      if (roll < 0.7) {
        const pubs = await db.select().from(communities).where(eq(communities.visibility, 'public'));
        const c = pick(r, pubs);
        const def = COMMUNITIES.find((d) => d.slug === c.slug);
        const chans = await db.select().from(channels).where(eq(channels.communityId, c.id));
        const ch = pick(r, chans);
        const members = await db.select({ u: users }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
          .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.status, 'active'), eq(users.isDemo, true), ne(users.username, 'demo'), inArray(communityMembers.role, ['member', 'mod', 'owner'])));
        if (!members.length) return;
        const author = pick(r, members).u;
        const sym = def?.tokenFocus.length ? pick(r, def.tokenFocus) : 'BLINK';
        const tok = tokenBySymbol(sym);
        const body = fill(pick(r, CHAT_LINES), { mint: tok.mint, symbol: tok.symbol, user: pick(r, members).u.username });
        bus.toRoom(`channel:${ch.id}`, 'typing', { scope: { type: 'channel', id: ch.id }, user: toUserSummary(author) });
        await sendMessage(deps, app.guards, { scope: { type: 'channel', id: ch.id }, author, body });
      } else if (roll < 0.9) {
        const author = pick(r, personas);
        const tok = tokenBySymbol(pick(r, ['BLINK', 'GRUB', 'ZAPPY', 'MOTH', 'PUPPO', 'FORGE', 'OWLY', 'KITE', 'FIZZ']));
        if (chance(r, 0.5)) {
          const recent = await db.select().from(posts)
            .where(and(eq(posts.kind, 'post'), isNull(posts.communityId), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(40);
          const parent = recent.length ? pick(r, recent) : null;
          if (parent && parent.authorId !== author.id) {
            await createPost(deps, author, { body: pick(r, REPLY_LINES), parentId: parent.id });
            return;
          }
        }
        await createPost(deps, author, { body: fill(pick(r, POST_LINES), { mint: tok.mint, symbol: tok.symbol, user: pick(r, personas).username }) });
      } else {
        await rotatePresence(personas);
      }
    } catch (e) {
      app.log?.debug?.({ err: e }, 'simulator action skipped');
    }
  }

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => { await tick(); schedule(); }, minMs + r() * (maxMs - minMs));
    timer.unref?.();
  };
  schedule();
  return {
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (presence instanceof InMemoryPresence) for (const id of virtualOnline) presence.setVirtual(id, false);
    },
  };
}
```

- [ ] **Step 6: Boot wiring**

In `apps/server/src/index.ts`, after `createDb` and before `buildApp`:
```ts
import { isDatabaseEmpty, seed } from './seed/seed.ts';
import { startSimulator } from './seed/simulator.ts';
if (config.seedOnEmpty && (await isDatabaseEmpty(handle.db))) {
  console.log('Empty database — seeding demo world…');
  console.log(await seed(handle.db, { now: new Date() }));
}
```
After `attachRealtime(app, bus)`:
```ts
const sim = config.demoSimulator ? startSimulator(app) : null;
const shutdown = async () => { sim?.stop(); await app.close(); await handle.close(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
```

- [ ] **Step 7: Run, commit**

Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS. Run `npm run dev -w @shillex/server`, confirm the seed summary prints on first boot and `curl -s -X POST localhost:3000/api/auth/demo -i | head -1` returns 200.
```bash
git add apps/server package-lock.json
git commit -m "feat(server): deterministic demo world seed and labeled activity simulator"
```

---

### Task 15: Privacy leak suite

**Files:**
- Test: `apps/server/test/privacy.test.ts`
- Modify: whichever server file a failing assertion points to (fix code, never the assertion)

**Interfaces:**
- Consumes: the full API.
- Produces: a regression suite proving private content never reaches public surfaces (spec §3 `is_public` rule, §7, §8).

- [ ] **Step 1: Write the suite**

`apps/server/test/privacy.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { tokens } from '../src/db/schema.ts';
import { demoMint } from '../src/seed/rng.ts';

const mints = {
  dm: demoMint('priv-dm'), group: demoMint('priv-group'), privPost: demoMint('priv-post'), privChat: demoMint('priv-chat'),
  inviteChat: demoMint('invite-chat'), held: demoMint('held'), flipped: demoMint('flipped'), deleted: demoMint('deleted'), pub: demoMint('public'),
};
let ctx: TestCtx; let insider: TestUser; let friend: TestUser; let outsider: TestUser; let watcher: TestUser;
let privChannel: string; let privCommunityId: string;

beforeAll(async () => {
  ctx = await makeTestApp();
  insider = await ctx.createUser('insider'); friend = await ctx.createUser('friend_p'); outsider = await ctx.createUser('outsider_p'); watcher = await ctx.createUser('watcher_p');
  await ctx.db.insert(tokens).values(Object.entries(mints).map(([k, mint]) => ({ mint, source: 'demo' as const, status: 'resolved' as const, symbol: k.toUpperCase().slice(0, 6) })));
  for (const m of Object.values(mints)) await ctx.as(watcher).put(`/api/tokens/${m}/subscription`);

  const dm = (await ctx.as(insider).post('/api/conversations', { kind: 'dm', username: 'friend_p' })).body.conversation;
  await ctx.as(insider).post(`/api/conversations/${dm.id}/messages`, { body: `dm ${mints.dm}` });
  const g = (await ctx.as(insider).post('/api/conversations', { kind: 'group', name: 'g', usernames: ['friend_p'] })).body.conversation;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/conversations/${g.id}/messages`, { body: `group ${mints.group}`, attachments: [{ type: 'token', mint: mints.group }] });

  await ctx.as(insider).post('/api/communities', { name: 'Priv', slug: 'p-priv', visibility: 'private' });
  await ctx.as(insider).post('/api/communities', { name: 'Inv', slug: 'p-inv', visibility: 'invite' });
  await ctx.as(insider).post('/api/communities', { name: 'Flip', slug: 'p-flip', visibility: 'public' });
  await ctx.as(insider).post('/api/communities', { name: 'Held', slug: 'p-held', visibility: 'public' });
  const priv = (await ctx.as(insider).get('/api/communities/p-priv')).body.community;
  privChannel = priv.channels[0].id; privCommunityId = priv.community.id;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post('/api/posts', { body: `priv post ${mints.privPost}`, communityId: privCommunityId });
  await ctx.as(insider).post(`/api/channels/${privChannel}/messages`, { body: `priv chat ${mints.privChat} @outsider_p` });
  const inv = (await ctx.as(insider).get('/api/communities/p-inv')).body.community.channels[0].id;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/channels/${inv}/messages`, { body: `invite chat ${mints.inviteChat}` });

  const flip = (await ctx.as(insider).get('/api/communities/p-flip')).body.community.channels[0].id;
  ctx.clock.advance(61_000);
  await ctx.as(insider).post(`/api/channels/${flip}/messages`, { body: `flip ${mints.flipped}` });
  await ctx.as(insider).patch('/api/communities/p-flip', { visibility: 'private' });

  const heldCh = (await ctx.as(insider).get('/api/communities/p-held')).body.community.channels[0].id;
  await ctx.as(insider).patch(`/api/channels/${heldCh}`, { holdNewMemberPosts: true });
  await ctx.as(friend).post('/api/communities/p-held/join');
  ctx.clock.advance(61_000);
  await ctx.as(friend).post(`/api/channels/${heldCh}/messages`, { body: `held ${mints.held}` });

  const del = (await ctx.as(insider).post('/api/posts', { body: `soon deleted ${mints.deleted}` })).body.post;
  await ctx.as(insider).del(`/api/posts/${del.id}`);
  await ctx.as(insider).post('/api/posts', { body: `public ${mints.pub}` });
});
afterAll(() => ctx.close());

const privateMints = () => Object.entries(mints).filter(([k]) => k !== 'pub').map(([, m]) => m);

describe('private content never reaches public surfaces', () => {
  it('token stats, posts and chat tabs show nothing for private-only mints', async () => {
    for (const m of privateMints()) {
      const t = (await ctx.as(outsider).get(`/api/tokens/${m}`)).body;
      expect(t.stats.mentions24h, m).toBe(0);
      expect((await ctx.as(outsider).get(`/api/tokens/${m}/posts`)).body.items, m).toEqual([]);
      expect((await ctx.as(outsider).get(`/api/tokens/${m}/chat`)).body.items, m).toEqual([]);
      // even insiders see nothing in the *public* discussion surfaces
      expect((await ctx.as(insider).get(`/api/tokens/${m}/chat`)).body.items, m).toEqual([]);
    }
    expect((await ctx.as(outsider).get(`/api/tokens/${mints.pub}`)).body.stats.mentions24h).toBe(1);
  });
  it('discovery and sidebar never include private-only mints', async () => {
    const d = JSON.stringify((await ctx.as(outsider).get('/api/discover')).body) + JSON.stringify((await ctx.as(outsider).get('/api/sidebar')).body);
    for (const m of privateMints()) expect(d.includes(m), m).toBe(false);
    expect(d.includes(mints.pub)).toBe(true);
  });
  it('token subscribers are not notified about private mentions', async () => {
    const n = (await ctx.as(watcher).get('/api/notifications?filter=calls')).body.items;
    // `deleted` and `flipped` were public at the moment they were posted, so notifying then was correct.
    expect(new Set(n.map((x: any) => x.target.id))).toEqual(new Set([mints.pub, mints.deleted, mints.flipped]));
  });
  it('outsiders cannot read private conversations, channels, threads, members or pins', async () => {
    const convs = (await ctx.as(insider).get('/api/conversations')).body.conversations;
    for (const c of convs) expect((await ctx.as(outsider).get(`/api/conversations/${c.id}/messages`)).status).toBe(404);
    expect((await ctx.as(outsider).get(`/api/channels/${privChannel}/messages`)).status).toBe(403);
    for (const path of ['threads', 'members', 'pins']) expect((await ctx.as(outsider).get(`/api/communities/p-priv/${path}`)).status).toBe(403);
    expect((await ctx.as(outsider).get('/api/communities/p-inv')).status).toBe(404);
    expect((await ctx.as(outsider).get('/api/search/messages?q=dm')).body.hits).toEqual([]);
  });
  it('mentioning an outsider inside a private channel does not notify them', async () => {
    const n = (await ctx.as(outsider).get('/api/notifications')).body.items;
    expect(n.filter((x: any) => x.type === 'mention')).toEqual([]);
  });
  it('outsiders’ view of a member’s communities hides private and invite-only ones', async () => {
    const list = (await ctx.as(outsider).get('/api/users/insider/communities')).body.communities.map((c: any) => c.slug);
    expect(list).toEqual(['p-held']);
  });
});
```

- [ ] **Step 2: Run and fix**

Run: `npm test -w @shillex/server -- privacy`
Expected: PASS. Any failure is a real leak: fix the server code it identifies, re-run the full suite.

- [ ] **Step 3: Commit**

```bash
git add apps/server
git commit -m "test(server): privacy leak suite for DMs, groups, private/invite communities, held and deleted content"
```
