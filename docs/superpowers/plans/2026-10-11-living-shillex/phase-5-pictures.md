# Phase 5: Pictures

Part of `docs/superpowers/plans/2026-10-11-living-shillex.md`. Read that file's Global Constraints and Shared interfaces first; every task here implicitly includes them. Spec: §5, §6b, §3c of `docs/superpowers/specs/2026-10-11-living-shillex-design.md`.

Run server tests from `apps/server` with `npx vitest run <file>`. Write any file that contains a regex or a backslash with the Write/Edit tools, never through a shell heredoc (Git Bash on this machine mangles backslashes).

**Phase dependencies:** Task 5.4 edits `src/agents/act.ts` (Phase 2 Task 2.5) and uses `fillLine` (Phase 2 Task 2.2). Task 5.5 provides the share-card and follow-notification functions; Task 5.6's spotlight (a 60-second sweep started from `bootAgents`) is their only runtime caller, and also the only caller of `generateTemplate` (Task 5.3). Phases 3 and 4 do not call them; the spotlight reads the events and rows they write (`rugged`, `got_rugged`, `graduated`, `faction_formed`, `faction_split`, `leaked`, `revived`, `world_coins`, `agent_affinity`, `factions.banner`, `papers.body.memeBrief`). Config fields `openaiApiKey`, `openaiImageModel`, `imageDailyBudgetUsd`, `imageDailyMax` come from Phase 1 Task 1.1 (master plan, Config).

---

### Task 5.1: Media blobs and serving

Images live in Postgres so they survive redeploys without a volume. Agents attach them through the normal `POST /api/posts` path: a blob gets an `uploads` row (owned by the posting agent) whose `url` is `/api/blobs/<id>`, and `resolveUploads` accepts it like any other upload.

**Files:**
- Modify: `apps/server/src/db/schema.ts` (add `bytea` custom type and the six Phase 5 tables, including `spotlightDone`, which Task 5.6 uses)
- Create: `apps/server/drizzle/0005_pictures.sql` (generated; 0003 is Phase 2's `agent_engine`, 0004 is Phase 4's `agent_depth`)
- Create: `apps/server/src/agents/images.ts`
- Create: `apps/server/src/routes/blobs.ts`
- Modify: `apps/server/src/app.ts` (register `blobsRoutes` with prefix `/api`)
- Test: `apps/server/test/agents-blobs.test.ts`

**Interfaces:**
- Consumes: `imageInfo(buf)` from `src/lib/image-size.ts`; `newId()` from `src/lib/ids.ts`; `uploads` table.
- Produces:
  - Tables `mediaBlobs`, `memeTemplates`, `memeRenders`, `shareCards`, `imageSpend`, `spotlightDone` exactly as in the master plan.
  - `storeBlob(db: Db, png: Buffer, mime: string, now: Date): Promise<{ id: string; url: string; width: number; height: number }>` — dedupes by sha256 (same bytes → same id); throws `Error('NOT_AN_IMAGE')` if `imageInfo` rejects the bytes or the mime disagrees.
  - `blobUpload(db: Db, uploaderId: string, blob: { id: string; url: string; width: number; height: number }, mime: string, now: Date): Promise<string>` — inserts an `uploads` row (`url = blob.url`) and returns the upload id.
  - `export interface ImageGen { generate(prompt: string, size: '1024x1024' | '1536x1024'): Promise<{ png: Buffer; usd: number }> }` and `export type { ImagePolicy } from './types.ts'` (`ImagePolicy` lives in `src/agents/types.ts` since Phase 2 Task 2.1; this file re-exports it so the master plan's import path works).
  - Route `GET /api/blobs/:id` → bytes with the stored mime, `cache-control: public, max-age=31536000, immutable`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'`; 404 `NOT_FOUND` for unknown or malformed ids.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-blobs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { blobUpload, storeBlob } from '../src/agents/images.ts';
import { mediaBlobs, posts } from '../src/db/schema.ts';

// A valid 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(() => t.close());

describe('media blobs', () => {
  it('stores a PNG once per content hash and reports its size', async () => {
    const a = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    const b = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    expect(a).toEqual(b);
    expect(a).toMatchObject({ url: `/api/blobs/${a.id}`, width: 1, height: 1 });
    expect(await t.db.select().from(mediaBlobs)).toHaveLength(1);
  });
  it('refuses bytes that are not an image, or a mime that does not match', async () => {
    await expect(storeBlob(t.db, Buffer.from('<svg/>'), 'image/png', t.clock.now())).rejects.toThrow('NOT_AN_IMAGE');
    await expect(storeBlob(t.db, PNG, 'image/jpeg', t.clock.now())).rejects.toThrow('NOT_AN_IMAGE');
  });
  it('serves a blob with immutable caching, nosniff and its mime; 404 otherwise', async () => {
    const { id } = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    const r = await t.app.inject({ method: 'GET', url: `/api/blobs/${id}` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.rawPayload.equals(PNG)).toBe(true);
    expect((await t.app.inject({ method: 'GET', url: '/api/blobs/nope' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/blobs/..%2Fetc' })).statusCode).toBe(404);
  });
  it('lets the owner attach a blob to a post through the normal posts route', async () => {
    const u = await t.createUser('painter');
    const blob = await storeBlob(t.db, PNG, 'image/png', t.clock.now());
    const uploadId = await blobUpload(t.db, u.id, blob, 'image/png', t.clock.now());
    const r = await t.as(u).post('/api/posts', { body: 'look', uploadIds: [uploadId], alts: ['a dot'] });
    expect(r.status).toBe(201);
    const [p] = await t.db.select().from(posts).where(eq(posts.authorId, u.id));
    expect(p!.media).toEqual([{ url: blob.url, width: 1, height: 1, alt: 'a dot' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-blobs.test.ts`
Expected: FAIL — cannot resolve `../src/agents/images.ts`.

- [ ] **Step 3: Add the tables**

In `apps/server/src/db/schema.ts`, add `customType` to the `drizzle-orm/pg-core` import and append:

```ts
// PGlite returns Uint8Array, node-postgres returns Buffer: normalise to Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

export const mediaBlobs = pgTable('media_blobs', {
  id: text('id').primaryKey(),
  mime: text('mime').notNull(),
  bytes: bytea('bytes').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sha256: text('sha256').notNull().unique(),
  createdAt: ts('created_at').notNull(),
});

export const memeTemplates = pgTable('meme_templates', {
  id: text('id').primaryKey(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  brief: text('brief').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  authorId: text('author_id').notNull().references(() => users.id),
  usesToday: integer('uses_today').notNull().default(0),
  usesDay: text('uses_day').notNull().default(''),
  lastUsedAt: ts('last_used_at'),
  lastUsedPostSeq: bigint('last_used_post_seq', { mode: 'number' }),
  createdAt: ts('created_at').notNull(),
});

export const memeRenders = pgTable('meme_renders', {
  hash: text('hash').primaryKey(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  postId: text('post_id'),
  createdAt: ts('created_at').notNull(),
});

export const shareCards = pgTable('share_cards', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  blobId: text('blob_id').notNull().references(() => mediaBlobs.id),
  title: text('title').notNull(),
  href: text('href').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const imageSpend = pgTable('image_spend', {
  day: text('day').primaryKey(),
  usd: doublePrecision('usd').notNull().default(0),
  count: integer('count').notNull().default(0),
});

/** Big moments the spotlight (Task 5.6) has handled, one row per moment key, so a moment never gets two cards or two rounds of notifications. */
export const spotlightDone = pgTable('spotlight_done', {
  key: text('key').primaryKey(),
  at: ts('at').notNull(),
});
```

Run (in `apps/server`): `npx drizzle-kit generate --name pictures`
Expected: a new `drizzle/0005_pictures.sql` creating the six tables. Rename nothing; commit the generated file and the updated `drizzle/meta`.

- [ ] **Step 4: Implement `images.ts`**

`apps/server/src/agents/images.ts`:

```ts
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { mediaBlobs, uploads } from '../db/schema.ts';
import { imageInfo } from '../lib/image-size.ts';
import { newId } from '../lib/ids.ts';

export type { ImagePolicy } from './types.ts';

/** A paid image generator: OpenAI in production (Task 5.3), a fake in tests. */
export interface ImageGen { generate(prompt: string, size: '1024x1024' | '1536x1024'): Promise<{ png: Buffer; usd: number }> }

export const blobUrl = (id: string) => `/api/blobs/${id}`;

/** Stores image bytes once per content hash. Only real PNG/JPEG/GIF/WebP bytes whose sniffed type matches `mime`. */
export async function storeBlob(db: Db, png: Buffer, mime: string, now: Date): Promise<{ id: string; url: string; width: number; height: number }> {
  const info = imageInfo(png);
  if (!info || info.mime !== mime) throw new Error('NOT_AN_IMAGE');
  const sha256 = createHash('sha256').update(png).digest('hex');
  const [existing] = await db.select({ id: mediaBlobs.id, width: mediaBlobs.width, height: mediaBlobs.height }).from(mediaBlobs).where(eq(mediaBlobs.sha256, sha256));
  if (existing) return { ...existing, url: blobUrl(existing.id) };
  const id = newId();
  await db.insert(mediaBlobs).values({ id, mime, bytes: png, width: info.width, height: info.height, sha256, createdAt: now }).onConflictDoNothing();
  const [row] = await db.select({ id: mediaBlobs.id, width: mediaBlobs.width, height: mediaBlobs.height }).from(mediaBlobs).where(eq(mediaBlobs.sha256, sha256));
  return { ...row!, url: blobUrl(row!.id) };
}

/** An uploads row owned by `uploaderId` pointing at a blob, so the normal posts route can attach it. */
export async function blobUpload(db: Db, uploaderId: string, blob: { id: string; url: string; width: number; height: number }, mime: string, now: Date): Promise<string> {
  const id = newId();
  await db.insert(uploads).values({ id, uploaderId, url: blob.url, mime, width: blob.width, height: blob.height, createdAt: now });
  return id;
}
```

- [ ] **Step 5: Implement the route**

`apps/server/src/routes/blobs.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { mediaBlobs } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';

export default async function blobsRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  app.get<{ Params: { id: string } }>('/blobs/:id', async (req, reply) => {
    if (!/^[A-Za-z0-9]{10,40}$/.test(req.params.id)) throw errors.notFound('Image');
    const [b] = await db.select({ mime: mediaBlobs.mime, bytes: mediaBlobs.bytes }).from(mediaBlobs).where(eq(mediaBlobs.id, req.params.id));
    if (!b) throw errors.notFound('Image');
    return reply
      .header('content-type', b.mime)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(b.bytes);
  });
}
```

In `apps/server/src/app.ts`, add `import blobsRoutes from './routes/blobs.ts';` next to the other route imports and register it after `uploadsRoutes`:

```ts
  await app.register(blobsRoutes, { prefix: '/api' });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/agents-blobs.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit -p .` — no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle apps/server/src/agents/images.ts apps/server/src/routes/blobs.ts apps/server/src/app.ts apps/server/test/agents-blobs.test.ts
git commit -m "feat(agents): media blobs in Postgres, /api/blobs, and blob uploads for posts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5.2: Data cards

Free pictures built from real numbers: SVG written in code, rendered to PNG locally. A bundled font keeps rendering identical on Railway (the container has no system fonts).

**Files:**
- Modify: `apps/server/package.json` (add `@resvg/resvg-js` `2.6.2`, `dejavu-fonts-ttf` `2.37.3`)
- Create: `apps/server/src/agents/cards.ts`
- Test: `apps/server/test/agents-cards.test.ts`

**Interfaces:**
- Consumes: `imageInfo` (test only).
- Produces:
  - `export type CardKind = 'pnl' | 'chart' | 'rug' | 'leaderboard' | 'launch';`
  - `export interface CardData { pnl: { agent: string; symbol: string; costSol: number; valueSol: number; pct: number }; chart: { symbol: string; points: number[]; changePct: number }; rug: { creator: string; symbol: string; soldPct: number; sol: number; holdersHurt: number; signature: string }; leaderboard: { rows: { name: string; totalSol: number; pnlSol: number }[] }; launch: { symbol: string; name: string; creator: string; hue: number } }`
  - `renderSvg(svg: string): Buffer` — PNG bytes.
  - `cardSvg<K extends CardKind>(kind: K, data: CardData[K]): string` — 1200×675 SVG.
  - `renderCard<K extends CardKind>(kind: K, data: CardData[K]): Buffer` — PNG 1200×675.
  - `escapeXml(s: string): string`, `plain(s: string, max: number): string` (drops characters outside the Basic Multilingual Plane and control characters, then truncates with `…`).
  - `FONT_FAMILY = 'DejaVu Sans'`.

- [ ] **Step 1: Add the dependencies**

Run (repo root): `npm install -w @shillex/server @resvg/resvg-js@2.6.2 dejavu-fonts-ttf@2.37.3 --save-exact`
Expected: both appear under `apps/server/package.json` dependencies; `node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` exist.

- [ ] **Step 2: Write the failing test**

`apps/server/test/agents-cards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { imageInfo } from '../src/lib/image-size.ts';
import { cardSvg, escapeXml, plain, renderCard } from '../src/agents/cards.ts';

describe('data cards', () => {
  it('renders every card kind to a 1200×675 PNG', () => {
    const pngs = [
      renderCard('pnl', { agent: 'Nine', symbol: 'MOTH', costSol: 0.02, valueSol: 0.05, pct: 150 }),
      renderCard('chart', { symbol: 'MOTH', points: [1, 1.2, 0.9, 1.6, 2.4], changePct: 140 }),
      renderCard('rug', { creator: 'ledger_22', symbol: 'LAMP', soldPct: 92, sol: 0.41, holdersHurt: 7, signature: '5abc' }),
      renderCard('leaderboard', { rows: [{ name: 'Nine', totalSol: 0.4, pnlSol: 0.3 }, { name: 'Ember', totalSol: 0.2, pnlSol: -0.05 }] }),
      renderCard('launch', { symbol: 'MOTH', name: 'Moth Coin', creator: 'Nine', hue: 280 }),
    ];
    for (const png of pngs) expect(imageInfo(png)).toEqual({ mime: 'image/png', width: 1200, height: 675 });
  });
  it('escapes markup and strips emoji and control characters from text', () => {
    expect(escapeXml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(plain('moth 🦋 king\u0007', 40)).toBe('moth  king');
    expect(plain('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
    const svg = cardSvg('pnl', { agent: '<script>', symbol: 'A&B', costSol: 1, valueSol: 1, pct: 0 });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
  it('colours a loss red and a gain green', () => {
    expect(cardSvg('pnl', { agent: 'a', symbol: 'X', costSol: 1, valueSol: 2, pct: 100 })).toContain('#34d399');
    expect(cardSvg('pnl', { agent: 'a', symbol: 'X', costSol: 2, valueSol: 1, pct: -50 })).toContain('#f87171');
  });
  it('draws a chart with fewer than two points without crashing', () => {
    expect(imageInfo(renderCard('chart', { symbol: 'X', points: [1], changePct: 0 }))?.width).toBe(1200);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run test/agents-cards.test.ts`
Expected: FAIL — cannot resolve `../src/agents/cards.ts`.

- [ ] **Step 4: Implement the cards**

`apps/server/src/agents/cards.ts`:

```ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT_FILES = [join(fontDir, 'DejaVuSans.ttf'), join(fontDir, 'DejaVuSans-Bold.ttf')];
export const FONT_FAMILY = 'DejaVu Sans';

export type CardKind = 'pnl' | 'chart' | 'rug' | 'leaderboard' | 'launch';
export interface CardData {
  pnl: { agent: string; symbol: string; costSol: number; valueSol: number; pct: number };
  chart: { symbol: string; points: number[]; changePct: number };
  rug: { creator: string; symbol: string; soldPct: number; sol: number; holdersHurt: number; signature: string };
  leaderboard: { rows: { name: string; totalSol: number; pnlSol: number }[] };
  launch: { symbol: string; name: string; creator: string; hue: number };
}

const W = 1200, H = 675;
const UP = '#34d399', DOWN = '#f87171', INK = '#f4f1ff', MUTED = '#a59bc9', BG_TOP = '#1a1033', BG_LOW = '#0b0716';

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
/** The bundled font has no emoji: keep the Basic Multilingual Plane, drop control characters, cap the length. */
export function plain(s: string, max: number): string {
  const chars = [...s].filter((c) => c.codePointAt(0)! <= 0xffff && !/[\u0000-\u001f\u007f]/.test(c));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}
const txt = (s: string, max: number) => escapeXml(plain(s, max));
const sol = (n: number) => `${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 4 : 3)} SOL`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;

function frame(inner: string, accent = '#8b6cff') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_LOW}"/></linearGradient>
<radialGradient id="glow" cx="0.8" cy="1" r="0.8"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
${inner}
<text x="60" y="${H - 40}" font-size="26" fill="${MUTED}">shillex · devnet</text></svg>`;
}

const builders: { [K in CardKind]: (d: CardData[K]) => string } = {
  pnl: (d) => {
    const c = d.pct >= 0 ? UP : DOWN;
    return frame(`<text x="60" y="110" font-size="40" fill="${MUTED}">${txt(d.agent, 28)} on $${txt(d.symbol, 10)}</text>
<text x="60" y="330" font-size="190" font-weight="bold" fill="${c}">${signed(d.pct)}</text>
<text x="60" y="440" font-size="44" fill="${INK}">in ${sol(d.costSol)} → now ${sol(d.valueSol)}</text>`, c);
  },
  chart: (d) => {
    const c = d.changePct >= 0 ? UP : DOWN;
    const pts = d.points.length >= 2 ? d.points : [d.points[0] ?? 1, d.points[0] ?? 1];
    const min = Math.min(...pts), max = Math.max(...pts);
    const x = (i: number) => 60 + (i / (pts.length - 1)) * (W - 120), y = (p: number) => 560 - ((p - min) / (max - min || 1)) * 340;
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
    return frame(`<text x="60" y="110" font-size="56" font-weight="bold" fill="${INK}">$${txt(d.symbol, 10)}</text>
<text x="${W - 60}" y="110" font-size="56" font-weight="bold" fill="${c}" text-anchor="end">${signed(d.changePct)}</text>
<polygon points="60,560 ${line} ${W - 60},560" fill="${c}" fill-opacity="0.18"/><polyline points="${line}" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>`, c);
  },
  rug: (d) => frame(`<text x="60" y="120" font-size="64" font-weight="bold" fill="${DOWN}">RUG RECEIPT</text>
<text x="60" y="230" font-size="48" fill="${INK}">@${txt(d.creator, 24)} sold ${d.soldPct.toFixed(0)}% of $${txt(d.symbol, 10)}</text>
<text x="60" y="320" font-size="48" fill="${INK}">for ${sol(d.sol)} · ${d.holdersHurt} holders left holding</text>
<text x="60" y="420" font-size="30" fill="${MUTED}">tx ${txt(d.signature.slice(0, 20), 24)}…</text>`, DOWN),
  leaderboard: (d) => frame(`<text x="60" y="110" font-size="56" font-weight="bold" fill="${INK}">Top agents</text>
${d.rows.slice(0, 5).map((r, i) => `<text x="60" y="${200 + i * 76}" font-size="44" fill="${INK}">${i + 1}. ${txt(r.name, 22)}</text>
<text x="${W - 300}" y="${200 + i * 76}" font-size="40" fill="${INK}" text-anchor="end">${sol(r.totalSol)}</text>
<text x="${W - 60}" y="${200 + i * 76}" font-size="40" fill="${r.pnlSol >= 0 ? UP : DOWN}" text-anchor="end">${r.pnlSol >= 0 ? '+' : ''}${r.pnlSol.toFixed(3)}</text>`).join('\n')}`),
  launch: (d) => {
    const accent = `hsl(${Math.round(d.hue) % 360}, 80%, 62%)`;
    return frame(`<circle cx="${W - 260}" cy="300" r="170" fill="${accent}" fill-opacity="0.85"/>
<text x="${W - 260}" y="330" font-size="84" font-weight="bold" fill="${BG_LOW}" text-anchor="middle">$${txt(d.symbol, 6)}</text>
<text x="60" y="140" font-size="40" fill="${MUTED}">NEW LAUNCH</text>
<text x="60" y="250" font-size="72" font-weight="bold" fill="${INK}">${txt(d.name, 18)}</text>
<text x="60" y="340" font-size="44" fill="${INK}">by @${txt(d.creator, 24)}</text>`, accent);
  },
};

export function cardSvg<K extends CardKind>(kind: K, data: CardData[K]): string { return builders[kind](data); }

export function renderSvg(svg: string): Buffer {
  const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: FONT_FAMILY } });
  return Buffer.from(r.render().asPng());
}

export function renderCard<K extends CardKind>(kind: K, data: CardData[K]): Buffer { return renderSvg(cardSvg(kind, data)); }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/agents-cards.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit -p .` — no errors.

- [ ] **Step 6: Look at the cards**

Write each of the five PNGs from the test inputs to the scratchpad with a one-off `npx tsx -e` script that imports `renderCard` and `writeFileSync`s them, then open each with the Read tool. Check: text inside the frame, nothing clipped, gain green and loss red, legible at 50% size. Fix positions in `cards.ts` if anything overlaps, rerun Step 5.

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json package-lock.json apps/server/src/agents/cards.ts apps/server/test/agents-cards.test.ts
git commit -m "feat(agents): data cards (P&L, chart, rug receipt, leaderboard, launch poster) rendered locally with a bundled font

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5.3: Meme templates, the OpenAI generator, and captions

A template is a base image without text, generated once from a brief an agent wrote. The engine writes the jokes: captions are rendered locally onto the template, so one picture supports many memes. Paid generation is capped by its own daily budget.

**Files:**
- Create: `apps/server/src/agents/openai-images.ts`
- Create: `apps/server/src/agents/image-budget.ts`
- Create: `apps/server/src/agents/memes.ts`
- Test: `apps/server/test/agents-memes.test.ts`

**Interfaces:**
- Consumes: `storeBlob` (5.1), `renderSvg`, `escapeXml`, `plain`, `FONT_FAMILY` (5.2); `ImageGen` (master); config `openaiApiKey`, `openaiImageModel`, `imageDailyBudgetUsd`, `imageDailyMax`.
- Produces:
  - `class OpenAIImageGen implements ImageGen { constructor(apiKey: string, model: string, fetchFn?: typeof fetch) }` — `POST https://api.openai.com/v1/images/generations` with `{ model, prompt, size, n: 1, quality: 'low' }`; decodes `data[0].b64_json`; `usd` from `IMAGE_PRICE_USD[size]`; non-2xx throws `Error('OPENAI_IMAGE_<status>: <message>')` and never includes the key.
  - `export const IMAGE_PRICE_USD: Record<'1024x1024' | '1536x1024', number> = { '1024x1024': 0.011, '1536x1024': 0.016 };`
  - `canGenerate(db: Db, limits: { usd: number; max: number }, now: Date): Promise<boolean>`; `recordImageSpend(db: Db, usd: number, now: Date): Promise<void>` — UTC day rows in `imageSpend`.
  - `generateTemplate(d: { db: Db; gen: ImageGen | null; limits: { usd: number; max: number }; now: () => Date }, t: { brief: string; tags: string[]; authorId: string }): Promise<string | null>` — returns the template id, or `null` when there is no generator, the budget is spent, or generation fails (logged, never thrown).
  - `captionMeme(templatePng: Buffer, width: number, height: number, top: string, bottom: string): Buffer` — PNG of the same size with Impact-style captions (bold, upper case, white with black outline), wrapped to at most 2 lines each.
  - `templateBriefPrompt(brief: string): string` — the prompt sent to OpenAI: the brief plus "no text, no letters, no logos, meme template composition, clear space at the top and bottom".

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-memes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { imageInfo } from '../src/lib/image-size.ts';
import { renderSvg } from '../src/agents/cards.ts';
import { OpenAIImageGen, IMAGE_PRICE_USD } from '../src/agents/openai-images.ts';
import { canGenerate, recordImageSpend } from '../src/agents/image-budget.ts';
import { captionMeme, generateTemplate, templateBriefPrompt } from '../src/agents/memes.ts';
import { memeTemplates } from '../src/db/schema.ts';
import type { ImageGen } from '../src/agents/images.ts';

const base = renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#335"/></svg>');
const fakeGen = (calls: string[] = []): ImageGen => ({ async generate(prompt) { calls.push(prompt); return { png: base, usd: 0.011 }; } });
let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(() => t.close());

describe('OpenAI image generator', () => {
  it('posts the documented request and decodes b64_json', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ data: [{ b64_json: base.toString('base64') }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await new OpenAIImageGen('sk-test', 'gpt-image-1', fetchFn).generate('a raccoon', '1024x1024');
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ model: 'gpt-image-1', prompt: 'a raccoon', size: '1024x1024', n: 1, quality: 'low' });
    expect(r.png.equals(base)).toBe(true);
    expect(r.usd).toBe(IMAGE_PRICE_USD['1024x1024']);
  });
  it('turns an API error into a short error without the key', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: { message: 'billing hard limit' } }), { status: 400 })) as unknown as typeof fetch;
    const err = await new OpenAIImageGen('sk-secret', 'gpt-image-1', fetchFn).generate('x', '1024x1024').catch((e: Error) => e);
    expect(String(err)).toContain('OPENAI_IMAGE_400: billing hard limit');
    expect(String(err)).not.toContain('sk-secret');
  });
});

describe('image budget and templates', () => {
  it('stops at the daily dollar budget or the daily count, whichever comes first', async () => {
    const now = t.clock.now();
    expect(await canGenerate(t.db, { usd: 0.03, max: 2 }, now)).toBe(true);
    await recordImageSpend(t.db, 0.011, now);
    await recordImageSpend(t.db, 0.011, now);
    expect(await canGenerate(t.db, { usd: 0.03, max: 2 }, now)).toBe(false); // count
    expect(await canGenerate(t.db, { usd: 0.02, max: 10 }, now)).toBe(false); // dollars
    expect(await canGenerate(t.db, { usd: 0.03, max: 2 }, new Date(now.getTime() + 86_400_000))).toBe(true); // next UTC day
  });
  it('generates a template from a brief, records the spend, and asks for an image without text', async () => {
    const calls: string[] = [];
    const u = await t.createUser('briefwriter');
    const id = await generateTemplate({ db: t.db, gen: fakeGen(calls), limits: { usd: 1, max: 15 }, now: t.clock.now }, { brief: 'a raccoon in a hard hat staring at a red chart', tags: ['got_rugged', 'dumping'], authorId: u.id });
    expect(id).toBeTruthy();
    expect(calls[0]).toBe(templateBriefPrompt('a raccoon in a hard hat staring at a red chart'));
    expect(calls[0]).toMatch(/no text/i);
    expect((await t.db.select().from(memeTemplates)).find((r) => r.id === id)).toMatchObject({ tags: ['got_rugged', 'dumping'], usesToday: 0 });
  });
  it('returns null without a generator or when generation fails, and does not record spend', async () => {
    const u = await t.createUser('nogen');
    const d = { db: t.db, limits: { usd: 1, max: 99 }, now: () => new Date('2026-12-01T00:00:00Z') };
    expect(await generateTemplate({ ...d, gen: null }, { brief: 'x', tags: [], authorId: u.id })).toBeNull();
    const failing: ImageGen = { async generate() { throw new Error('OPENAI_IMAGE_500: down'); } };
    expect(await generateTemplate({ ...d, gen: failing }, { brief: 'x', tags: [], authorId: u.id })).toBeNull();
    expect(await canGenerate(t.db, { usd: 0.0001, max: 1 }, d.now())).toBe(true);
  });
});

describe('captions', () => {
  it('captions a template at its own size, and different captions give different images', () => {
    const a = captionMeme(base, 1024, 1024, 'when the dev says', 'locked liquidity');
    const b = captionMeme(base, 1024, 1024, 'me buying the top', 'again');
    expect(imageInfo(a)).toEqual({ mime: 'image/png', width: 1024, height: 1024 });
    expect(a.equals(b)).toBe(false);
  });
  it('survives markup, emoji and very long captions', () => {
    const png = captionMeme(base, 1024, 1024, '<b>🦋</b> & '.repeat(30), '');
    expect(imageInfo(png)?.width).toBe(1024);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-memes.test.ts`
Expected: FAIL — cannot resolve `../src/agents/openai-images.ts`.

- [ ] **Step 3: Implement the generator**

`apps/server/src/agents/openai-images.ts`:

```ts
import type { ImageGen } from './images.ts';

export const IMAGE_PRICE_USD: Record<'1024x1024' | '1536x1024', number> = { '1024x1024': 0.011, '1536x1024': 0.016 };

/** OpenAI Images over fetch (no SDK). Low quality: memes need a clear scene, not detail. */
export class OpenAIImageGen implements ImageGen {
  constructor(private apiKey: string, private model: string, private fetchFn: typeof fetch = fetch) {}
  async generate(prompt: string, size: '1024x1024' | '1536x1024'): Promise<{ png: Buffer; usd: number }> {
    const r = await this.fetchFn('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt, size, n: 1, quality: 'low' }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!r.ok) throw new Error(`OPENAI_IMAGE_${r.status}: ${(body.error?.message ?? 'request failed').slice(0, 200)}`);
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error('OPENAI_IMAGE_EMPTY: no image in the response');
    return { png: Buffer.from(b64, 'base64'), usd: IMAGE_PRICE_USD[size] };
  }
}
```

- [ ] **Step 4: Implement the budget**

`apps/server/src/agents/image-budget.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { imageSpend } from '../db/schema.ts';

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function canGenerate(db: Db, limits: { usd: number; max: number }, now: Date): Promise<boolean> {
  const [r] = await db.select().from(imageSpend).where(eq(imageSpend.day, day(now)));
  return !r || (r.usd < limits.usd && r.count < limits.max);
}

export async function recordImageSpend(db: Db, usd: number, now: Date): Promise<void> {
  await db.insert(imageSpend).values({ day: day(now), usd, count: 1 })
    .onConflictDoUpdate({ target: imageSpend.day, set: { usd: sql`${imageSpend.usd} + ${usd}`, count: sql`${imageSpend.count} + 1` } });
}
```

- [ ] **Step 5: Implement templates and captions**

`apps/server/src/agents/memes.ts`:

```ts
import type { Db } from '../db/client.ts';
import { memeTemplates } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { FONT_FAMILY, escapeXml, plain, renderSvg } from './cards.ts';
import { canGenerate, recordImageSpend } from './image-budget.ts';
import { storeBlob, type ImageGen } from './images.ts';

export const templateBriefPrompt = (brief: string) =>
  `${plain(brief, 300)}. Meme template composition, one clear subject, expressive, clear empty space at the top and bottom for captions. No text, no letters, no words, no logos, no watermarks.`;

export async function generateTemplate(
  d: { db: Db; gen: ImageGen | null; limits: { usd: number; max: number }; now: () => Date },
  t: { brief: string; tags: string[]; authorId: string },
): Promise<string | null> {
  if (!d.gen || !(await canGenerate(d.db, d.limits, d.now()))) return null;
  let png: Buffer, usd: number;
  try { ({ png, usd } = await d.gen.generate(templateBriefPrompt(t.brief), '1024x1024')); }
  catch (e) { console.error('[agents] meme template generation failed', (e as Error).message); return null; }
  await recordImageSpend(d.db, usd, d.now());
  const blob = await storeBlob(d.db, png, 'image/png', d.now());
  const id = newId();
  await d.db.insert(memeTemplates).values({ id, blobId: blob.id, brief: plain(t.brief, 300), tags: t.tags, authorId: t.authorId, createdAt: d.now() });
  return id;
}

/** Greedy word wrap into at most `lines` lines of about `width` characters; the last line ends with … if cut. */
function wrap(text: string, width: number, lines: number): string[] {
  const words = plain(text, 400).toUpperCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
    if (out.length === lines) break;
  }
  if (cur && out.length < lines) out.push(cur);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = `${out[lines - 1]!.slice(0, width - 1)}…`;
  return out;
}

/** Impact-style captions (bold, upper case, white with a black outline) over the template, at the template's own size. */
export function captionMeme(templatePng: Buffer, width: number, height: number, top: string, bottom: string): Buffer {
  const size = Math.round(width / 12), perLine = Math.floor(width / (size * 0.62));
  const block = (text: string, fromTop: boolean) => wrap(text, perLine, 2).map((l, i, all) => {
    const y = fromTop ? size * 1.15 * (i + 1) : height - size * 0.35 - size * 1.15 * (all.length - 1 - i);
    return `<text x="${width / 2}" y="${y.toFixed(0)}" text-anchor="middle" font-size="${size}" font-weight="bold" fill="#fff" stroke="#000" stroke-width="${Math.max(3, size / 12).toFixed(1)}" paint-order="stroke">${escapeXml(l)}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}">
<image width="${width}" height="${height}" xlink:href="data:image/png;base64,${templatePng.toString('base64')}"/>${block(top, true)}${block(bottom, false)}</svg>`;
  return renderSvg(svg);
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/agents-memes.test.ts`
Expected: PASS (7 tests). Then `npx tsc --noEmit -p .` — no errors.

- [ ] **Step 7: Look at a captioned meme**

With a one-off `npx tsx -e` script, caption the solid template with `'when the dev says'` / `'liquidity is locked'` and a 40-word top caption, write both PNGs to the scratchpad and open them with Read. Check: captions centred, outlined, inside the image, long captions cut to two lines with `…`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/agents/openai-images.ts apps/server/src/agents/image-budget.ts apps/server/src/agents/memes.ts apps/server/test/agents-memes.test.ts
git commit -m "feat(agents): meme templates from OpenAI under a daily image budget, captions rendered locally

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5.4: Image selection policy and the engine hook

Decides whether an agent post carries a picture and which one, under the Global Constraints: about 1 in 5 agent posts, a template at most 3 times per UTC day and never within 40 site-wide posts, a captioned render never twice, and data cards instead of a repeat when the library can't satisfy the rules.

**Files:**
- Create: `apps/server/src/agents/image-policy.ts`
- Modify: `apps/server/src/world/tools.ts` (`ToolContext.uploadIds`, used by `post`, `reply`, `quote`)
- Modify: `apps/server/src/agents/act.ts` (Phase 2's `postLine` image branch moves onto `ToolContext.uploadIds`; `reply` and the launch announcement also ask `d.images`)
- Modify: `apps/server/src/world/boot.ts` (`startAgents()` passes `images: createImagePolicy(...)` to `startEngine`)
- Test: `apps/server/test/agents-image-policy.test.ts`

**Interfaces:**
- Consumes: `AgentView`, `Candidate`, `Situation`, `ImagePolicy`, `EngineDeps` (master); `fillLine` (Phase 2.2); `storeBlob`, `blobUpload` (5.1); `renderCard`, `CardData` (5.2); `captionMeme`, `generateTemplate` (5.3); `memeTemplates`, `memeRenders`, `mediaBlobs`, `posts`, `users` tables.
- Produces:
  - `createImagePolicy(d: { db: Db; now: () => Date; rng: () => number }): ImagePolicy`
  - `IMAGE_SHARE = 0.2`, `TEMPLATE_DAILY_MAX = 3`, `TEMPLATE_GAP_POSTS = 40`, `RECENT_WINDOW = 40` (exported constants)
  - `imageWanted(v: AgentView, c: Candidate, recentImageShare: number, rng: () => number): boolean` — pure.
  - `pickTemplate(db: Db, situation: Situation, now: Date): Promise<{ id: string; blobId: string } | null>`
  - `ToolContext` gains `uploadIds?: string[]` (and `alts?: string[]`); `post`, `reply` and `quote` send `uploadIds`/`alts` when set.

**Rules implemented by `maybeAttach(v, c, text)`:**
1. Only for `c.kind` in `post`, `reply`, `launch`, `rug`, `leak`; anything else → `null`.
2. `launch` → launch poster; `rug` → rug receipt (both always, they are rare). Otherwise `imageWanted` decides: probability `0.12 + 0.16 × traits.humor` (mean 0.2), and never when the share of image posts among the last `RECENT_WINDOW` agent posts is ≥ 0.25.
3. Kind by situation: `took_profit`/`sold`/`bought` with a matching position → P&L card; `pumping`/`dumping`/`market_take` with a coin → chart card; everything else → a meme.
4. Meme: templates whose `tags` include the situation, else any template; least recently used first; skip when `usesToday ≥ 3` (same UTC day) or when fewer than 40 posts have been created site-wide since `lastUsedPostSeq`; caption = a `memeCaptions` entry for the situation (or any), slots filled with `fillLine`; skip a caption whose render hash `sha256(templateId + '\n' + top + '\n' + bottom)` exists in `memeRenders`.
5. No meme possible → fall back to a data card: P&L of the agent's best position if it has one, else the leaderboard card. Never repeat a template inside the 40-post gap.
6. Store the PNG with `storeBlob`, create an upload owned by the agent with `blobUpload`, record the render (memes) and bump the template's `usesToday`/`usesDay`/`lastUsedAt`/`lastUsedPostSeq` (= current site-wide post count).

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-image-policy.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { renderSvg } from '../src/agents/cards.ts';
import { storeBlob } from '../src/agents/images.ts';
import { createImagePolicy, imageWanted, TEMPLATE_GAP_POSTS } from '../src/agents/image-policy.ts';
import { fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { memeRenders, memeTemplates, posts, uploads, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import type { AgentView, Candidate } from '../src/agents/types.ts';
import { emptyDepth } from '../src/agents/depth/registry.ts';
import { mulberry32 } from '../src/seed/rng.ts';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let agentId = '';
beforeEach(async () => {
  t = await makeTestApp();
  agentId = newId();
  await t.db.insert(users).values({ id: agentId, username: 'nine', displayName: 'Nine', kind: 'agent', createdAt: t.clock.now() });
});
afterEach(() => t.close());

const view = (over: Partial<AgentView> = {}): AgentView => {
  const pb = fallbackPhrasebook('nine');
  pb.memeCaptions = [{ situation: 'idle', top: 'me at 3am', bottom: 'refreshing {coin}' }, { situation: 'idle', top: 'nobody:', bottom: 'me: one more trade' }];
  return {
    agent: { id: agentId, username: 'nine', displayName: 'Nine' },
    state: { energy: 1, mood: 0, traits: { ...pb.traits, humor: 1 }, cooldowns: {}, recentLines: [], brokeSince: null, ghostSince: null },
    phrasebook: pb,
    wallet: { lamports: 50_000_000, positions: [] },
    coins: [{ mint: 'M1', symbol: 'MOTH', creatorId: 'x', priceLamports: 1, change10m: 0.4, change1h: 0.9, holders: 5, graduated: false, launchedAt: '2026-10-09T00:00:00Z' }],
    mentions: [], dms: [], feed: [], rooms: [], affinity: {}, weather: 'grind', now: t.clock.now().toISOString(), depth: emptyDepth(), ...over,
  };
};
const meme: Candidate = { kind: 'post', score: 1, reason: 'test', situation: 'idle' };
const template = async (tags: string[] = ['idle']) => {
  const png = renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}"/></svg>`);
  const blob = await storeBlob(t.db, png, 'image/png', t.clock.now());
  const id = newId();
  await t.db.insert(memeTemplates).values({ id, blobId: blob.id, brief: 'b', tags, authorId: agentId, createdAt: t.clock.now() });
  return id;
};
const addPosts = async (n: number) => {
  for (let i = 0; i < n; i++) await t.db.insert(posts).values({ id: newId(), authorId: agentId, kind: 'post', body: `p${i}`, visibility: 'public', createdAt: t.clock.now() });
};
const alwaysWant = () => 0; // rng() = 0 → below any positive probability

describe('imageWanted', () => {
  it('averages about 1 in 5 for a mid-humour agent and stops when recent posts are already image-heavy', () => {
    const v = view();
    v.state.traits.humor = 0.5;
    const rng = mulberry32(7);
    let n = 0;
    for (let i = 0; i < 5000; i++) if (imageWanted(v, meme, 0, rng)) n++;
    expect(n / 5000).toBeGreaterThan(0.17);
    expect(n / 5000).toBeLessThan(0.23);
    expect(imageWanted(v, meme, 0.25, alwaysWant)).toBe(false);
  });
});

describe('image policy', () => {
  it('captions a template and attaches it as an upload owned by the agent', async () => {
    const id = await template();
    const r = await createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant }).maybeAttach(view(), meme, 'text');
    expect(r).not.toBeNull();
    const [u] = await t.db.select().from(uploads).where(eq(uploads.id, r!.uploadId));
    expect(u).toMatchObject({ uploaderId: agentId });
    expect(u!.url).toMatch(/^\/api\/blobs\//);
    expect((await t.db.select().from(memeTemplates).where(eq(memeTemplates.id, id)))[0]).toMatchObject({ usesToday: 1 });
    expect(await t.db.select().from(memeRenders)).toHaveLength(1);
  });
  it('never reuses a template within 40 site-wide posts, and falls back to a data card (Review Focus 5)', async () => {
    await template();
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant });
    const first = await policy.maybeAttach(view(), meme, 'a');
    await addPosts(TEMPLATE_GAP_POSTS - 1);
    const second = await policy.maybeAttach(view(), meme, 'b');
    expect(second).not.toBeNull();
    const [u1] = await t.db.select().from(uploads).where(eq(uploads.id, first!.uploadId));
    const [u2] = await t.db.select().from(uploads).where(eq(uploads.id, second!.uploadId));
    expect(u2!.url).not.toBe(u1!.url);
    expect(u2!.width).toBe(1200); // a data card, not the 512px template
    await addPosts(1);
    const third = await policy.maybeAttach(view(), meme, 'c');
    const [u3] = await t.db.select().from(uploads).where(eq(uploads.id, third!.uploadId));
    expect(u3!.width).toBe(512); // the gap has passed: the template is allowed again
  });
  it('uses a template at most 3 times per UTC day', async () => {
    const id = await template();
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant });
    for (let i = 0; i < 4; i++) { await policy.maybeAttach(view(), meme, `x${i}`); await addPosts(TEMPLATE_GAP_POSTS); }
    expect((await t.db.select().from(memeTemplates).where(eq(memeTemplates.id, id)))[0]!.usesToday).toBe(3);
  });
  it('never posts the same captioned render twice', async () => {
    await template();
    const v = view();
    v.phrasebook.memeCaptions = [{ situation: 'idle', top: 'only', bottom: 'one' }];
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant });
    await policy.maybeAttach(v, meme, 'a');
    await addPosts(TEMPLATE_GAP_POSTS);
    const again = await policy.maybeAttach(v, meme, 'b');
    const [u] = await t.db.select().from(uploads).where(eq(uploads.id, again!.uploadId));
    expect(u!.width).toBe(1200); // the only caption on the only template was used: data card instead
    expect(await t.db.select().from(memeRenders)).toHaveLength(1);
  });
  it('always attaches a launch poster to a launch and a rug receipt to a rug, and nothing to a react', async () => {
    const policy = createImagePolicy({ db: t.db, now: t.clock.now, rng: () => 0.99 });
    expect(await policy.maybeAttach(view(), { kind: 'launch', score: 1, reason: 'r', situation: 'launching', target: { mint: 'M1' } }, 'x')).not.toBeNull();
    expect(await policy.maybeAttach(view(), { kind: 'rug', score: 1, reason: 'r', situation: 'rugged_someone', target: { mint: 'M1' } }, 'x')).not.toBeNull();
    expect(await policy.maybeAttach(view(), { kind: 'react', score: 1, reason: 'r' }, 'x')).toBeNull();
  });
  it('attaches nothing to ordinary posts once a quarter of recent agent posts carry images', async () => {
    await template();
    for (let i = 0; i < 40; i++) {
      await t.db.insert(posts).values({ id: newId(), authorId: agentId, kind: 'post', body: `img${i}`, visibility: 'public', createdAt: t.clock.now(),
        media: i % 3 === 0 ? [{ url: '/api/blobs/x', width: 1, height: 1, alt: '' }] : [] });
    }
    expect(await createImagePolicy({ db: t.db, now: t.clock.now, rng: alwaysWant }).maybeAttach(view(), meme, 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-image-policy.test.ts`
Expected: FAIL — cannot resolve `../src/agents/image-policy.ts`.

- [ ] **Step 3: Implement the policy**

`apps/server/src/agents/image-policy.ts`:

```ts
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { mediaBlobs, memeRenders, memeTemplates, posts, users } from '../db/schema.ts';
import { renderCard, type CardData, type CardKind } from './cards.ts';
import { captionMeme } from './memes.ts';
import { blobUpload, storeBlob, type ImagePolicy } from './images.ts';
import { fillLine } from './phrasebook.ts';
import type { AgentView, Candidate, Situation } from './types.ts';

export const IMAGE_SHARE = 0.2;
export const TEMPLATE_DAILY_MAX = 3;
export const TEMPLATE_GAP_POSTS = 40;
export const RECENT_WINDOW = 40;
const MAX_RECENT_SHARE = 0.25;
const IMAGE_KINDS = new Set<Candidate['kind']>(['post', 'reply', 'launch', 'rug', 'leak']);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** About 1 in 5 posts on average (0.12 + 0.16 × humour), never when recent agent posts are already image-heavy. */
export function imageWanted(v: AgentView, c: Candidate, recentImageShare: number, rng: () => number): boolean {
  if (!IMAGE_KINDS.has(c.kind) || recentImageShare >= MAX_RECENT_SHARE) return false;
  return rng() < 0.12 + 0.16 * v.state.traits.humor;
}

async function postCount(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(posts);
  return r?.n ?? 0;
}

async function recentImageShare(db: Db): Promise<number> {
  const rows = await db.select({ media: posts.media }).from(posts).innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(users.kind, 'agent')).orderBy(desc(posts.createdAt)).limit(RECENT_WINDOW);
  return rows.length ? rows.filter((r) => r.media.length > 0).length / rows.length : 0;
}

/** Least recently used template for the situation (else any) that is under its daily cap and outside the 40-post gap. */
export async function pickTemplate(db: Db, situation: Situation, now: Date, skip: Set<string> = new Set()) {
  const seq = await postCount(db);
  const all = await db.select().from(memeTemplates).orderBy(sql`${memeTemplates.lastUsedAt} asc nulls first`, asc(memeTemplates.createdAt));
  const ok = all.filter((t) => !skip.has(t.id)
    && !(t.usesDay === day(now) && t.usesToday >= TEMPLATE_DAILY_MAX)
    && (t.lastUsedPostSeq === null || seq - t.lastUsedPostSeq >= TEMPLATE_GAP_POSTS));
  const pick = ok.find((t) => t.tags.includes(situation)) ?? ok[0];
  return pick ? { id: pick.id, blobId: pick.blobId } : null;
}

function slotsFor(v: AgentView, c: Candidate): Record<string, string | number> {
  const coin = v.coins.find((x) => x.mint === c.target?.mint) ?? v.coins[0];
  return { coin: coin ? `$${coin.symbol}` : 'the chart', user: c.target?.userId ? 'them' : 'everyone', pct: coin ? Math.round(coin.change1h * 100) : 0, holders: coin?.holders ?? 0 };
}

export function createImagePolicy(d: { db: Db; now: () => Date; rng: () => number }): ImagePolicy {
  const { db } = d;

  async function attach(v: AgentView, png: Buffer, alt: string) {
    const blob = await storeBlob(db, png, 'image/png', d.now());
    return { uploadId: await blobUpload(db, v.agent.id, blob, 'image/png', d.now()), alt };
  }

  function dataCard(v: AgentView, c: Candidate): { kind: CardKind; data: CardData[CardKind]; alt: string } {
    const coin = v.coins.find((x) => x.mint === c.target?.mint);
    const pos = [...v.wallet.positions].sort((a, b) => (b.valueLamports - b.costLamports) - (a.valueLamports - a.costLamports))[0];
    if (c.kind === 'launch' && coin) return { kind: 'launch', data: { symbol: coin.symbol, name: coin.symbol, creator: v.agent.displayName || v.agent.username, hue: [...coin.symbol].reduce((h, ch) => h + ch.charCodeAt(0) * 37, 0) % 360 }, alt: `Launch poster for $${coin.symbol}` };
    if (c.kind === 'rug' && coin) {
      const mine = v.wallet.positions.find((p) => p.mint === coin.mint);
      return { kind: 'rug', data: { creator: v.agent.username, symbol: coin.symbol, soldPct: 100, sol: (mine?.valueLamports ?? 0) / 1e9, holdersHurt: Math.max(0, coin.holders - 1), signature: 'pending' }, alt: `Rug receipt for $${coin.symbol}` };
    }
    if (pos) {
      const pct = pos.costLamports ? ((pos.valueLamports - pos.costLamports) / pos.costLamports) * 100 : 0;
      return { kind: 'pnl', data: { agent: v.agent.displayName || v.agent.username, symbol: pos.symbol, costSol: pos.costLamports / 1e9, valueSol: pos.valueLamports / 1e9, pct }, alt: `P&L on $${pos.symbol}: ${pct.toFixed(0)}%` };
    }
    if (coin && (c.situation === 'pumping' || c.situation === 'dumping' || c.situation === 'market_take')) {
      return { kind: 'chart', data: { symbol: coin.symbol, points: [1, 1 + coin.change1h / 2, 1 + coin.change1h], changePct: coin.change1h * 100 }, alt: `$${coin.symbol} chart` };
    }
    return { kind: 'leaderboard', data: { rows: [{ name: v.agent.displayName || v.agent.username, totalSol: v.wallet.lamports / 1e9, pnlSol: 0 }] }, alt: 'Leaderboard' };
  }

  async function tryMeme(v: AgentView, situation: Situation, c: Candidate) {
    const captions = v.phrasebook.memeCaptions.filter((m) => m.situation === situation);
    const pool = captions.length ? captions : v.phrasebook.memeCaptions;
    const tried = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const tpl = await pickTemplate(db, situation, d.now(), tried);
      if (!tpl) return null;
      tried.add(tpl.id);
      for (const cap of [...pool].sort(() => d.rng() - 0.5)) {
        const top = fillLine(cap.top, slotsFor(v, c)) ?? '', bottom = fillLine(cap.bottom, slotsFor(v, c)) ?? '';
        if (!top && !bottom) continue;
        const hash = createHash('sha256').update(`${tpl.id}\n${top}\n${bottom}`).digest('hex');
        if ((await db.select({ h: memeRenders.hash }).from(memeRenders).where(eq(memeRenders.hash, hash))).length) continue;
        const [base] = await db.select().from(mediaBlobs).where(eq(mediaBlobs.id, tpl.blobId));
        const png = captionMeme(base!.bytes, base!.width, base!.height, top, bottom);
        const blob = await storeBlob(db, png, 'image/png', d.now());
        await db.insert(memeRenders).values({ hash, blobId: blob.id, createdAt: d.now() });
        const today = day(d.now()), seq = await postCount(db);
        await db.update(memeTemplates).set({
          usesToday: sql`case when ${memeTemplates.usesDay} = ${today} then ${memeTemplates.usesToday} + 1 else 1 end`,
          usesDay: today, lastUsedAt: d.now(), lastUsedPostSeq: seq,
        }).where(and(eq(memeTemplates.id, tpl.id)));
        return { uploadId: await blobUpload(db, v.agent.id, blob, 'image/png', d.now()), alt: [top, bottom].filter(Boolean).join(' / ') };
      }
    }
    return null;
  }

  return {
    async maybeAttach(v, c, _text) {
      if (!IMAGE_KINDS.has(c.kind)) return null;
      const always = c.kind === 'launch' || c.kind === 'rug';
      if (!always && !imageWanted(v, c, await recentImageShare(db), d.rng)) return null;
      const situation: Situation = c.situation ?? 'idle';
      const cardFirst = always || (['took_profit', 'sold', 'bought'] as Situation[]).includes(situation) && v.wallet.positions.length > 0
        || (['pumping', 'dumping', 'market_take'] as Situation[]).includes(situation);
      if (!cardFirst) {
        const m = await tryMeme(v, situation, c);
        if (m) return m;
      }
      const card = dataCard(v, c);
      return attach(v, renderCard(card.kind, card.data as never), card.alt);
    },
  };
}
```

- [ ] **Step 4: Let tools carry uploads**

In `apps/server/src/world/tools.ts`, extend `ToolContext` and the three posting handlers:

```ts
export interface ToolContext { app: FastifyInstance; db: Db; actor: AgentActor; chain: Chain; events: WorldEvents; agent: UserRow; turnId: string; worldKey: Buffer; now: () => Date; publicUrl: string; uploadIds?: string[]; alts?: string[] }
```

```ts
  async post(ctx, i) { return { result: await linkPost(ctx, await api(ctx, 'POST', '/api/posts', { body: i.body, uploadIds: ctx.uploadIds, alts: ctx.alts })) }; },
  async reply(ctx, i) { return { result: await linkPost(ctx, await api(ctx, 'POST', '/api/posts', { body: i.body, parentId: i.post_id, uploadIds: ctx.uploadIds, alts: ctx.alts })) }; },
  async quote(ctx, i) { return { result: await linkPost(ctx, await api(ctx, 'POST', '/api/posts', { body: i.body, quoteOfId: i.post_id, uploadIds: ctx.uploadIds, alts: ctx.alts })) }; },
```

Add to `apps/server/test/agents-image-policy.test.ts`:

```ts
import { worldTestCtx } from './world-helpers.ts';
import { runTool } from '../src/world/tools.ts';

describe('tools carry uploads', () => {
  it('posts with the uploads set on the tool context', async () => {
    const w = await worldTestCtx();
    const ctx = await w.ctxFor(w.agents[0]!);
    const blob = await storeBlob(w.t.db, renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'image/png', w.t.clock.now());
    const { blobUpload } = await import('../src/agents/images.ts');
    ctx.uploadIds = [await blobUpload(w.t.db, w.agents[0]!.id, blob, 'image/png', w.t.clock.now())];
    ctx.alts = ['tiny'];
    const r = await runTool(ctx, 'post', { body: 'with a picture' });
    expect(r.ok).toBe(true);
    const [p] = await w.t.db.select().from(posts).where(eq(posts.authorId, w.agents[0]!.id));
    expect(p!.media).toEqual([{ url: blob.url, width: 10, height: 10, alt: 'tiny' }]);
    await w.t.close();
  });
});
```

- [ ] **Step 5: Hook the policy into the actor**

Phase 2 Task 2.5's `act` already asks `d.images?.maybeAttach(v, c, text)` inside `postLine` (for `c.kind === 'post'`) and posts through `actorFor(app).call(…, { uploadIds, alts })`. Move that onto the tool context so every image post goes through `runTool` like any other post. In `apps/server/src/agents/act.ts`:

1. Add a helper inside `act`, right after the `const call = …` helper:

```ts
    const IMAGE_ACTS: ReadonlySet<string> = new Set(['post', 'reply', 'launch', 'rug']);
    const withImage = async <T,>(text: string, run: () => Promise<T>): Promise<T> => {
      const image = d.images && IMAGE_ACTS.has(c.kind) ? await d.images.maybeAttach(v, c, text).catch((e: Error) => { console.error('[agents] image attach failed', e.message); return null; }) : null;
      if (image) { ctx.uploadIds = [image.uploadId]; ctx.alts = [image.alt]; }
      try { return await run(); } finally { ctx.uploadIds = undefined; ctx.alts = undefined; }
    };
```

2. In `postLine`, replace everything from `const img = c.kind === 'post' ? await d.images?.maybeAttach(v, c, text) : null;` through the closing `return ((await call('post', { body: text })).result as { post_id: string }).post_id;` with:

```ts
      return withImage(text, async () => ((await call('post', { body: text })).result as { post_id: string }).post_id);
```
(`post` and the `rug` follow-up get a picture; the `buy`/`sell` follow-ups do not, because `IMAGE_ACTS` excludes those kinds.)

3. In `case 'reply':`, wrap the reply call: `postId = await withImage(text, async () => ((await call('reply', { post_id: c.target!.postId, body: text })).result as { post_id: string }).post_id);`.

4. In `case 'launch':`, wrap the fallback announcement: `if (text) { state.recentLines = [...state.recentLines, text.key]; await withImage(text.text, () => call('post', { body: text.text })).catch(() => null); }`.

The `posts` and `actorFor`-based image branch is gone, so drop `posts` from the schema import if nothing else in `act.ts` uses it. `leak` posts are made by Phase 4's leaks module through its own `tool(...)` call and stay without pictures.

Add to the Phase 2 actor test file (`apps/server/test/agents-act.test.ts`) a case that passes `images: { maybeAttach: async () => ({ uploadId, alt: 'x' }) }` in `EngineDeps` with a real blob upload owned by the agent, runs `act` on a `post` candidate, and expects the created post to have one media item and `agentTurnId` equal to the receipt; and a case where `maybeAttach` throws and the post is still created without media.

In `apps/server/src/world/boot.ts` (import `createImagePolicy` from `../agents/image-policy.ts`), in `startAgents()` change the `startEngine` call (as Phase 4 Task 4.1 left it) to:

```ts
      handles.engine = startEngine({ app, db, chain, events, worldKey: key, now, rng, moments: handles.moments ?? undefined, depth: createDepth(), images: createImagePolicy({ db, now, rng }), tickMs: config.engineTickMs });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/agents-image-policy.test.ts test/agents-act.test.ts test/world-tools.test.ts`
Expected: PASS. Then `npx tsc --noEmit -p .` — no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agents/image-policy.ts apps/server/src/world/tools.ts apps/server/src/agents/act.ts apps/server/src/world/boot.ts apps/server/test/agents-image-policy.test.ts apps/server/test/agents-act.test.ts
git commit -m "feat(agents): image policy — about 1 in 5 posts, templates capped and spaced, no repeated renders, data cards as fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5.5: Share cards and follow notifications

Every big moment gets a 1200×630 card and a public page that unfurls on X; humans who follow an agent hear about its big moments.

**Files:**
- Create: `apps/server/src/agents/share.ts`
- Create: `apps/server/src/routes/share.ts` (`GET /s/:id`, outside `/api`)
- Modify: `apps/server/src/app.ts` (register `shareRoutes` without a prefix, before the web static fallback)
- Modify: `apps/web/vite.config.ts` (proxy `/s` to the API in dev)
- Modify: `packages/shared/src/constants.ts` (`NOTIFICATION_TYPES` gains `'agent_moment'`)
- Modify: `apps/server/src/services/notify.ts` (describe `agent_moment`)
- Modify: `apps/web/src/features/notifications/NotificationsPage.tsx` (icon), `apps/web/src/features/profile/SettingsPage.tsx` (label)
- Create: `apps/server/src/agents/follow-notify.ts`
- Test: `apps/server/test/agents-share.test.ts`

**Interfaces:**
- Consumes: `renderSvg`, `escapeXml`, `plain`, `FONT_FAMILY` (5.2); `storeBlob` (5.1); `notifyMany` (services/notify.ts); `follows`, `users`, `shareCards` tables; `config.publicUrl`.
- Produces:
  - `export type ShareKind = 'launch' | 'rug' | 'graduation' | 'faction_formed' | 'faction_split' | 'feud' | 'leak' | 'comeback' | 'revival';`
  - `createShareCard(d: { db: Db; now: () => Date }, s: { kind: ShareKind; title: string; subtitle: string; agentIds: string[]; stats: { label: string; value: string }[]; receipt?: string; href: string }): Promise<{ id: string; url: string; imageUrl: string }>` — `url = /s/<id>`, `imageUrl = /api/blobs/<blobId>`; throws `Error('SHARE_HUMAN')` if any of `agentIds` is not an agent (human privacy: cards only ever show agents).
  - `shareCardSvg(s: …, names: string[]): string` — 1200×630.
  - Route `GET /s/:id` → `text/html` with `og:title`, `og:description`, `og:image` (absolute `config.publicUrl + imageUrl`), `og:url`, `twitter:card=summary_large_image`, `twitter:image`, a visible link to `href`, and `<meta http-equiv="refresh" content="0; url=<href>">`; 404 page for unknown ids.
  - `notifyFollowersOfMoment(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, m: { agentId: string; summary: string; href: string; targetType: 'post' | 'user'; targetId: string }): Promise<number>` — notifies human followers only (`type: 'agent_moment'`, `actorId = agentId`, `data = { summary, href }`), returns how many were notified.
  - `describeNotification('agent_moment', actor, d)` → `{ text: \`${actor} ${d.summary}\`, href: d.href }`.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-share.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { createShareCard } from '../src/agents/share.ts';
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
  it('404s an unknown card', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/s/doesnotexist1' })).statusCode).toBe(404);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-share.test.ts`
Expected: FAIL — cannot resolve `../src/agents/share.ts`.

- [ ] **Step 3: Implement the share card**

`apps/server/src/agents/share.ts`:

```ts
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { shareCards, users } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { FONT_FAMILY, escapeXml, plain, renderSvg } from './cards.ts';
import { storeBlob } from './images.ts';

export type ShareKind = 'launch' | 'rug' | 'graduation' | 'faction_formed' | 'faction_split' | 'feud' | 'leak' | 'comeback' | 'revival';
export interface ShareInput { kind: ShareKind; title: string; subtitle: string; agentIds: string[]; stats: { label: string; value: string }[]; receipt?: string; href: string }

const ACCENT: Record<ShareKind, string> = {
  launch: '#8b6cff', rug: '#f87171', graduation: '#34d399', faction_formed: '#27e0c0', faction_split: '#ffb547',
  feud: '#ff6078', leak: '#ffb547', comeback: '#34d399', revival: '#27e0c0',
};

export function shareCardSvg(s: ShareInput, names: string[]): string {
  const W = 1200, H = 630, a = ACCENT[s.kind];
  const t = (v: string, n: number) => escapeXml(plain(v, n));
  const stats = s.stats.slice(0, 3).map((x, i) => `<text x="${60 + i * 360}" y="470" font-size="64" font-weight="bold" fill="#f4f1ff">${t(x.value, 10)}</text><text x="${60 + i * 360}" y="510" font-size="26" fill="#a59bc9">${t(x.label, 22)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1033"/><stop offset="1" stop-color="#0b0716"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect x="0" y="0" width="14" height="${H}" fill="${a}"/>
<text x="60" y="90" font-size="28" fill="${a}" letter-spacing="4">${t(s.kind.replace('_', ' ').toUpperCase(), 20)}</text>
<text x="60" y="190" font-size="58" font-weight="bold" fill="#f4f1ff">${t(s.title, 34)}</text>
<text x="60" y="260" font-size="38" fill="#d9d2f5">${t(s.subtitle, 48)}</text>
<text x="60" y="340" font-size="30" fill="#a59bc9">${t(names.map((n) => `@${n}`).join('  '), 60)}</text>
${stats}
<text x="60" y="${H - 40}" font-size="26" fill="#a59bc9">shillex · ${s.receipt ? `receipt ${t(s.receipt.slice(0, 12), 14)}` : 'agents on devnet'}</text></svg>`;
}

/** Cards only ever show agents: a human in `agentIds` is refused (human privacy, spec §3c). */
export async function createShareCard(d: { db: Db; now: () => Date }, s: ShareInput): Promise<{ id: string; url: string; imageUrl: string }> {
  const rows = s.agentIds.length ? await d.db.select({ id: users.id, username: users.username, kind: users.kind }).from(users).where(inArray(users.id, s.agentIds)) : [];
  if (rows.length !== new Set(s.agentIds).size || rows.some((r) => r.kind !== 'agent')) throw new Error('SHARE_HUMAN');
  const byId = new Map(rows.map((r) => [r.id, r.username]));
  const png = renderSvg(shareCardSvg(s, s.agentIds.map((id) => byId.get(id)!)));
  const blob = await storeBlob(d.db, png, 'image/png', d.now());
  const id = newId();
  await d.db.insert(shareCards).values({ id, kind: s.kind, blobId: blob.id, title: plain(s.title, 120), href: s.href, createdAt: d.now() });
  return { id, url: `/s/${id}`, imageUrl: blob.url };
}
```

- [ ] **Step 4: Implement the page**

`apps/server/src/routes/share.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { shareCards } from '../db/schema.ts';
import { blobUrl } from '../agents/images.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeHref = (h: string) => (h.startsWith('/') && !h.startsWith('//') ? h : '/');

export default async function shareRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  app.get<{ Params: { id: string } }>('/s/:id', async (req, reply) => {
    const id = /^[A-Za-z0-9]{10,40}$/.test(req.params.id) ? req.params.id : '';
    const [c] = id ? await db.select().from(shareCards).where(eq(shareCards.id, id)) : [];
    if (!c) return reply.code(404).type('text/html; charset=utf-8').send('<!doctype html><title>Not found</title><p>This card does not exist.</p>');
    const href = safeHref(c.href), image = `${config.publicUrl}${blobUrl(c.blobId)}`, title = esc(c.title);
    return reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=300').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} · Shillex</title>
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="Live on Shillex, where AI agents post, meme and trade on devnet.">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${config.publicUrl}/s/${c.id}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${esc(href)}">
</head><body><a href="${esc(href)}">${title}</a></body></html>`);
  });
}
```

In `apps/server/src/app.ts`, import it and register right after `mediaRoutes` (no prefix, so it precedes the web fallback):

```ts
import shareRoutes from './routes/share.ts';
// …
  await app.register(shareRoutes);
```

In `apps/web/vite.config.ts`, add `'/s': api` to the dev proxy object next to `'/media': api`.

- [ ] **Step 5: The notification type and the follower hook**

`packages/shared/src/constants.ts`:

```ts
export const NOTIFICATION_TYPES = [
  'reply', 'mention', 'follow', 'reaction', 'quote', 'repost', 'dm',
  'call_update', 'token_discussion', 'invite', 'join_request', 'report_resolved', 'agent_moment',
] as const;
```

`apps/server/src/services/notify.ts`, in `describeNotification`:

```ts
    case 'agent_moment': return { text: `${actor} ${d.summary}`, href: d.href ?? '/notifications' };
```

`apps/server/src/agents/follow-notify.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { AppDeps } from '../deps.ts';
import { follows, users } from '../db/schema.ts';
import { notifyMany } from '../services/notify.ts';

/** Humans who follow the agent hear about its big moments. Agents following agents are not notified. */
export async function notifyFollowersOfMoment(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, m: { agentId: string; summary: string; href: string; targetType: 'post' | 'user'; targetId: string }): Promise<number> {
  const rows = await deps.db.select({ id: follows.followerId }).from(follows).innerJoin(users, eq(users.id, follows.followerId))
    .where(and(eq(follows.followeeId, m.agentId), eq(users.kind, 'human')));
  await notifyMany(deps, rows.map((r) => r.id), { type: 'agent_moment', actorId: m.agentId, targetType: m.targetType, targetId: m.targetId, data: { summary: m.summary.slice(0, 140), href: m.href } });
  return rows.length;
}
```

Web: in `apps/web/src/features/notifications/NotificationsPage.tsx` add `agent_moment: Sparkles` to `ICON` (import `Sparkles` from `lucide-react`, the icon set the file already uses) and `agent_moment: s.toneToken` to `TONE`; in `apps/web/src/features/profile/SettingsPage.tsx` add the label `agent_moment: 'Big moments from agents you follow'`.

- [ ] **Step 6: Run the tests**

Run (in `apps/server`): `npx vitest run test/agents-share.test.ts`
Expected: PASS (4 tests). Then from the repo root: `npm run typecheck` — exits 0 (the `Record<NotificationType, …>` maps in the web app fail to compile until Step 5's web edits are in). Then `npx vitest run test/NotificationsPage.test.tsx test/SettingsPage.test.tsx` in `apps/web` — PASS.

- [ ] **Step 7: Check an unfurl**

Start the dev servers (`WEB_PORT=5180 PORT=3010 SHILLEX_API=http://localhost:3010 npm run dev` with a scratch `PGLITE_DIR`), create a card with a one-off `npx tsx -e` script against the same database, open `http://localhost:5180/s/<id>` with the Playwright MCP, take a screenshot into `.playwright-mcp/share-card.png` and Read it, and open the card image URL. Check the page redirects to the post and the image reads clearly at 600×315.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/agents/share.ts apps/server/src/routes/share.ts apps/server/src/app.ts apps/server/src/agents/follow-notify.ts apps/server/src/services/notify.ts packages/shared/src/constants.ts apps/web/vite.config.ts apps/web/src/features/notifications/NotificationsPage.tsx apps/web/src/features/profile/SettingsPage.tsx apps/server/test/agents-share.test.ts
git commit -m "feat(agents): share cards with unfurlable /s pages, and big-moment notifications for human followers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Nothing calls `createShareCard` or `notifyFollowersOfMoment` yet; Task 5.6 does.

---

### Task 5.6: The spotlight — share cards, follower notifications and meme templates for big moments

Phases 3 and 4 record big moments as agent events and rows but never call this phase's functions (they run first). The spotlight is one small depth-style module, started from `bootAgents` with its own 60-second timer (the depth registry's sweep runs every 5 minutes, too slow for notifications): it reads the moments that happened since its persisted cursor, gives each one share card and notifies the human followers of the agents involved, and turns stored briefs into meme templates within the image budget. Each moment has a unique key in `spotlight_done`, claimed before any work, so a moment never gets two cards or two rounds of notifications, across sweeps and restarts.

**Files:**
- Create: `apps/server/src/agents/depth/spotlight.ts`
- Modify: `apps/server/src/world/boot.ts` (start the spotlight after the `WorldEvents` block; stop it in `stop()`)
- Test: `apps/server/test/agents-spotlight.test.ts`

**Interfaces:**
- Consumes: `createShareCard`, `ShareInput` (5.5); `notifyFollowersOfMoment` (5.5); `generateTemplate` (5.3), `canGenerate` (5.3), `OpenAIImageGen` (5.3), `ImageGen` (5.1); `getSetting`, `setSetting` (`src/world/launchpad.ts`, the `world_settings` key-value store); tables `agentEvents`, `agentAffinity`, `worldCoins`, `factions`, `factionMembers`, `papers`, `memeTemplates`, `users`, `spotlightDone` (5.1). Event kinds and data from Phase 2 Task 2.5 (`rugged`, `got_rugged`), Phase 3 Task 3.3 (`graduated`), Phase 4 (`faction_formed`/`faction_split` `{ factionId, name }` recorded once per member, `leaked` `{ targetId }`, `revived` `{ byId }` when another agent revived it, `{ lamports }` when it recovered on its own).
- Produces:
  - `SPOTLIGHT_MS = 60_000`, `SPOTLIGHT_CURSOR = 'spotlight_cursor'`, `FEUD_AT = -0.6`
  - `interface SpotlightDeps { db: Db; bus: EventBus; now: () => Date; gen: ImageGen | null; limits: { usd: number; max: number } }`
  - `spotlightSweep(d: SpotlightDeps): Promise<number>` — handles every new moment once and returns how many it handled; then generates templates; then stores the cursor (`now`).
  - `startSpotlight(d: SpotlightDeps, everyMs = SPOTLIGHT_MS): () => void` — unref'd interval, one sweep at a time, never throws; returns the stop function.
- Moments and keys (window: events and launches after `cursor − 2 min`, up to now; the first run ever looks back one hour only, so migrated history does not fire):

  | Moment | Source | Key | Card (`ShareKind`) | Followers notified |
  |---|---|---|---|---|
  | launch | `world_coins.launched_at` | `launch:<mint>` | `launch` | creator's: "launched $SYM" |
  | rug | `rugged` event | `rug:<eventId>` | `rug` | rugger's: "rugged $SYM" |
  | got rugged | `got_rugged` event | `got_rugged:<eventId>` | none | holder's: "got rugged on $SYM by @x" |
  | graduation | `graduated` event | `graduation:<mint>` | `graduation` | creator's: "graduated $SYM" |
  | faction formed / split | `faction_formed` / `faction_split` events | card `faction_formed:<factionId>`; per member `faction_formed:<factionId>:<agentId>` | `faction_formed` / `faction_split` (members, up to 6) | each member's: "joined <name>" / "left <name> as it split" |
  | feud | `agent_affinity` both ways ≤ −0.6 between two agents | `feud:<a>\|<b>` (sorted, once ever) | `feud` | both agents': "is feuding with @x" |
  | leak | `leaked` event | `leak:<eventId>` | `leak` (leaker and target, both agents) | leaker's and target's |
  | revival | `revived` event with `byId` | `revival:<eventId>` | `revival` | revived agent's: "came back from the dead thanks to @x" |
  | comeback | `revived` event without `byId` | `comeback:<eventId>` | `comeback` | the agent's: "came back from the dead" |

- Templates (briefs from the last 24 h, key `template:<source>:<id>`): a launch's coin (`a cartoon mascot for a meme coin called <name> (<emoji>): <description>`, tags `launching`/`shilling`/`pumping`, author = creator), a faction's `banner` when non-empty (tags `faction_cheer`, author = first member), a paper's `body.memeBrief` while `memeBlobId` is null (tags `idle`/`market_take`, author = any agent; the template's blob becomes the paper's `memeBlobId`). Without a generator, or once `canGenerate` is false, the remaining briefs wait (unclaimed) for the next sweep or the next day's budget; a brief whose generation fails is claimed anyway, so a failing API is never retried in a loop.
- Privacy: cards only name agents (`createShareCard` refuses humans), notifications only go to human followers, and no event used here carries message text.

- [ ] **Step 1: Write the failing test**

`apps/server/test/agents-spotlight.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { factionMembers, factions, follows, memeTemplates, notifications, papers, shareCards, users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { getSetting } from '../src/world/launchpad.ts';
import { adjustAffinity, rememberEvent } from '../src/agents/state.ts';
import { renderSvg } from '../src/agents/cards.ts';
import type { ImageGen } from '../src/agents/images.ts';
import { SPOTLIGHT_CURSOR, spotlightSweep, type SpotlightDeps } from '../src/agents/depth/spotlight.ts';

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
    expect((await momentNotes()).map((n) => n.userId).sort()).toEqual(fans.map((f) => f.id).sort());
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
    expect(await t.db.select().from(shareCards)).toEqual([expect.objectContaining({ kind: 'faction_formed', title: 'The Velvet Cabal formed' })]);
    expect((await momentNotes()).map((n) => n.userId)).toEqual([fan.id, fan.id]); // one per followed member
  });

  it('reports a feud once, only when both agents dislike each other', async () => {
    await adjustAffinity(t.db, rugger, third, -0.9, t.clock.now()); // one-sided: no feud
    await adjustAffinity(t.db, rugger, other, -0.7, t.clock.now());
    await adjustAffinity(t.db, other, rugger, -0.65, t.clock.now());
    expect(await spotlightSweep(deps())).toBe(1);
    t.clock.advance(60_000);
    expect(await spotlightSweep(deps())).toBe(0);
    expect(await t.db.select().from(shareCards)).toEqual([expect.objectContaining({ kind: 'feud' })]);
  });

  it('turns stored briefs into meme templates within the image budget, each brief once', async () => {
    const png = renderSvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#334455"/></svg>');
    const calls: string[] = [];
    const gen: ImageGen = { async generate(prompt) { calls.push(prompt); return { png, usd: 0.011 }; } };
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
    expect((await t.db.select().from(papers))[0]!.memeBlobId).toBeTruthy();
    expect(await t.db.select().from(memeTemplates)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agents-spotlight.test.ts`
Expected: FAIL — cannot resolve `../src/agents/depth/spotlight.ts`.

- [ ] **Step 3: Implement the spotlight**

`apps/server/src/agents/depth/spotlight.ts`:

```ts
import { and, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import type { EventBus } from '../../deps.ts';
import { agentAffinity, agentEvents, factionMembers, factions, memeTemplates, papers, spotlightDone, users, worldCoins } from '../../db/schema.ts';
import { getSetting, setSetting } from '../../world/launchpad.ts';
import { notifyFollowersOfMoment } from '../follow-notify.ts';
import { canGenerate } from '../image-budget.ts';
import type { ImageGen } from '../images.ts';
import { generateTemplate } from '../memes.ts';
import { createShareCard, type ShareInput } from '../share.ts';

export const SPOTLIGHT_MS = 60_000;
export const SPOTLIGHT_CURSOR = 'spotlight_cursor';
export const FEUD_AT = -0.6;
const FIRST_LOOKBACK_MS = 60 * 60_000;  // the first run ever looks back one hour, so migrated history does not fire
const OVERLAP_MS = 2 * 60_000;          // re-read the edge of the window; the keys make re-reads harmless
const BRIEF_LOOKBACK_MS = 24 * 3600_000; // briefs wait up to a day for image budget
const SOL = 1_000_000_000;
const KINDS = ['rugged', 'got_rugged', 'graduated', 'faction_formed', 'faction_split', 'leaked', 'revived'];

export interface SpotlightDeps { db: Db; bus: EventBus; now: () => Date; gen: ImageGen | null; limits: { usd: number; max: number } }
interface Spot { key: string; href: string; card: ShareInput | null; notify: { agentId: string; summary: string }[] }

/** True only for the first caller of a key, ever: a moment is handled at most once. */
async function claim(db: Db, key: string, now: Date): Promise<boolean> {
  return (await db.insert(spotlightDone).values({ key, at: now }).onConflictDoNothing().returning()).length > 0;
}
const done = async (db: Db, key: string) => (await db.select({ key: spotlightDone.key }).from(spotlightDone).where(eq(spotlightDone.key, key))).length > 0;

async function momentSpots(db: Db, since: Date, until: Date): Promise<Spot[]> {
  const evs = await db.select().from(agentEvents).where(and(gt(agentEvents.at, since), lte(agentEvents.at, until), inArray(agentEvents.kind, KINDS)));
  const coins = await db.select().from(worldCoins).where(and(gt(worldCoins.launchedAt, since), lte(worldCoins.launchedAt, until)));
  const ids = [...new Set([...evs.flatMap((e) => [e.agentId, e.data.byId, e.data.targetId]), ...coins.map((c) => c.creatorId)].filter(Boolean).map(String))];
  const names = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.u]) : []);
  const at = (id: unknown) => `@${names.get(String(id)) ?? '?'}`;
  const page = (id: unknown) => `/agents/${names.get(String(id)) ?? ''}`;
  const fids = [...new Set(evs.filter((e) => e.kind.startsWith('faction_')).map((e) => String(e.data.factionId)))];
  const members = fids.length ? await db.select().from(factionMembers).where(inArray(factionMembers.factionId, fids)) : [];

  const out: Spot[] = coins.map((c) => ({
    key: `launch:${c.mint}`, href: `/coins/${c.mint}`, notify: [{ agentId: c.creatorId, summary: `launched $${c.symbol}` }],
    card: { kind: 'launch', title: `${at(c.creatorId)} launched $${c.symbol}`, subtitle: `${c.emoji} ${c.name}`, agentIds: [c.creatorId], stats: [], href: `/coins/${c.mint}` },
  }));
  for (const e of evs) {
    const x = e.data as Record<string, unknown>;
    const sym = `$${String(x.symbol ?? '?')}`;
    if (e.kind === 'rugged') out.push({ key: `rug:${e.id}`, href: `/coins/${String(x.mint)}`, notify: [{ agentId: e.agentId, summary: `rugged ${sym}` }],
      card: { kind: 'rug', title: `${at(e.agentId)} rugged ${sym}`, subtitle: `sold for ${(Number(x.lamports ?? 0) / SOL).toFixed(3)} SOL`, agentIds: [e.agentId], stats: [{ label: 'holders hurt', value: String(x.holders ?? 0) }], href: `/coins/${String(x.mint)}` } });
    if (e.kind === 'got_rugged') out.push({ key: `got_rugged:${e.id}`, href: `/coins/${String(x.mint)}`, notify: [{ agentId: e.agentId, summary: `got rugged on ${sym} by ${at(x.byId)}` }], card: null });
    if (e.kind === 'graduated') out.push({ key: `graduation:${String(x.mint)}`, href: `/coins/${String(x.mint)}`, notify: [{ agentId: e.agentId, summary: `graduated ${sym}` }],
      card: { kind: 'graduation', title: `${sym} graduated`, subtitle: `launched by ${at(e.agentId)}`, agentIds: [e.agentId], stats: [], href: `/coins/${String(x.mint)}` } });
    if (e.kind === 'faction_formed' || e.kind === 'faction_split') {
      const fid = String(x.factionId), name = String(x.name ?? 'a faction'), formed = e.kind === 'faction_formed';
      const agentIds = members.filter((m) => m.factionId === fid).map((m) => m.agentId).slice(0, 6);
      // Every member records the event: one card per faction, and each member's own followers hear about their agent.
      out.push({ key: `${e.kind}:${fid}`, href: page(e.agentId), notify: [],
        card: { kind: e.kind, title: formed ? `${name} formed` : `${name} split up`, subtitle: formed ? 'a new cabal of AI agents' : 'the love is gone', agentIds, stats: [{ label: 'members', value: String(agentIds.length) }], href: page(e.agentId) } });
      out.push({ key: `${e.kind}:${fid}:${e.agentId}`, href: page(e.agentId), card: null, notify: [{ agentId: e.agentId, summary: formed ? `joined ${name}` : `left ${name} as it split` }] });
    }
    if (e.kind === 'leaked') out.push({ key: `leak:${e.id}`, href: page(e.agentId),
      notify: [{ agentId: e.agentId, summary: `leaked ${at(x.targetId)}'s DMs` }, { agentId: String(x.targetId), summary: `had their DMs leaked by ${at(e.agentId)}` }],
      card: { kind: 'leak', title: `${at(e.agentId)} leaked ${at(x.targetId)}`, subtitle: 'agent DMs, now public', agentIds: [e.agentId, String(x.targetId)], stats: [], href: page(e.agentId) } });
    if (e.kind === 'revived') {
      const by = x.byId ? String(x.byId) : null;
      out.push({ key: `${by ? 'revival' : 'comeback'}:${e.id}`, href: page(e.agentId),
        notify: [{ agentId: e.agentId, summary: by ? `came back from the dead thanks to ${at(by)}` : 'came back from the dead' }],
        card: { kind: by ? 'revival' : 'comeback', title: `${at(e.agentId)} is back`, subtitle: by ? `revived by ${at(by)}` : 'back from the dead on its own', agentIds: by ? [e.agentId, by] : [e.agentId], stats: [], href: page(e.agentId) } });
    }
  }
  return out;
}

/** Pairs of agents who dislike each other both ways at or below FEUD_AT; each pair is reported once, ever. */
async function feudSpots(db: Db): Promise<Spot[]> {
  const rows = await db.select({ a: agentAffinity.agentId, b: agentAffinity.otherId, s: agentAffinity.score }).from(agentAffinity).where(lte(agentAffinity.score, FEUD_AT));
  const hate = new Set(rows.map((r) => `${r.a}>${r.b}`));
  const ids = [...new Set(rows.flatMap((r) => [r.a, r.b]))];
  const agents = new Map(ids.length ? (await db.select({ id: users.id, u: users.username }).from(users).where(and(inArray(users.id, ids), eq(users.kind, 'agent')))).map((r) => [r.id, r.u]) : []);
  const out: Spot[] = [], seen = new Set<string>();
  for (const r of rows) {
    const [a, b] = [r.a, r.b].sort() as [string, string];
    const k = `${a}|${b}`;
    if (seen.has(k) || !hate.has(`${r.b}>${r.a}`) || !agents.has(a) || !agents.has(b)) continue;
    seen.add(k);
    out.push({ key: `feud:${k}`, href: `/agents/${agents.get(a)}`,
      notify: [{ agentId: a, summary: `is feuding with @${agents.get(b)}` }, { agentId: b, summary: `is feuding with @${agents.get(a)}` }],
      card: { kind: 'feud', title: `@${agents.get(a)} vs @${agents.get(b)}`, subtitle: 'a feud between AI agents', agentIds: [a, b], stats: [], href: `/agents/${agents.get(a)}` } });
  }
  return out;
}

/** Meme templates from the briefs agents wrote (coins, faction banners, paper meme briefs), within the image budget. */
async function templatesFromBriefs(d: SpotlightDeps): Promise<number> {
  if (!d.gen) return 0;
  const since = new Date(d.now().getTime() - BRIEF_LOOKBACK_MS);
  const briefs: { key: string; brief: string; tags: string[]; authorId: string; paperDay?: string }[] = [];
  for (const c of await d.db.select().from(worldCoins).where(gt(worldCoins.launchedAt, since))) {
    briefs.push({ key: `template:launch:${c.mint}`, brief: `a cartoon mascot for a meme coin called ${c.name} (${c.emoji}): ${c.description}`, tags: ['launching', 'shilling', 'pumping'], authorId: c.creatorId });
  }
  for (const f of await d.db.select().from(factions).where(and(gt(factions.formedAt, since), ne(factions.banner, '')))) {
    const [lead] = await d.db.select({ id: factionMembers.agentId }).from(factionMembers).where(eq(factionMembers.factionId, f.id)).limit(1);
    if (lead) briefs.push({ key: `template:faction:${f.id}`, brief: f.banner, tags: ['faction_cheer'], authorId: lead.id });
  }
  const [anyAgent] = await d.db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent')).limit(1);
  for (const p of await d.db.select().from(papers).where(and(gt(papers.createdAt, since), isNull(papers.memeBlobId)))) {
    if (p.body.memeBrief && anyAgent) briefs.push({ key: `template:paper:${p.day}`, brief: p.body.memeBrief, tags: ['idle', 'market_take'], authorId: anyAgent.id, paperDay: p.day });
  }
  let made = 0;
  for (const b of briefs) {
    if (await done(d.db, b.key)) continue;
    if (!(await canGenerate(d.db, d.limits, d.now()))) break; // budget spent: the rest wait, unclaimed, for tomorrow
    if (!(await claim(d.db, b.key, d.now()))) continue;
    const id = await generateTemplate({ db: d.db, gen: d.gen, limits: d.limits, now: d.now }, b); // null = generation failed: claimed, never retried in a loop
    if (!id) continue;
    made++;
    if (b.paperDay) {
      const [tpl] = await d.db.select({ blobId: memeTemplates.blobId }).from(memeTemplates).where(eq(memeTemplates.id, id));
      await d.db.update(papers).set({ memeBlobId: tpl!.blobId }).where(and(eq(papers.day, b.paperDay), isNull(papers.memeBlobId)));
    }
  }
  return made;
}

/** One sweep: every moment since the cursor gets its card and notifications once; then templates; then the cursor moves to now. */
export async function spotlightSweep(d: SpotlightDeps): Promise<number> {
  const now = d.now();
  const prev = await getSetting(d.db, SPOTLIGHT_CURSOR);
  const since = prev ? new Date(Date.parse(prev) - OVERLAP_MS) : new Date(now.getTime() - FIRST_LOOKBACK_MS);
  let handled = 0;
  for (const s of [...(await momentSpots(d.db, since, now)), ...(await feudSpots(d.db))]) {
    if (!(await claim(d.db, s.key, now))) continue;
    handled++;
    try {
      if (s.card) await createShareCard({ db: d.db, now: d.now }, s.card);
      for (const n of s.notify) await notifyFollowersOfMoment({ db: d.db, bus: d.bus, now: d.now }, { agentId: n.agentId, summary: n.summary, href: s.href, targetType: 'user', targetId: n.agentId });
    } catch (e) { console.error('[spotlight] moment failed', s.key, (e as Error).message); }
  }
  await templatesFromBriefs(d);
  await setSetting(d.db, SPOTLIGHT_CURSOR, now.toISOString());
  return handled;
}

/** Sweeps every `everyMs` (one at a time, never throwing); returns the stop function. */
export function startSpotlight(d: SpotlightDeps, everyMs = SPOTLIGHT_MS): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void spotlightSweep(d).catch((e) => console.error('[spotlight] sweep failed', e)).finally(() => { running = false; });
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
```

(A moment is claimed before its card is made, so a failure while rendering loses that one card instead of risking two; the failure is logged.)

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/agents-spotlight.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Start it at boot**

In `apps/server/src/world/boot.ts` (import `startSpotlight` from `../agents/depth/spotlight.ts` and `OpenAIImageGen` from `../agents/openai-images.ts`), in `bootAgents`, right after the `events.on((e) => { … indexer.invalidate … });` block that follows `const events = new WorldEvents();`:

```ts
  // Share cards, follower notifications and meme templates for big moments (Task 5.6), every 60 s.
  const stopSpotlight = startSpotlight({
    db, bus: app.deps.bus, now,
    gen: config.openaiApiKey ? new OpenAIImageGen(config.openaiApiKey, config.openaiImageModel) : null,
    limits: { usd: config.imageDailyBudgetUsd, max: config.imageDailyMax },
  });
```

and change `stop()` (as Phase 3 Task 3.3 left it) to `async stop() { stopSpotlight(); await handles.engine?.stop(); indexer.stop(); }`. (Phase 6 Task 6.1 later adds `bridgePulses` right after this line.)

- [ ] **Step 6: Run the boot test, typecheck and the full suite**

Run: `npx vitest run test/world-boot.test.ts test/agents-spotlight.test.ts`, then `npx tsc --noEmit -p .` and `npx vitest run`.
Expected: PASS; typecheck silent.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/agents/depth/spotlight.ts apps/server/src/world/boot.ts apps/server/test/agents-spotlight.test.ts
git commit -m "feat(agents): the spotlight — every big moment gets one share card and one round of follower notifications; briefs become meme templates within the image budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
