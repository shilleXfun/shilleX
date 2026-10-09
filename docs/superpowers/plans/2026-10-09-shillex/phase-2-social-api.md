# Phase 2 — Social API (Tasks 5–8)

Read the plan index `../2026-10-09-shillex.md` first. All route plugins are `export default async function xRoutes(app: FastifyInstance)` registered in `src/app.ts` with `{ prefix: '/api' }` (except `media`, which has no prefix), in the order listed in `buildApp`. Every route except `/api/auth/*` and `/media/*` calls `requireUser(req)` first.

---

### Task 5: Uploads and generated images

**Files:**
- Create: `apps/server/src/lib/image-size.ts`, `apps/server/src/lib/svg-art.ts`
- Create: `apps/server/src/routes/uploads.ts`, `apps/server/src/routes/media.ts`
- Modify: `apps/server/src/app.ts` (register `@fastify/multipart`, `@fastify/static` for uploads, `uploadsRoutes` with `/api` prefix, `mediaRoutes` without prefix)
- Test: `apps/server/test/image-size.test.ts`, `apps/server/test/uploads.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `errors`, `uploads` table, `config.uploadsDir`.
- Produces:
  - `imageInfo(buf: Buffer): { mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; width: number; height: number } | null`
  - `POST /api/uploads` (multipart field `file`) → `201 { upload: UploadView }`; 415 `UNSUPPORTED_MEDIA`; 413 `TOO_LARGE`
  - `GET /uploads/<id>.<ext>` static files
  - `GET /media/avatar/:seed.svg`, `/media/banner/:seed.svg`, `/media/token/:seed.svg`, `/media/art/:seed.svg` — deterministic SVGs (`avatarSvg(seed)`, `bannerSvg(seed)`, `tokenSvg(seed)`, `artSvg(seed)` in `svg-art.ts`)
  - `resolveUploads(db, userId, ids: string[]): Promise<UploadRow[]>` exported from `routes/uploads.ts` — throws 400 `BAD_UPLOAD` if any id is missing or not owned by `userId`

- [ ] **Step 1: Failing `imageInfo` tests**

`apps/server/test/image-size.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { imageInfo } from '../src/lib/image-size.ts';

function png(w: number, h: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function gif(w: number, h: number) {
  const b = Buffer.alloc(13); b.write('GIF89a', 0, 'ascii'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
}
function jpeg(w: number, h: number) {
  // SOI, APP0 (len 16), SOF0 (len 17) with height/width
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}
function webpVP8X(w: number, h: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

describe('imageInfo', () => {
  it('reads png', () => expect(imageInfo(png(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480 }));
  it('reads gif', () => expect(imageInfo(gif(32, 16))).toEqual({ mime: 'image/gif', width: 32, height: 16 }));
  it('reads jpeg', () => expect(imageInfo(jpeg(1200, 800))).toEqual({ mime: 'image/jpeg', width: 1200, height: 800 }));
  it('reads webp VP8X', () => expect(imageInfo(webpVP8X(300, 200))).toEqual({ mime: 'image/webp', width: 300, height: 200 }));
  it('rejects non-images and truncated data', () => {
    expect(imageInfo(Buffer.from('hello world, definitely not an image'))).toBeNull();
    expect(imageInfo(png(1, 1).subarray(0, 10))).toBeNull();
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `image-size.ts`**

`apps/server/src/lib/image-size.ts`:
```ts
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export interface ImageInfo { mime: ImageMime; width: number; height: number }

export function imageInfo(buf: Buffer): ImageInfo | null {
  try {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return ok('image/png', buf.readUInt32BE(16), buf.readUInt32BE(20));
    }
    if (buf.length >= 10 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
      return ok('image/gif', buf.readUInt16LE(6), buf.readUInt16LE(8));
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf);
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return webp(buf);
  } catch { /* fall through */ }
  return null;
}

function ok(mime: ImageMime, width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 && width <= 20000 && height <= 20000 ? { mime, width, height } : null;
}

function jpeg(buf: Buffer): ImageInfo | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return ok('image/jpeg', buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    }
    i += 2 + len;
  }
  return null;
}

function webp(buf: Buffer): ImageInfo | null {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return ok('image/webp', buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
  if (chunk === 'VP8 ') return ok('image/webp', buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return ok('image/webp', (b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
  }
  return null;
}
```

Run: `npm test -w @shillex/server -- image-size` → PASS.

- [ ] **Step 3: SVG art generator**

`apps/server/src/lib/svg-art.ts`:
```ts
import { createHash } from 'node:crypto';

// Muted, brand-compatible hues; no gradients beyond flat fills.
const HUES = [196, 168, 262, 28, 340, 84, 220, 12];
function rng(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => h[(i++) % h.length]! / 255;
}
const esc = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '');

export function avatarSvg(seed: string): string {
  const r = rng(`a:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const bg = `hsl(${hue} 32% 22%)`;
  const fg = `hsl(${hue} 70% 62%)`;
  const cells: string[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (r() > 0.5) {
      cells.push(`<rect x="${x * 12 + 4}" y="${y * 12 + 4}" width="12" height="12"/>`);
      if (x < 2) cells.push(`<rect x="${(4 - x) * 12 + 4}" y="${y * 12 + 4}" width="12" height="12"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 68" data-seed="${esc(seed)}"><rect width="68" height="68" fill="${bg}"/><g fill="${fg}">${cells.join('')}</g></svg>`;
}

export function tokenSvg(seed: string): string {
  const r = rng(`t:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const a = Math.floor(r() * 360);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="hsl(${hue} 40% 20%)"/><path d="M32 10 L52 46 L12 46 Z" transform="rotate(${a} 32 32)" fill="hsl(${hue} 75% 60%)" opacity=".9"/><circle cx="32" cy="32" r="8" fill="hsl(${(hue + 180) % 360} 70% 70%)"/></svg>`;
}

export function bannerSvg(seed: string): string {
  const r = rng(`b:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const lines = Array.from({ length: 14 }, (_, i) => {
    const y = 10 + i * 14 + r() * 6;
    return `<path d="M0 ${y} Q ${300 + r() * 300} ${y - 30 + r() * 60} 1500 ${y + r() * 20}" stroke="hsl(${hue} 60% ${30 + r() * 25}%)" stroke-width="1" fill="none" opacity=".5"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 220" preserveAspectRatio="xMidYMid slice"><rect width="1500" height="220" fill="hsl(${hue} 25% 12%)"/>${lines.join('')}</svg>`;
}

export function artSvg(seed: string): string {
  const r = rng(`art:${seed}`);
  const hue = HUES[Math.floor(r() * HUES.length)]!;
  const shapes = Array.from({ length: 9 }, () => {
    const x = r() * 800, y = r() * 450, s = 40 + r() * 160;
    return r() > 0.5
      ? `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="hsl(${(hue + r() * 60) % 360} 60% ${35 + r() * 30}%)" opacity=".85"/>`
      : `<rect x="${x}" y="${y}" width="${s}" height="${s}" transform="rotate(${r() * 90} ${x} ${y})" fill="hsl(${(hue + 180 + r() * 40) % 360} 55% ${30 + r() * 30}%)" opacity=".8"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="hsl(${hue} 22% 14%)"/>${shapes.join('')}</svg>`;
}
```

- [ ] **Step 4: Failing upload/media route tests**

`apps/server/test/uploads.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { loadConfig } from '../src/config.ts';

function multipart(filename: string, mime: string, data: Buffer) {
  const boundary = '----shillextest';
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
function png(w: number, h: number) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

let ctx: TestCtx; let u: TestUser; let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'shillex-up-'));
  const config = { ...loadConfig({ NODE_ENV: 'test' }), uploadsDir: dir };
  ctx = await makeTestApp({ config });
  u = await ctx.createUser('uploader');
});
afterAll(() => ctx.close());

describe('uploads', () => {
  it('accepts a png and stores it', async () => {
    const m = multipart('a.png', 'image/png', png(10, 20));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(201);
    const up = r.json().upload;
    expect(up).toMatchObject({ width: 10, height: 20, mime: 'image/png' });
    expect(up.url).toMatch(/^\/uploads\/[0-9A-Z]+\.png$/);
    expect(existsSync(join(dir, up.url.split('/').pop()))).toBe(true);
  });
  it('sniffs content instead of trusting the declared type', async () => {
    const m = multipart('evil.png', 'image/png', Buffer.from('<script>alert(1)</script>'));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(415);
    expect(r.json().code).toBe('UNSUPPORTED_MEDIA');
  });
  it('rejects files over 5 MB', async () => {
    const big = Buffer.concat([png(10, 10), Buffer.alloc(5 * 1024 * 1024)]);
    const m = multipart('big.png', 'image/png', big);
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: { ...m.headers, cookie: u.cookie } });
    expect(r.statusCode).toBe(413);
    expect(r.json().code).toBe('TOO_LARGE');
  });
  it('requires auth', async () => {
    const m = multipart('a.png', 'image/png', png(1, 1));
    const r = await ctx.app.inject({ method: 'POST', url: '/api/uploads', payload: m.payload, headers: m.headers });
    expect(r.statusCode).toBe(401);
  });
});

describe('generated media', () => {
  it('serves deterministic svg avatars', async () => {
    const a = await ctx.app.inject({ method: 'GET', url: '/media/avatar/abc.svg' });
    const b = await ctx.app.inject({ method: 'GET', url: '/media/avatar/abc.svg' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(a.body).toBe(b.body);
    expect(a.headers['cache-control']).toMatch(/immutable/);
  });
  it('404s unknown kinds', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/media/nope/abc.svg' })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 5: Implement routes and register**

`apps/server/src/routes/uploads.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { LIMITS, type UploadView } from '@shillex/shared';
import { uploads } from '../db/schema.ts';
import type { Db } from '../db/client.ts';
import { requireUser } from '../lib/auth.ts';
import { AppError, errors } from '../lib/errors.ts';
import { imageInfo } from '../lib/image-size.ts';
import { newId } from '../lib/ids.ts';

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
export type UploadRow = typeof uploads.$inferSelect;

export async function resolveUploads(db: Db, userId: string, ids: string[]): Promise<UploadRow[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(uploads).where(and(inArray(uploads.id, ids), eq(uploads.uploaderId, userId)));
  if (rows.length !== new Set(ids).size) throw errors.badRequest('BAD_UPLOAD', 'One or more uploads were not found');
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
}

export default async function uploadsRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;
  mkdirSync(config.uploadsDir, { recursive: true });

  app.post('/uploads', async (req, reply) => {
    const user = requireUser(req);
    let file;
    try {
      file = await req.file({ limits: { fileSize: LIMITS.uploadBytes, files: 1 } });
    } catch {
      throw errors.badRequest('BAD_UPLOAD', 'Expected a multipart upload');
    }
    if (!file) throw errors.badRequest('BAD_UPLOAD', 'No file provided');
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch {
      throw new AppError(413, 'TOO_LARGE', 'Images must be 5 MB or smaller');
    }
    if (file.file.truncated) throw new AppError(413, 'TOO_LARGE', 'Images must be 5 MB or smaller');
    const info = imageInfo(buf);
    if (!info) throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Only PNG, JPEG, GIF and WebP images are supported');
    const id = newId();
    const name = `${id}.${EXT[info.mime]}`;
    await writeFile(join(config.uploadsDir, name), buf);
    const url = `/uploads/${name}`;
    await db.insert(uploads).values({ id, uploaderId: user.id, url, mime: info.mime, width: info.width, height: info.height, createdAt: now() });
    const upload: UploadView = { id, url, width: info.width, height: info.height, mime: info.mime };
    return reply.status(201).send({ upload });
  });
}
```

`apps/server/src/routes/media.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { avatarSvg, bannerSvg, tokenSvg, artSvg } from '../lib/svg-art.ts';
import { errors } from '../lib/errors.ts';

const KINDS: Record<string, (seed: string) => string> = { avatar: avatarSvg, banner: bannerSvg, token: tokenSvg, art: artSvg };

export default async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { kind: string; seed: string } }>('/media/:kind/:seed', async (req, reply) => {
    const gen = KINDS[req.params.kind];
    const m = /^([A-Za-z0-9_-]{1,64})\.svg$/.exec(req.params.seed);
    if (!gen || !m) throw errors.notFound('Image');
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
      .send(gen(m[1]!));
  });
}
```

In `src/app.ts` add (after `registerErrorHandler`):
```ts
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { mkdirSync } from 'node:fs';
import uploadsRoutes from './routes/uploads.ts';
import mediaRoutes from './routes/media.ts';
// ...
await app.register(multipart);
mkdirSync(deps.config.uploadsDir, { recursive: true });
await app.register(fastifyStatic, { root: deps.config.uploadsDir, prefix: '/uploads/', decorateReply: false, immutable: true, maxAge: '365d' });
// after authRoutes:
await app.register(uploadsRoutes, { prefix: '/api' });
await app.register(mediaRoutes);
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test -w @shillex/server` → Expected: PASS.
```bash
git add apps/server
git commit -m "feat(server): image uploads with content sniffing and generated svg media"
```

---

### Task 6: Posts, threads, reactions, bookmarks, feed

**Files:**
- Create: `apps/server/src/tokens/view.ts`
- Create: `apps/server/src/services/hydrate.ts`, `services/mentions.ts`, `services/notify.ts`, `services/posts.ts`
- Create: `apps/server/src/routes/posts.ts`, `apps/server/src/routes/feed.ts`
- Modify: `apps/server/src/app.ts` (register `postsRoutes`, `feedRoutes`)
- Test: `apps/server/test/posts.test.ts`, `apps/server/test/feed.test.ts`

**Interfaces:**
- Consumes: visibility (Task 4), `resolveUploads` (Task 5), `toUserSummary` (Task 3), shared `uniqueMints`, `extractMentions`, `codePointLength`, `LIMITS`, `REACTIONS`.
- Produces:
  - `tokenRowToView(row: TokenRow): TokenView`, `pendingTokenView(mint: string): TokenView`, `readTokenViews(db, mints: string[]): Promise<{ views: Record<string, TokenView>; missing: string[]; stale: string[] }>` (stale = live + resolved with `fetchedAt` older than 5 min, or `error` older than 60 s) in `tokens/view.ts`
  - `userSummaries(db, ids: string[]): Promise<Map<string, UserSummary>>`
  - `hydratePosts(db: Db, viewerId: string, rows: PostRow[]): Promise<PostView[]>`
  - `collectMints(views: { mints: string[]; quoted?: { mints: string[] } | null; reposted?: { mints: string[]; quoted?: { mints: string[] } | null } | null }[]): string[]`
  - `recordMentions(db, a: { sourceType: 'post' | 'message'; sourceId: string; text: string; authorId: string; communityId: string | null; channelId: string | null; isPublic: boolean; createdAt: Date }): Promise<string[]>`; `removeMentions(db, sourceType, sourceId)`; `setCommunityMentionVisibility(db, communityId, isPublic)`
  - `notify(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, n: { userId: string; type: NotificationType; actorId: string | null; targetType: NotificationView['target']['type']; targetId: string; data?: Record<string, string> }): Promise<void>`; `describeNotification(type, actorName, data): { text: string; href: string }`; `toNotificationViews(db, rows): Promise<NotificationView[]>`
  - `createPost(deps: AppDeps, author: UserRow, input: CreatePostInput): Promise<PostRow>` where `CreatePostInput = { body: string; parentId?: string; quoteOfId?: string; communityId?: string; uploadIds?: string[]; alts?: string[] }`; `deletePost(deps, user, postId)`; `isQuotable(db, post): Promise<boolean>`
  - Routes: `POST /api/posts` → `201 { post: PostView, tokens }`; `GET /api/posts/:id` → `ThreadView`; `DELETE /api/posts/:id` → 204; `POST|DELETE /api/posts/:id/repost`; `PUT|DELETE /api/posts/:id/reactions/:emoji` → `{ reactions: ReactionSummary[] }`; `PUT|DELETE /api/posts/:id/bookmark`; `PUT|DELETE /api/posts/:id/subscription`; `GET /api/bookmarks?cursor` → `Page<PostView>`; `GET /api/feed?tab=following|discover&cursor` → `Page<PostView>` (with `tokens`)

- [ ] **Step 1: Token view helpers**

`apps/server/src/tokens/view.ts`:
```ts
import { inArray } from 'drizzle-orm';
import type { TokenView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { tokens, type TokenRow } from '../db/schema.ts';

export const MARKET_TTL_MS = 5 * 60_000;
export const ERROR_RETRY_MS = 60_000;

export function pendingTokenView(mint: string): TokenView {
  return { mint, status: 'pending', source: null, name: null, symbol: null, imageUrl: null, decimals: null, liquidityUsd: null,
    marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null };
}

export function tokenRowToView(r: TokenRow): TokenView {
  return {
    mint: r.mint, status: r.status, source: r.source ?? null, name: r.name, symbol: r.symbol,
    imageUrl: r.imageUrl ?? (r.source === 'demo' ? `/media/token/${r.mint}.svg` : null),
    decimals: r.decimals, liquidityUsd: r.liquidityUsd, marketCapUsd: r.marketCapUsd, fdvUsd: r.fdvUsd,
    pairAddress: r.pairAddress, dexId: r.dexId, pairCreatedAt: r.pairCreatedAt?.toISOString() ?? null,
    promoted: r.promoted, fetchedAt: r.fetchedAt?.toISOString() ?? null, error: r.error,
  };
}

export function isStale(r: TokenRow, now: Date): boolean {
  if (r.source === 'demo' || r.status === 'not_a_token') return false;
  const age = now.getTime() - (r.fetchedAt?.getTime() ?? 0);
  if (r.status === 'error') return age > ERROR_RETRY_MS;
  return age > MARKET_TTL_MS;
}

export async function readTokenViews(db: Db, mints: string[], now: Date = new Date()) {
  const uniq = [...new Set(mints)];
  const rows = uniq.length ? await db.select().from(tokens).where(inArray(tokens.mint, uniq)) : [];
  const byMint = new Map(rows.map((r) => [r.mint, r]));
  const views: Record<string, TokenView> = {};
  const missing: string[] = []; const stale: string[] = [];
  for (const m of uniq) {
    const r = byMint.get(m);
    if (!r) { views[m] = pendingTokenView(m); missing.push(m); continue; }
    views[m] = tokenRowToView(r);
    if (isStale(r, now)) stale.push(m);
  }
  return { views, missing, stale };
}
```

- [ ] **Step 2: Mentions and notify services**

`apps/server/src/services/mentions.ts`:
```ts
import { and, eq } from 'drizzle-orm';
import { uniqueMints } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { tokenMentions } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';

export async function recordMentions(db: Db, a: {
  sourceType: 'post' | 'message'; sourceId: string; text: string; authorId: string;
  communityId: string | null; channelId: string | null; isPublic: boolean; createdAt: Date; extraMints?: string[];
}): Promise<string[]> {
  const mints = [...new Set([...uniqueMints(a.text), ...(a.extraMints ?? [])])];
  if (!mints.length) return [];
  await db.insert(tokenMentions).values(mints.map((mint) => ({
    id: newId(), mint, sourceType: a.sourceType, sourceId: a.sourceId, authorId: a.authorId,
    communityId: a.communityId, channelId: a.channelId, isPublic: a.isPublic, createdAt: a.createdAt,
  }))).onConflictDoNothing();
  return mints;
}

export async function removeMentions(db: Db, sourceType: 'post' | 'message', sourceId: string) {
  await db.delete(tokenMentions).where(and(eq(tokenMentions.sourceType, sourceType), eq(tokenMentions.sourceId, sourceId)));
}

/** Called when a community's visibility changes. */
export async function setCommunityMentionVisibility(db: Db, communityId: string, isPublic: boolean) {
  await db.update(tokenMentions).set({ isPublic }).where(eq(tokenMentions.communityId, communityId));
}
```
`extraMints` carries token-card attachment mints for messages (Task 10).

`apps/server/src/services/notify.ts`:
```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import { abbreviateMint, type NotificationType, type NotificationView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { notifications, notificationPrefs, mutes } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { isBlockedEitherWay } from './visibility.ts';
import { userSummaries } from './hydrate.ts';

export interface NotifyInput {
  userId: string; type: NotificationType; actorId: string | null;
  targetType: NotificationView['target']['type']; targetId: string; data?: Record<string, string>;
}

export function describeNotification(type: NotificationType, actor: string, d: Record<string, string>): { text: string; href: string } {
  switch (type) {
    case 'reply': return { text: `${actor} replied to ${d.onSubscribed ? 'a conversation you follow' : 'your post'}`, href: `/p/${d.postId}` };
    case 'mention': return { text: `${actor} mentioned you`, href: d.href ?? `/p/${d.postId}` };
    case 'follow': return { text: `${actor} followed you`, href: `/u/${d.username}` };
    case 'reaction': return { text: `${actor} reacted ${d.emoji} to your post`, href: `/p/${d.postId}` };
    case 'quote': return { text: `${actor} quoted your post`, href: `/p/${d.postId}` };
    case 'repost': return { text: `${actor} reposted your post`, href: `/p/${d.postId}` };
    case 'dm': return { text: `${actor} started a conversation with you`, href: `/messages/${d.conversationId}` };
    case 'call_update': return { text: `${actor} posted a call update: ${d.label} (self-reported)`, href: `/p/${d.postId}` };
    case 'token_discussion': return { text: `New public discussion of ${d.symbol ? `$${d.symbol}` : abbreviateMint(d.mint ?? '')}`, href: `/discover?token=${d.mint}` };
    case 'invite': return { text: `${actor} invited you to ${d.communityName}`, href: `/invite/${d.code}` };
    case 'join_request': return { text: `${actor} requested to join ${d.communityName}`, href: `/c/${d.slug}?tab=requests` };
    case 'report_resolved': return { text: 'A report you filed was reviewed', href: '/notifications' };
  }
}

export async function toNotificationViews(db: Db, rows: (typeof notifications.$inferSelect)[]): Promise<NotificationView[]> {
  const actors = await userSummaries(db, rows.map((r) => r.actorId).filter((x): x is string => !!x));
  return rows.map((r) => {
    const actor = r.actorId ? actors.get(r.actorId) ?? null : null;
    const { text, href } = describeNotification(r.type as NotificationType, actor?.displayName ?? 'Someone', r.data);
    return { id: r.id, type: r.type as NotificationType, actor, target: { type: r.targetType as NotificationView['target']['type'], id: r.targetId },
      text, href, read: !!r.readAt, createdAt: r.createdAt.toISOString() };
  });
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function notify(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, n: NotifyInput): Promise<void> {
  const { db, bus, now } = deps;
  if (n.actorId && n.actorId === n.userId) return;
  if (n.actorId) {
    if (await isBlockedEitherWay(db, n.userId, n.actorId)) return;
    const muted = await db.select().from(mutes).where(and(eq(mutes.userId, n.userId), eq(mutes.targetId, n.actorId))).limit(1);
    if (muted.length) return;
  }
  const [pref] = await db.select().from(notificationPrefs)
    .where(and(eq(notificationPrefs.userId, n.userId), eq(notificationPrefs.type, n.type))).limit(1);
  if (pref && !pref.enabled) return;
  const [row] = await db.insert(notifications).values({
    id: newId(), userId: n.userId, type: n.type, actorId: n.actorId, targetType: n.targetType, targetId: n.targetId,
    data: n.data ?? {}, createdAt: now(),
  }).returning();
  const [view] = await toNotificationViews(db, [row!]);
  bus.toUser(n.userId, 'notification:new', { notification: view, unreadCount: await unreadCount(db, n.userId) });
}

export async function notifyMany(deps: Pick<AppDeps, 'db' | 'bus' | 'now'>, userIds: Iterable<string>, base: Omit<NotifyInput, 'userId'>) {
  for (const userId of new Set(userIds)) await notify(deps, { ...base, userId });
}
```

- [ ] **Step 3: Hydration**

`apps/server/src/services/hydrate.ts`:
```ts
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { REACTIONS, type PostView, type ReactionSummary, type UserSummary, type ReactionEmoji, type CallStatus } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import {
  users, posts, reactions, bookmarks, subscriptions, tokenMentions, callUpdates, communities, communityMembers,
  type PostRow,
} from '../db/schema.ts';
import { toUserSummary } from './users.ts';
import { accessFor } from './visibility.ts';

export async function userSummaries(db: Db, ids: string[]): Promise<Map<string, UserSummary>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await db.select().from(users).where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, toUserSummary(r)]));
}

export async function reactionSummaries(db: Db, targetType: 'post' | 'message', ids: string[], viewerId: string) {
  const out = new Map<string, ReactionSummary[]>();
  if (!ids.length) return out;
  const rows = await db.select({
    id: reactions.targetId, emoji: reactions.emoji,
    n: sql<number>`count(*)::int`, mine: sql<boolean>`bool_or(${reactions.userId} = ${viewerId})`,
  }).from(reactions).where(and(eq(reactions.targetType, targetType), inArray(reactions.targetId, ids)))
    .groupBy(reactions.targetId, reactions.emoji);
  for (const r of rows) {
    const list = out.get(r.id) ?? [];
    list.push({ emoji: r.emoji as ReactionEmoji, count: r.n, mine: r.mine });
    out.set(r.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
  return out;
}

const countBy = async (db: Db, col: typeof posts.parentId | typeof posts.quoteOfId | typeof posts.repostOfId, ids: string[]) => {
  if (!ids.length) return new Map<string, number>();
  const rows = await db.select({ id: col, n: sql<number>`count(*)::int` }).from(posts)
    .where(and(inArray(col, ids), isNull(posts.deletedAt))).groupBy(col);
  return new Map(rows.map((r) => [r.id as string, r.n]));
};

export async function hydratePosts(db: Db, viewerId: string, rows: PostRow[]): Promise<PostView[]> {
  if (!rows.length) return [];
  const all = new Map<string, PostRow>(rows.map((r) => [r.id, r]));
  const loadMore = async (ids: string[]) => {
    const need = ids.filter((id) => !all.has(id));
    if (!need.length) return;
    for (const r of await db.select().from(posts).where(inArray(posts.id, need))) all.set(r.id, r);
  };
  await loadMore(rows.flatMap((r) => [r.quoteOfId, r.repostOfId].filter((x): x is string => !!x)));
  await loadMore([...all.values()].map((r) => r.quoteOfId).filter((x): x is string => !!x));

  const list = [...all.values()];
  const ids = list.map((r) => r.id);
  const parentIds = [...new Set(list.map((r) => r.parentId).filter((x): x is string => !!x))];
  const parents = parentIds.length ? await db.select({ id: posts.id, authorId: posts.authorId }).from(posts).where(inArray(posts.id, parentIds)) : [];
  const parentAuthor = new Map(parents.map((p) => [p.id, p.authorId]));
  const communityIds = [...new Set(list.map((r) => r.communityId).filter((x): x is string => !!x))];

  const [authors, replyCounts, quoteCounts, repostCounts, reacts, myBookmarks, myReposts, mySubs, mentionRows, callRows, commRows, memberRows] = await Promise.all([
    userSummaries(db, [...list.map((r) => r.authorId), ...parents.map((p) => p.authorId)]),
    countBy(db, posts.parentId, ids),
    countBy(db, posts.quoteOfId, ids),
    countBy(db, posts.repostOfId, ids),
    reactionSummaries(db, 'post', ids, viewerId),
    db.select({ id: bookmarks.postId }).from(bookmarks).where(and(eq(bookmarks.userId, viewerId), inArray(bookmarks.postId, ids))),
    db.select({ id: posts.repostOfId }).from(posts).where(and(eq(posts.authorId, viewerId), eq(posts.kind, 'repost'), inArray(posts.repostOfId, ids), isNull(posts.deletedAt))),
    db.select({ id: subscriptions.targetId }).from(subscriptions).where(and(eq(subscriptions.userId, viewerId), eq(subscriptions.targetType, 'post'), inArray(subscriptions.targetId, ids))),
    db.select({ id: tokenMentions.sourceId, mint: tokenMentions.mint }).from(tokenMentions).where(and(eq(tokenMentions.sourceType, 'post'), inArray(tokenMentions.sourceId, ids))),
    db.select().from(callUpdates).where(inArray(callUpdates.postId, ids)).orderBy(callUpdates.id),
    communityIds.length ? db.select().from(communities).where(inArray(communities.id, communityIds)) : Promise.resolve([]),
    communityIds.length ? db.select().from(communityMembers).where(and(eq(communityMembers.userId, viewerId), inArray(communityMembers.communityId, communityIds))) : Promise.resolve([]),
  ]);

  const bookmarked = new Set(myBookmarks.map((r) => r.id));
  const repostedByMe = new Set(myReposts.map((r) => r.id));
  const subscribed = new Set(mySubs.map((r) => r.id));
  const mints = new Map<string, string[]>();
  for (const m of mentionRows) mints.set(m.id, [...(mints.get(m.id) ?? []), m.mint]);
  const calls = new Map<string, typeof callRows>();
  for (const c of callRows) calls.set(c.postId, [...(calls.get(c.postId) ?? []), c]);
  const comms = new Map(commRows.map((c) => [c.id, c]));
  const canRead = new Map(commRows.map((c) => [c.id, accessFor(c, memberRows.find((m) => m.communityId === c.id) ?? null).canRead]));

  const build = (r: PostRow, depth: number): PostView => {
    const hidden = !!r.deletedAt || (r.communityId !== null && !canRead.get(r.communityId));
    const c = r.communityId ? comms.get(r.communityId) : undefined;
    const postMints = hidden ? [] : mints.get(r.id) ?? [];
    const quotedRow = r.quoteOfId ? all.get(r.quoteOfId) : undefined;
    const repostRow = r.repostOfId ? all.get(r.repostOfId) : undefined;
    return {
      id: r.id, kind: r.kind, author: authors.get(r.authorId)!, body: hidden ? '' : r.body,
      createdAt: r.createdAt.toISOString(), deleted: hidden,
      parentId: r.parentId, rootId: r.rootId,
      replyTo: r.parentId && parentAuthor.get(r.parentId) ? { id: r.parentId, author: authors.get(parentAuthor.get(r.parentId)!)! } : null,
      community: c ? { id: c.id, slug: c.slug, name: c.name, visibility: c.visibility } : null,
      media: hidden ? [] : r.media,
      quoted: quotedRow && depth < 1 ? build(quotedRow, depth + 1) : null,
      reposted: repostRow && depth < 1 ? build(repostRow, depth) : null,
      counts: { replies: replyCounts.get(r.id) ?? 0, reposts: repostCounts.get(r.id) ?? 0, quotes: quoteCounts.get(r.id) ?? 0 },
      reactions: reacts.get(r.id) ?? [],
      viewer: {
        bookmarked: bookmarked.has(r.id), reposted: repostedByMe.has(r.id), subscribed: subscribed.has(r.id),
        canAddCallUpdate: !hidden && r.authorId === viewerId && postMints.length > 0 && (r.kind === 'post' || r.kind === 'quote'),
      },
      mints: postMints,
      callUpdates: hidden ? [] : (calls.get(r.id) ?? []).map((u) => ({
        id: u.id, status: u.status as CallStatus, note: u.note, selfReported: true as const, createdAt: u.createdAt.toISOString(),
      })),
    };
  };
  return rows.map((r) => build(r, 0));
}

export function collectMints(views: PostView[]): string[] {
  const out = new Set<string>();
  const walk = (p: PostView | null) => { if (!p) return; p.mints.forEach((m) => out.add(m)); walk(p.quoted); walk(p.reposted); };
  views.forEach(walk);
  return [...out];
}
```
Note: `reposted` for a repost reuses `depth` (not `depth + 1`) so a reposted quote still shows its quoted post.

- [ ] **Step 4: Failing posts tests**

`apps/server/test/posts.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { communities, communityMembers, tokenMentions, notifications } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let alice: TestUser; let bob: TestUser; let carol: TestUser;

async function community(visibility: 'public' | 'private' | 'invite', ownerId: string, members: string[] = []) {
  const id = newId();
  await ctx.db.insert(communities).values({ id, slug: `s${id.slice(-6).toLowerCase()}`, name: 'C', visibility, ownerId, createdAt: new Date() });
  await ctx.db.insert(communityMembers).values([ownerId, ...members].map((userId, i) => ({ communityId: id, userId, role: i === 0 ? 'owner' as const : 'member' as const, status: 'active' as const, joinedAt: new Date() })));
  return id;
}

beforeAll(async () => {
  ctx = await makeTestApp();
  alice = await ctx.createUser('alice'); bob = await ctx.createUser('bob'); carol = await ctx.createUser('carol');
});
afterAll(() => ctx.close());
beforeEach(() => ctx.bus.clear());

describe('creating posts', () => {
  it('creates a post, records a public mention, enqueues resolution', async () => {
    const r = await ctx.as(alice).post('/api/posts', { body: `new runner ${BONK}` });
    expect(r.status).toBe(201);
    expect(r.body.post).toMatchObject({ kind: 'post', body: `new runner ${BONK}`, mints: [BONK], author: { username: 'alice' } });
    expect(r.body.tokens[BONK].status).toBe('pending');
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, r.body.post.id));
    expect(m).toHaveLength(1);
    expect(m[0]!.isPublic).toBe(true);
    expect(ctx.tokens.enqueued).toContain(BONK);
    expect(r.body.post.viewer).toMatchObject({ subscribed: true, canAddCallUpdate: true });
  });

  describe('body boundaries (Review Focus #3)', () => {
    it('rejects whitespace-only bodies', async () => {
      const r = await ctx.as(alice).post('/api/posts', { body: '   \n ' });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('EMPTY_BODY');
    });
    it('counts code points, not UTF-16 units', async () => {
      expect((await ctx.as(alice).post('/api/posts', { body: '🔥'.repeat(1000) })).status).toBe(201);
      const r = await ctx.as(alice).post('/api/posts', { body: 'a'.repeat(1001) });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('BODY_TOO_LONG');
    });
  });

  it('replies thread under the root and notify the parent author', async () => {
    const root = (await ctx.as(alice).post('/api/posts', { body: 'root' })).body.post;
    const reply = (await ctx.as(bob).post('/api/posts', { body: 'reply', parentId: root.id })).body.post;
    expect(reply).toMatchObject({ kind: 'reply', parentId: root.id, rootId: root.id, replyTo: { author: { username: 'alice' } } });
    const nested = (await ctx.as(carol).post('/api/posts', { body: 'nested', parentId: reply.id })).body.post;
    expect(nested.rootId).toBe(root.id);
    const thread = (await ctx.as(alice).get(`/api/posts/${root.id}`)).body;
    expect(thread.post.counts.replies).toBe(1);
    expect(thread.replies.map((p: any) => p.id)).toEqual([reply.id]);
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.userId, alice.id));
    expect(notes.map((n) => n.type)).toContain('reply'); // bob's direct reply + carol's via subscription
    expect(ctx.bus.find('notification:new').some((e) => e.target === `user:${alice.id}`)).toBe(true);
  });

  it('notifies @mentioned users', async () => {
    await ctx.as(alice).post('/api/posts', { body: 'gm @carol' });
    const notes = await ctx.db.select().from(notifications).where(eq(notifications.userId, carol.id));
    expect(notes.some((n) => n.type === 'mention')).toBe(true);
  });

  it('quotes public posts but never private-community posts', async () => {
    const pub = (await ctx.as(bob).post('/api/posts', { body: 'quotable' })).body.post;
    const q = await ctx.as(alice).post('/api/posts', { body: 'this', quoteOfId: pub.id });
    expect(q.status).toBe(201);
    expect(q.body.post).toMatchObject({ kind: 'quote', quoted: { id: pub.id } });
    const priv = await community('private', bob.id, [alice.id]);
    const secret = (await ctx.as(bob).post('/api/posts', { body: 'secret', communityId: priv })).body.post;
    const bad = await ctx.as(alice).post('/api/posts', { body: 'leak', quoteOfId: secret.id });
    expect(bad.status).toBe(403);
    expect(bad.body.code).toBe('NOT_QUOTABLE');
  });

  it('community posts require membership and private ones are not public mentions', async () => {
    const priv = await community('private', bob.id);
    expect((await ctx.as(alice).post('/api/posts', { body: 'hi', communityId: priv })).status).toBe(403);
    const ok = await ctx.as(bob).post('/api/posts', { body: `alpha ${BONK}`, communityId: priv });
    const m = await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, ok.body.post.id));
    expect(m[0]!.isPublic).toBe(false);
    expect((await ctx.as(carol).get(`/api/posts/${ok.body.post.id}`)).status).toBe(404);
  });

  it('reposts, reactions and bookmarks toggle', async () => {
    const p = (await ctx.as(bob).post('/api/posts', { body: 'boost me' })).body.post;
    expect((await ctx.as(alice).post(`/api/posts/${p.id}/repost`)).status).toBe(201);
    expect((await ctx.as(alice).post(`/api/posts/${p.id}/repost`)).status).toBe(200); // idempotent
    let t = (await ctx.as(alice).get(`/api/posts/${p.id}`)).body;
    expect(t.post.counts.reposts).toBe(1);
    expect(t.post.viewer.reposted).toBe(true);
    await ctx.as(alice).del(`/api/posts/${p.id}/repost`);
    const fire = encodeURIComponent('🔥');
    const r1 = await ctx.as(alice).put(`/api/posts/${p.id}/reactions/${fire}`);
    expect(r1.body.reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }]);
    expect((await ctx.as(alice).put(`/api/posts/${p.id}/reactions/${encodeURIComponent('💩')}`)).status).toBe(400);
    await ctx.as(alice).put(`/api/posts/${p.id}/bookmark`);
    const bms = (await ctx.as(alice).get('/api/bookmarks')).body;
    expect(bms.items.map((x: any) => x.id)).toContain(p.id);
    t = (await ctx.as(alice).get(`/api/posts/${p.id}`)).body;
    expect(t.post.counts.reposts).toBe(0);
    expect(t.post.viewer.bookmarked).toBe(true);
  });

  it('only the author can delete; deletion removes mentions and tombstones the post', async () => {
    const p = (await ctx.as(alice).post('/api/posts', { body: `bye ${BONK}` })).body.post;
    expect((await ctx.as(bob).del(`/api/posts/${p.id}`)).status).toBe(403);
    expect((await ctx.as(alice).del(`/api/posts/${p.id}`)).status).toBe(204);
    expect(await ctx.db.select().from(tokenMentions).where(eq(tokenMentions.sourceId, p.id))).toHaveLength(0);
    const t = (await ctx.as(alice).get(`/api/posts/${p.id}`)).body;
    expect(t.post).toMatchObject({ deleted: true, body: '', mints: [] });
  });

  it('attaches owned uploads only', async () => {
    const bad = await ctx.as(alice).post('/api/posts', { body: 'pic', uploadIds: ['nope'] });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_UPLOAD');
  });
});
```

- [ ] **Step 5: Implement `services/posts.ts`**

`apps/server/src/services/posts.ts`:
```ts
import { and, eq, inArray, sql } from 'drizzle-orm';
import { LIMITS, codePointLength, extractMentions } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { posts, users, follows, subscriptions, communities, type PostRow, type UserRow } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { resolveUploads } from '../routes/uploads.ts';
import { canReadPost, computeMentionVisibility, getCommunityAccess, isBlockedEitherWay } from './visibility.ts';
import { recordMentions, removeMentions } from './mentions.ts';
import { notify } from './notify.ts';

export interface CreatePostInput { body: string; parentId?: string; quoteOfId?: string; communityId?: string; uploadIds?: string[]; alts?: string[] }

export async function loadPost(db: Db, id: string): Promise<PostRow | null> {
  const [p] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return p ?? null;
}

export async function isQuotable(db: Db, p: PostRow): Promise<boolean> {
  if (p.deletedAt || p.kind === 'repost') return false;
  if (!p.communityId) return true;
  const [c] = await db.select({ v: communities.visibility }).from(communities).where(eq(communities.id, p.communityId));
  return c?.v === 'public';
}

export async function createPost(deps: AppDeps, author: UserRow, input: CreatePostInput): Promise<PostRow> {
  const { db, now } = deps;
  const body = input.body.trim();
  if (codePointLength(body) > LIMITS.postMax) throw errors.badRequest('BODY_TOO_LONG', `Posts can be up to ${LIMITS.postMax} characters`);
  const uploadIds = input.uploadIds ?? [];
  if (uploadIds.length > LIMITS.maxImages) throw errors.badRequest('TOO_MANY_IMAGES', `Up to ${LIMITS.maxImages} images`);
  if (!body && (uploadIds.length === 0 || input.quoteOfId)) throw errors.badRequest('EMPTY_BODY', 'Write something first');

  let kind: PostRow['kind'] = 'post';
  let parent: PostRow | null = null;
  let quoted: PostRow | null = null;
  let communityId: string | null = input.communityId ?? null;

  if (input.parentId) {
    parent = await loadPost(db, input.parentId);
    if (!parent || !(await canReadPost(db, parent, author.id))) throw errors.notFound('Post');
    if (parent.deletedAt) throw errors.badRequest('POST_DELETED', 'That post was deleted');
    if (await isBlockedEitherWay(db, author.id, parent.authorId)) throw errors.forbidden('BLOCKED', 'You can’t reply to this account');
    kind = 'reply';
    communityId = parent.communityId;
  } else if (input.quoteOfId) {
    quoted = await loadPost(db, input.quoteOfId);
    if (!quoted || !(await canReadPost(db, quoted, author.id))) throw errors.notFound('Post');
    if (!(await isQuotable(db, quoted))) throw errors.forbidden('NOT_QUOTABLE', 'Only public posts can be quoted');
    if (await isBlockedEitherWay(db, author.id, quoted.authorId)) throw errors.forbidden('BLOCKED', 'You can’t quote this account');
    kind = 'quote';
    communityId = null;
  }

  let communityVisibility: 'public' | 'private' | 'invite' | null = null;
  if (communityId) {
    const access = await getCommunityAccess(db, communityId, author.id);
    if (!access?.canPost) throw errors.forbidden('JOIN_TO_POST', 'Join the community to post');
    communityVisibility = access.community.visibility;
  }

  const ups = await resolveUploads(db, author.id, uploadIds);
  const media = ups.map((u, i) => ({ url: u.url, width: u.width, height: u.height, alt: (input.alts?.[i] ?? '').slice(0, 200) }));
  const id = newId();
  const createdAt = now();
  const [row] = await db.insert(posts).values({
    id, authorId: author.id, kind, body, parentId: parent?.id ?? null, rootId: parent ? parent.rootId ?? parent.id : null,
    quoteOfId: quoted?.id ?? null, communityId, visibility: communityId ? 'community' : 'public', media, createdAt,
  }).returning();
  const post = row!;

  const mints = await recordMentions(db, {
    sourceType: 'post', sourceId: id, text: body, authorId: author.id, communityId, channelId: null,
    isPublic: computeMentionVisibility({ kind: 'post', communityVisibility }), createdAt,
  });
  if (mints.length) deps.tokens.enqueue(mints);
  await db.insert(subscriptions).values({ userId: author.id, targetType: 'post', targetId: id, createdAt }).onConflictDoNothing();

  // Notifications
  const notified = new Set<string>([author.id]);
  if (parent) {
    await notify(deps, { userId: parent.authorId, type: 'reply', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id } });
    notified.add(parent.authorId);
    const subs = await db.select({ u: subscriptions.userId }).from(subscriptions)
      .where(and(eq(subscriptions.targetType, 'post'), inArray(subscriptions.targetId, [post.rootId!, parent.id])));
    for (const s of subs) {
      if (notified.has(s.u)) continue;
      notified.add(s.u);
      if (!(await canReadPost(db, post, s.u))) continue;
      await notify(deps, { userId: s.u, type: 'reply', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id, onSubscribed: '1' } });
    }
  }
  if (quoted) {
    await notify(deps, { userId: quoted.authorId, type: 'quote', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id } });
    notified.add(quoted.authorId);
  }
  const handles = extractMentions(body);
  if (handles.length) {
    const mentioned = await db.select({ id: users.id }).from(users).where(inArray(sql`lower(${users.username})`, handles));
    for (const m of mentioned) {
      if (notified.has(m.id) || !(await canReadPost(db, post, m.id))) continue;
      notified.add(m.id);
      await notify(deps, { userId: m.id, type: 'mention', actorId: author.id, targetType: 'post', targetId: id, data: { postId: id } });
    }
  }

  // Realtime fan-out
  if (!communityId && kind !== 'reply') {
    const followers = await db.select({ id: follows.followerId }).from(follows).where(eq(follows.followeeId, author.id));
    for (const f of followers) deps.bus.toUser(f.id, 'post:new', { postId: id, authorId: author.id });
  } else if (communityId && kind !== 'reply') {
    deps.bus.toRoom(`community:${communityId}`, 'post:new', { postId: id, authorId: author.id });
  }
  return post;
}

export async function createRepost(deps: AppDeps, user: UserRow, targetId: string): Promise<{ created: boolean; post: PostRow }> {
  const { db, now } = deps;
  let target = await loadPost(db, targetId);
  if (target?.kind === 'repost' && target.repostOfId) target = await loadPost(db, target.repostOfId);
  if (!target || !(await canReadPost(db, target, user.id))) throw errors.notFound('Post');
  if (!(await isQuotable(db, target))) throw errors.forbidden('NOT_QUOTABLE', 'Only public posts can be reposted');
  if (await isBlockedEitherWay(db, user.id, target.authorId)) throw errors.forbidden('BLOCKED', 'You can’t repost this account');
  const [existing] = await db.select().from(posts).where(and(eq(posts.authorId, user.id), eq(posts.kind, 'repost'), eq(posts.repostOfId, target.id), sql`${posts.deletedAt} is null`)).limit(1);
  if (existing) return { created: false, post: existing };
  const [row] = await db.insert(posts).values({ id: newId(), authorId: user.id, kind: 'repost', body: '', repostOfId: target.id, visibility: 'public', createdAt: now() }).returning();
  await notify(deps, { userId: target.authorId, type: 'repost', actorId: user.id, targetType: 'post', targetId: target.id, data: { postId: target.id } });
  return { created: true, post: row! };
}

export async function deletePost(deps: AppDeps, user: UserRow, postId: string) {
  const p = await loadPost(deps.db, postId);
  if (!p || p.deletedAt) throw errors.notFound('Post');
  if (p.authorId !== user.id) throw errors.forbidden('NOT_AUTHOR', 'Only the author can delete this post');
  await deps.db.update(posts).set({ deletedAt: deps.now() }).where(eq(posts.id, postId));
  await removeMentions(deps.db, 'post', postId);
}
```

- [ ] **Step 6: Implement `routes/posts.ts`**

`apps/server/src/routes/posts.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, lt, notInArray } from 'drizzle-orm';
import { REACTIONS, type Page, type PostView, type ThreadView } from '@shillex/shared';
import { posts, reactions, bookmarks, subscriptions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { createPost, createRepost, deletePost, loadPost } from '../services/posts.ts';
import { hydratePosts, collectMints, reactionSummaries } from '../services/hydrate.ts';
import { canReadPost, hiddenAuthorIds, isBlockedEitherWay } from '../services/visibility.ts';
import { notify } from '../services/notify.ts';

const CreateBody = z.object({
  body: z.string().max(10_000).default(''),
  parentId: z.string().optional(),
  quoteOfId: z.string().optional(),
  communityId: z.string().optional(),
  uploadIds: z.array(z.string()).max(10).optional(),
  alts: z.array(z.string().max(200)).max(10).optional(),
});

export default async function postsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  async function readable(id: string, userId: string) {
    const p = await loadPost(db, id);
    if (!p || !(await canReadPost(db, p, userId))) throw errors.notFound('Post');
    return p;
  }
  async function viewOne(id: string, userId: string) {
    const [v] = await hydratePosts(db, userId, [(await loadPost(db, id))!]);
    return v!;
  }

  app.post('/posts', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: (r) => r.user?.id ?? r.ip } } }, async (req, reply) => {
    const user = requireUser(req);
    const input = parse(CreateBody, req.body);
    const row = await createPost(deps, user, input);
    const post = await viewOne(row.id, user.id);
    return reply.status(201).send({ post, tokens: await deps.tokens.getViews(collectMints([post])) });
  });

  app.get<{ Params: { id: string } }>('/posts/:id', async (req) => {
    const user = requireUser(req);
    const root = await readable(req.params.id, user.id);
    const hidden = await hiddenAuthorIds(db, user.id);
    const chain: typeof root[] = [];
    let cur = root;
    while (cur.parentId && chain.length < 20) {
      const parent = await loadPost(db, cur.parentId);
      if (!parent) break;
      chain.unshift(parent); cur = parent;
    }
    const replyRows = await db.select().from(posts).where(and(
      eq(posts.parentId, root.id), eq(posts.kind, 'reply'),
      hidden.length ? notInArray(posts.authorId, hidden) : undefined,
    )).orderBy(asc(posts.id)).limit(200);
    const [post, ...rest] = await hydratePosts(db, user.id, [root, ...chain, ...replyRows]);
    const ancestors = rest.slice(0, chain.length);
    const replies = rest.slice(chain.length).filter((p) => !p.deleted || p.counts.replies > 0);
    const view: ThreadView = { post: post!, ancestors, replies, tokens: await deps.tokens.getViews(collectMints([post!, ...ancestors, ...replies])) };
    return view;
  });

  app.delete<{ Params: { id: string } }>('/posts/:id', async (req, reply) => {
    await deletePost(deps, requireUser(req), req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/posts/:id/repost', async (req, reply) => {
    const user = requireUser(req);
    const r = await createRepost(deps, user, req.params.id);
    return reply.status(r.created ? 201 : 200).send({ post: await viewOne(r.post.id, user.id) });
  });
  app.delete<{ Params: { id: string } }>('/posts/:id/repost', async (req, reply) => {
    const user = requireUser(req);
    await db.delete(posts).where(and(eq(posts.authorId, user.id), eq(posts.kind, 'repost'), eq(posts.repostOfId, req.params.id)));
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string; emoji: string } }>('/posts/:id/reactions/:emoji', async (req) => {
    const user = requireUser(req);
    const emoji = decodeURIComponent(req.params.emoji);
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw errors.badRequest('BAD_REACTION', 'Unsupported reaction');
    const p = await readable(req.params.id, user.id);
    if (p.deletedAt) throw errors.badRequest('POST_DELETED', 'That post was deleted');
    if (await isBlockedEitherWay(db, user.id, p.authorId)) throw errors.forbidden('BLOCKED', 'You can’t react to this account');
    const inserted = await db.insert(reactions).values({ targetType: 'post', targetId: p.id, userId: user.id, emoji, createdAt: now() }).onConflictDoNothing().returning();
    if (inserted.length) await notify(deps, { userId: p.authorId, type: 'reaction', actorId: user.id, targetType: 'post', targetId: p.id, data: { postId: p.id, emoji } });
    return { reactions: (await reactionSummaries(db, 'post', [p.id], user.id)).get(p.id) ?? [] };
  });
  app.delete<{ Params: { id: string; emoji: string } }>('/posts/:id/reactions/:emoji', async (req) => {
    const user = requireUser(req);
    const emoji = decodeURIComponent(req.params.emoji);
    await db.delete(reactions).where(and(eq(reactions.targetType, 'post'), eq(reactions.targetId, req.params.id), eq(reactions.userId, user.id), eq(reactions.emoji, emoji)));
    return { reactions: (await reactionSummaries(db, 'post', [req.params.id], user.id)).get(req.params.id) ?? [] };
  });

  app.put<{ Params: { id: string } }>('/posts/:id/bookmark', async (req, reply) => {
    const user = requireUser(req);
    await readable(req.params.id, user.id);
    await db.insert(bookmarks).values({ userId: user.id, postId: req.params.id, createdAt: now() }).onConflictDoNothing();
    return reply.status(204).send();
  });
  app.delete<{ Params: { id: string } }>('/posts/:id/bookmark', async (req, reply) => {
    const user = requireUser(req);
    await db.delete(bookmarks).where(and(eq(bookmarks.userId, user.id), eq(bookmarks.postId, req.params.id)));
    return reply.status(204).send();
  });

  app.put<{ Params: { id: string } }>('/posts/:id/subscription', async (req, reply) => {
    const user = requireUser(req);
    await readable(req.params.id, user.id);
    await db.insert(subscriptions).values({ userId: user.id, targetType: 'post', targetId: req.params.id, createdAt: now() }).onConflictDoNothing();
    return reply.status(204).send();
  });
  app.delete<{ Params: { id: string } }>('/posts/:id/subscription', async (req, reply) => {
    const user = requireUser(req);
    await db.delete(subscriptions).where(and(eq(subscriptions.userId, user.id), eq(subscriptions.targetType, 'post'), eq(subscriptions.targetId, req.params.id)));
    return reply.status(204).send();
  });

  app.get<{ Querystring: { cursor?: string; limit?: string } }>('/bookmarks', async (req) => {
    const user = requireUser(req);
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select({ p: posts, at: bookmarks.createdAt }).from(bookmarks)
      .innerJoin(posts, eq(posts.id, bookmarks.postId))
      .where(and(eq(bookmarks.userId, user.id), isNull(posts.deletedAt), req.query.cursor ? lt(posts.id, req.query.cursor) : undefined))
      .orderBy(desc(posts.id)).limit(limit + 1);
    const readableRows = [];
    for (const r of rows.slice(0, limit)) if (await canReadPost(db, r.p, user.id)) readableRows.push(r.p);
    const items = await hydratePosts(db, user.id, readableRows);
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.p.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });
}
```

- [ ] **Step 7: Run posts tests**

Register in `src/app.ts`: `await app.register(postsRoutes, { prefix: '/api' });`
Run: `npm test -w @shillex/server -- posts` → Expected: PASS. Fix the implementation (not the tests) for any failure.

- [ ] **Step 8: Failing feed tests**

`apps/server/test/feed.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { follows, mutes } from '../src/db/schema.ts';

let ctx: TestCtx; let me: TestUser; let friend: TestUser; let stranger: TestUser; let loud: TestUser; let muted: TestUser;

beforeAll(async () => {
  ctx = await makeTestApp();
  me = await ctx.createUser('me'); friend = await ctx.createUser('friend'); stranger = await ctx.createUser('stranger');
  loud = await ctx.createUser('loud'); muted = await ctx.createUser('muted');
  await ctx.db.insert(follows).values([{ followerId: me.id, followeeId: friend.id, createdAt: new Date() }, { followerId: me.id, followeeId: muted.id, createdAt: new Date() }]);
  await ctx.db.insert(mutes).values({ userId: me.id, targetId: muted.id, createdAt: new Date() });
  await ctx.as(friend).post('/api/posts', { body: 'friend post' });
  await ctx.as(me).post('/api/posts', { body: 'my post' });
  await ctx.as(muted).post('/api/posts', { body: 'muted post' });
  const s = (await ctx.as(stranger).post('/api/posts', { body: 'stranger post' })).body.post;
  await ctx.as(friend).post(`/api/posts/${s.id}/repost`);
  for (let i = 0; i < 6; i++) await ctx.as(loud).post('/api/posts', { body: `loud ${i}` });
  await ctx.as(friend).post('/api/posts', { body: 'reply', parentId: s.id });
});
afterAll(() => ctx.close());

describe('GET /api/feed', () => {
  it('following: followees + self, reposts included, replies and muted excluded, newest first', async () => {
    const r = await ctx.as(me).get('/api/feed?tab=following');
    expect(r.status).toBe(200);
    const bodies = r.body.items.map((p: any) => (p.kind === 'repost' ? `RP:${p.reposted.body}` : p.body));
    expect(bodies).toEqual(['RP:stranger post', 'my post', 'friend post']);
  });

  it('following: cursor pagination', async () => {
    const first = await ctx.as(me).get('/api/feed?tab=following&limit=2');
    expect(first.body.items).toHaveLength(2);
    const second = await ctx.as(me).get(`/api/feed?tab=following&limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((p: any) => p.body)).toEqual(['friend post']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('discover: excludes self, followed and muted; caps 2 posts per author per page', async () => {
    const r = await ctx.as(me).get('/api/feed?tab=discover&limit=10');
    const authors = r.body.items.map((p: any) => p.author.username);
    expect(authors).not.toContain('me');
    expect(authors).not.toContain('friend');
    expect(authors).not.toContain('muted');
    expect(authors).toContain('stranger');
    expect(authors.filter((a: string) => a === 'loud').length).toBeLessThanOrEqual(2);
    expect(r.body.items.every((p: any) => p.kind === 'post' || p.kind === 'quote')).toBe(true);
  });

  it('rejects unknown tabs', async () => {
    expect((await ctx.as(me).get('/api/feed?tab=nope')).status).toBe(400);
  });
});
```

- [ ] **Step 9: Implement `routes/feed.ts`**

`apps/server/src/routes/feed.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { Page, PostView } from '@shillex/shared';
import { posts, follows, reactions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { hydratePosts, collectMints } from '../services/hydrate.ts';
import { hiddenAuthorIds } from '../services/visibility.ts';

const DISCOVER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export default async function feedRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db } = deps;

  app.get<{ Querystring: { tab?: string; cursor?: string; limit?: string } }>('/feed', async (req) => {
    const user = requireUser(req);
    const tab = req.query.tab ?? 'following';
    const limit = clampLimit(req.query.limit, 20, 50);
    const hidden = await hiddenAuthorIds(db, user.id);
    let items: PostView[] = [];
    let nextCursor: string | null = null;

    if (tab === 'following') {
      const followees = (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id))).map((r) => r.id);
      const authors = [...new Set([user.id, ...followees])].filter((id) => !hidden.includes(id));
      const rows = await db.select().from(posts).where(and(
        inArray(posts.authorId, authors), inArray(posts.kind, ['post', 'quote', 'repost']),
        isNull(posts.communityId), isNull(posts.deletedAt),
        req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
      )).orderBy(desc(posts.id)).limit(limit + 1);
      const pageRows = rows.slice(0, limit);
      const seen = new Set<string>();
      items = (await hydratePosts(db, user.id, pageRows)).filter((p) => {
        const target = p.reposted ?? p;
        if (p.reposted && (p.reposted.deleted || hidden.includes(p.reposted.author.id))) return false;
        if (seen.has(target.id)) return false;
        seen.add(target.id);
        return true;
      });
      nextCursor = rows.length > limit ? pageRows[pageRows.length - 1]!.id : null;
    } else if (tab === 'discover') {
      const offset = req.query.cursor?.startsWith('o:') ? Number(req.query.cursor.slice(2)) || 0 : 0;
      const followees = (await db.select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, user.id))).map((r) => r.id);
      const exclude = [...new Set([user.id, ...followees, ...hidden])];
      const since = new Date(deps.now().getTime() - DISCOVER_WINDOW_MS);
      const cands = await db.select({
        p: posts,
        rc: sql<number>`(select count(*)::int from ${reactions} r where r.target_type = 'post' and r.target_id = ${posts.id})`,
        cc: sql<number>`(select count(*)::int from ${posts} c where c.parent_id = ${posts.id} and c.deleted_at is null)`,
        sc: sql<number>`(select count(*)::int from ${posts} s where (s.quote_of_id = ${posts.id} or s.repost_of_id = ${posts.id}) and s.deleted_at is null)`,
      }).from(posts).where(and(
        inArray(posts.kind, ['post', 'quote']), isNull(posts.communityId), isNull(posts.deletedAt),
        notInArray(posts.authorId, exclude), gt(posts.createdAt, since),
      )).orderBy(desc(posts.id)).limit(400);
      const nowMs = deps.now().getTime();
      const scored = cands.map((c) => {
        const hours = Math.max(0, (nowMs - c.p.createdAt.getTime()) / 3_600_000);
        return { row: c.p, score: (c.rc + 2 * c.cc + 3 * c.sc + 1) / Math.pow(hours + 2, 1.5) };
      }).sort((a, b) => b.score - a.score);
      // Author diversity: at most 2 per author within each page-sized window.
      const ordered: typeof scored = [];
      const pool = [...scored];
      while (pool.length) {
        const pageStart = Math.floor(ordered.length / limit) * limit;
        const counts = new Map<string, number>();
        for (const x of ordered.slice(pageStart)) counts.set(x.row.authorId, (counts.get(x.row.authorId) ?? 0) + 1);
        const idx = pool.findIndex((x) => (counts.get(x.row.authorId) ?? 0) < 2);
        if (idx === -1) { pool.splice(0, pool.length); break; }
        ordered.push(pool.splice(idx, 1)[0]!);
      }
      const slice = ordered.slice(offset, offset + limit).map((x) => x.row);
      items = await hydratePosts(db, user.id, slice);
      nextCursor = offset + limit < ordered.length ? `o:${offset + limit}` : null;
    } else {
      throw errors.badRequest('BAD_TAB', 'tab must be following or discover');
    }
    const page: Page<PostView> = { items, nextCursor, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });
}
```

Register: `await app.register(feedRoutes, { prefix: '/api' });`

- [ ] **Step 10: Run all server tests and commit**

Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → Expected: PASS.
```bash
git add apps/server
git commit -m "feat(server): posts, threads, reposts, reactions, bookmarks, following/discover feeds"
```

---

### Task 7: Users, follows, mutes, blocks, settings

**Files:**
- Create: `apps/server/src/routes/users.ts`, `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/app.ts` (register both)
- Test: `apps/server/test/users.test.ts`, `apps/server/test/blocks.test.ts`

**Interfaces:**
- Consumes: hydrate, visibility, notify, `resolveUploads`, shared `isValidSolanaAddress`, `NOTIFICATION_TYPES`, `LIMITS`.
- Produces:
  - `GET /api/users?q=` → `{ users: UserSummary[] }` (≤10, excludes hidden and self)
  - `GET /api/users/:username` → `{ profile: UserProfile }` (404 unknown)
  - `GET /api/users/:username/posts?tab=posts|replies&cursor` → `Page<PostView>`; 403 `BLOCKED` when either side blocked
  - `GET /api/users/:username/followers|following?cursor` → `Page<UserSummary>`
  - `PUT|DELETE /api/users/:username/follow` → `{ following: boolean; followers: number }`
  - `PUT|DELETE /api/users/:username/mute`, `PUT|DELETE /api/users/:username/block` → 204
  - `GET /api/me/settings` → `SettingsView`; `PATCH /api/me/profile`; `PUT /api/me/wallet`; `DELETE /api/me/wallet`; `PUT /api/me/notification-prefs` → `SettingsView`; `GET /api/me/muted`, `GET /api/me/blocked` → `{ users: UserSummary[] }`
  - `loadUserByUsername(db, username): Promise<UserRow>` (404) exported from `routes/users.ts`

- [ ] **Step 1: Failing tests**

`apps/server/test/users.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

const ADDR = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let a: TestUser; let b: TestUser;
beforeAll(async () => { ctx = await makeTestApp(); a = await ctx.createUser('anon_ape'); b = await ctx.createUser('based_bob'); });
afterAll(() => ctx.close());

describe('profiles and follows', () => {
  it('returns a profile with counts and flags', async () => {
    const r = await ctx.as(a).get('/api/users/BASED_BOB');
    expect(r.status).toBe(200);
    expect(r.body.profile).toMatchObject({ username: 'based_bob', followers: 0, isSelf: false, isFollowing: false, wallet: null });
    expect((await ctx.as(a).get('/api/users/nobody_here')).status).toBe(404);
  });
  it('follow / unfollow updates counts and notifies', async () => {
    const f = await ctx.as(a).put('/api/users/based_bob/follow');
    expect(f.body).toEqual({ following: true, followers: 1 });
    expect(ctx.bus.find('notification:new').some((e) => e.target === `user:${b.id}`)).toBe(true);
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.followsYou).toBe(true);
    expect((await ctx.as(a).del('/api/users/based_bob/follow')).body).toEqual({ following: false, followers: 0 });
    expect((await ctx.as(a).put('/api/users/anon_ape/follow')).status).toBe(400);
  });
  it('lists posts and replies tabs', async () => {
    const p = (await ctx.as(b).post('/api/posts', { body: 'top' })).body.post;
    await ctx.as(b).post('/api/posts', { body: 'a reply', parentId: p.id });
    expect((await ctx.as(a).get('/api/users/based_bob/posts?tab=posts')).body.items.map((x: any) => x.body)).toEqual(['top']);
    expect((await ctx.as(a).get('/api/users/based_bob/posts?tab=replies')).body.items.map((x: any) => x.body)).toEqual(['a reply']);
  });
  it('searches users', async () => {
    const r = await ctx.as(a).get('/api/users?q=bob');
    expect(r.body.users.map((u: any) => u.username)).toEqual(['based_bob']);
  });
});

describe('settings', () => {
  it('updates profile with validated links', async () => {
    const ok = await ctx.as(a).patch('/api/me/profile', { displayName: 'Anon Ape', bio: 'trenches', links: [{ label: 'X', url: 'https://x.com/anon' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.bio).toBe('trenches');
    const bad = await ctx.as(a).patch('/api/me/profile', { links: [{ label: 'x', url: 'javascript:alert(1)' }] });
    expect(bad.status).toBe(400);
  });
  it('wallet is hidden unless explicitly displayed', async () => {
    await ctx.as(a).put('/api/me/wallet', { address: ADDR, displayWallet: false, displayHoldings: false });
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.wallet).toBeNull();
    await ctx.as(a).put('/api/me/wallet', { address: ADDR, displayWallet: true, displayHoldings: true });
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.wallet).toEqual({ address: ADDR, showHoldings: true, verified: false });
    expect((await ctx.as(a).put('/api/me/wallet', { address: 'not-an-address', displayWallet: true, displayHoldings: false })).status).toBe(400);
    await ctx.as(a).del('/api/me/wallet');
    expect((await ctx.as(b).get('/api/users/anon_ape')).body.profile.wallet).toBeNull();
  });
  it('notification prefs disable delivery', async () => {
    const s = await ctx.as(b).put('/api/me/notification-prefs', { prefs: [{ type: 'follow', enabled: false }] });
    expect(s.body.notificationPrefs.find((p: any) => p.type === 'follow').enabled).toBe(false);
    ctx.bus.clear();
    await ctx.as(a).put('/api/users/based_bob/follow');
    expect(ctx.bus.find('notification:new')).toHaveLength(0);
  });
});
```

`apps/server/test/blocks.test.ts` (Review Focus #5):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { notifications, follows } from '../src/db/schema.ts';

let ctx: TestCtx; let blocker: TestUser; let blocked: TestUser; let post: any;
beforeAll(async () => {
  ctx = await makeTestApp();
  blocker = await ctx.createUser('blocker'); blocked = await ctx.createUser('blocked_guy');
  await ctx.as(blocked).put('/api/users/blocker/follow');
  post = (await ctx.as(blocker).post('/api/posts', { body: 'mine' })).body.post;
  expect((await ctx.as(blocker).put('/api/users/blocked_guy/block')).status).toBe(204);
});
afterAll(() => ctx.close());

describe('blocks across interaction paths', () => {
  it('removes follows both ways', async () => {
    expect(await ctx.db.select().from(follows).where(eq(follows.followerId, blocked.id))).toHaveLength(0);
  });
  it('blocked user cannot reply, quote, repost, react or follow', async () => {
    const reply = await ctx.as(blocked).post('/api/posts', { body: 'x', parentId: post.id });
    expect(reply.status).toBe(403);
    expect((await ctx.as(blocked).post('/api/posts', { body: 'x', quoteOfId: post.id })).status).toBe(403);
    expect((await ctx.as(blocked).post(`/api/posts/${post.id}/repost`)).status).toBe(403);
    expect((await ctx.as(blocked).put(`/api/posts/${post.id}/reactions/${encodeURIComponent('🔥')}`)).status).toBe(403);
    expect((await ctx.as(blocked).put('/api/users/blocker/follow')).status).toBe(403);
  });
  it('mentions from the blocked user do not notify', async () => {
    await ctx.as(blocked).post('/api/posts', { body: 'hey @blocker' });
    const n = await ctx.db.select().from(notifications).where(eq(notifications.userId, blocker.id));
    expect(n.filter((x) => x.actorId === blocked.id && x.type === 'mention')).toHaveLength(0);
  });
  it('neither sees the other in feeds, profiles posts or user search', async () => {
    const d1 = await ctx.as(blocked).get('/api/feed?tab=discover');
    expect(d1.body.items.some((p: any) => p.author.username === 'blocker')).toBe(false);
    const d2 = await ctx.as(blocker).get('/api/feed?tab=discover');
    expect(d2.body.items.some((p: any) => p.author.username === 'blocked_guy')).toBe(false);
    expect((await ctx.as(blocked).get('/api/users/blocker/posts')).status).toBe(403);
    expect((await ctx.as(blocked).get('/api/users?q=blocker')).body.users).toEqual([]);
  });
  it('unblock restores interaction', async () => {
    await ctx.as(blocker).del('/api/users/blocked_guy/block');
    expect((await ctx.as(blocked).post('/api/posts', { body: 'ok', parentId: post.id })).status).toBe(201);
  });
});
```
(DM blocking is asserted in Task 10's `conversations.test.ts`; suggestion filtering in Task 13's `discover.test.ts`.)

- [ ] **Step 2: Implement `routes/users.ts`**

`apps/server/src/routes/users.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Page, PostView, UserProfile, UserSummary } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { users, follows, mutes, blocks, posts, walletLinks, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { clampLimit } from '../lib/pagination.ts';
import { hydratePosts, collectMints } from '../services/hydrate.ts';
import { hiddenAuthorIds, isBlockedEitherWay } from '../services/visibility.ts';
import { toUserSummary } from '../services/users.ts';
import { notify } from '../services/notify.ts';

export async function loadUserByUsername(db: Db, username: string): Promise<UserRow> {
  const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${username.toLowerCase()}`).limit(1);
  if (!u) throw errors.notFound('User');
  return u;
}

const count = async (db: Db, col: typeof follows.followerId | typeof follows.followeeId, id: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(col, id)))[0]?.n ?? 0;

export default async function usersRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  app.get<{ Querystring: { q?: string } }>('/users', async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? '').trim().replace(/[%_]/g, '');
    if (!q) return { users: [] };
    const hidden = await hiddenAuthorIds(db, me.id);
    const rows = await db.select().from(users).where(and(
      or(ilike(users.username, `%${q}%`), ilike(users.displayName, `%${q}%`)), ne(users.id, me.id),
      hidden.length ? notInArray(users.id, hidden) : undefined,
    )).orderBy(users.username).limit(10);
    return { users: rows.map(toUserSummary) };
  });

  app.get<{ Params: { username: string } }>('/users/:username', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    const [followers, following, iFollow, theyFollow, muted, blocked, wallet] = await Promise.all([
      count(db, follows.followeeId, u.id), count(db, follows.followerId, u.id),
      db.select().from(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, u.id))).limit(1),
      db.select().from(follows).where(and(eq(follows.followerId, u.id), eq(follows.followeeId, me.id))).limit(1),
      db.select().from(mutes).where(and(eq(mutes.userId, me.id), eq(mutes.targetId, u.id))).limit(1),
      db.select().from(blocks).where(and(eq(blocks.userId, me.id), eq(blocks.targetId, u.id))).limit(1),
      db.select().from(walletLinks).where(eq(walletLinks.userId, u.id)).limit(1),
    ]);
    const w = wallet[0];
    const profile: UserProfile = {
      ...toUserSummary(u), bannerUrl: u.bannerUrl ?? `/media/banner/${u.id}.svg`, bio: u.bio, links: u.links,
      createdAt: u.createdAt.toISOString(), followers, following, isSelf: u.id === me.id,
      isFollowing: iFollow.length > 0, followsYou: theyFollow.length > 0, isMuted: muted.length > 0, isBlocked: blocked.length > 0,
      wallet: w && w.displayWallet ? { address: w.address, showHoldings: w.displayHoldings, verified: false } : null,
    };
    return { profile };
  });

  app.get<{ Params: { username: string }; Querystring: { tab?: string; cursor?: string; limit?: string } }>('/users/:username/posts', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    if (u.id !== me.id && (await isBlockedEitherWay(db, me.id, u.id))) throw errors.forbidden('BLOCKED', 'You can’t view this account’s posts');
    const tab = req.query.tab === 'replies' ? 'replies' : 'posts';
    const limit = clampLimit(req.query.limit, 20, 50);
    const rows = await db.select().from(posts).where(and(
      eq(posts.authorId, u.id), isNull(posts.communityId), isNull(posts.deletedAt),
      tab === 'replies' ? eq(posts.kind, 'reply') : inArray(posts.kind, ['post', 'quote', 'repost']),
      req.query.cursor ? lt(posts.id, req.query.cursor) : undefined,
    )).orderBy(desc(posts.id)).limit(limit + 1);
    const items = await hydratePosts(db, me.id, rows.slice(0, limit));
    const page: Page<PostView> = { items, nextCursor: rows.length > limit ? rows[limit - 1]!.id : null, tokens: await deps.tokens.getViews(collectMints(items)) };
    return page;
  });

  for (const dir of ['followers', 'following'] as const) {
    app.get<{ Params: { username: string }; Querystring: { cursor?: string } }>(`/users/:username/${dir}`, async (req) => {
      requireUser(req);
      const u = await loadUserByUsername(db, req.params.username);
      const [mine, other] = dir === 'followers' ? [follows.followeeId, follows.followerId] : [follows.followerId, follows.followeeId];
      const rows = await db.select({ u: users }).from(follows).innerJoin(users, eq(users.id, other))
        .where(and(eq(mine, u.id), req.query.cursor ? lt(users.id, req.query.cursor) : undefined)).orderBy(desc(users.id)).limit(51);
      const page: Page<UserSummary> = { items: rows.slice(0, 50).map((r) => toUserSummary(r.u)), nextCursor: rows.length > 50 ? rows[49]!.u.id : null };
      return page;
    });
  }

  app.put<{ Params: { username: string } }>('/users/:username/follow', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    if (u.id === me.id) throw errors.badRequest('SELF_FOLLOW', 'You can’t follow yourself');
    if (await isBlockedEitherWay(db, me.id, u.id)) throw errors.forbidden('BLOCKED', 'You can’t follow this account');
    const ins = await db.insert(follows).values({ followerId: me.id, followeeId: u.id, createdAt: now() }).onConflictDoNothing().returning();
    if (ins.length) await notify(deps, { userId: u.id, type: 'follow', actorId: me.id, targetType: 'user', targetId: me.id, data: { username: me.username } });
    return { following: true, followers: await count(db, follows.followeeId, u.id) };
  });
  app.delete<{ Params: { username: string } }>('/users/:username/follow', async (req) => {
    const me = requireUser(req);
    const u = await loadUserByUsername(db, req.params.username);
    await db.delete(follows).where(and(eq(follows.followerId, me.id), eq(follows.followeeId, u.id)));
    return { following: false, followers: await count(db, follows.followeeId, u.id) };
  });

  for (const [path, table] of [['mute', mutes], ['block', blocks]] as const) {
    app.put<{ Params: { username: string } }>(`/users/:username/${path}`, async (req, reply) => {
      const me = requireUser(req);
      const u = await loadUserByUsername(db, req.params.username);
      if (u.id === me.id) throw errors.badRequest('SELF', `You can’t ${path} yourself`);
      await db.insert(table).values({ userId: me.id, targetId: u.id, createdAt: now() }).onConflictDoNothing();
      if (path === 'block') {
        await db.delete(follows).where(or(
          and(eq(follows.followerId, me.id), eq(follows.followeeId, u.id)),
          and(eq(follows.followerId, u.id), eq(follows.followeeId, me.id)),
        ));
      }
      return reply.status(204).send();
    });
    app.delete<{ Params: { username: string } }>(`/users/:username/${path}`, async (req, reply) => {
      const me = requireUser(req);
      const u = await loadUserByUsername(db, req.params.username);
      await db.delete(table).where(and(eq(table.userId, me.id), eq(table.targetId, u.id)));
      return reply.status(204).send();
    });
  }
}
```

- [ ] **Step 3: Implement `routes/me.ts`**

`apps/server/src/routes/me.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { LIMITS, NOTIFICATION_TYPES, isValidSolanaAddress, type SettingsView } from '@shillex/shared';
import { users, walletLinks, notificationPrefs, mutes, blocks, type UserRow } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { resolveUploads } from './uploads.ts';
import { avatarFor, toUserSummary } from '../services/users.ts';

const Link = z.object({ label: z.string().trim().min(1).max(24), url: z.string().max(200).regex(/^https?:\/\/[^\s]+$/i, 'Links must start with http:// or https://') });
const Profile = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().max(160).optional(),
  links: z.array(Link).max(LIMITS.profileLinksMax).optional(),
  avatarUploadId: z.string().nullable().optional(),
  bannerUploadId: z.string().nullable().optional(),
});
const Wallet = z.object({
  address: z.string().refine(isValidSolanaAddress, 'Not a valid Solana address'),
  displayWallet: z.boolean(), displayHoldings: z.boolean(),
});
const Prefs = z.object({ prefs: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), enabled: z.boolean() })).max(NOTIFICATION_TYPES.length) });

export default async function meRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  async function settings(u: UserRow): Promise<SettingsView> {
    const [w] = await db.select().from(walletLinks).where(eq(walletLinks.userId, u.id));
    const prefs = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
    const byType = new Map(prefs.map((p) => [p.type, p.enabled]));
    return {
      profile: { displayName: u.displayName, bio: u.bio, links: u.links, avatarUrl: avatarFor(u), bannerUrl: u.bannerUrl },
      wallet: w ? { address: w.address, displayWallet: w.displayWallet, displayHoldings: w.displayHoldings, verified: false } : null,
      notificationPrefs: NOTIFICATION_TYPES.map((type) => ({ type, enabled: byType.get(type) ?? true })),
    };
  }
  const fresh = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!;

  app.get('/me/settings', async (req) => settings(requireUser(req)));

  app.patch('/me/profile', async (req) => {
    const me = requireUser(req);
    const body = parse(Profile, req.body);
    const patch: Partial<UserRow> = {};
    if (body.displayName !== undefined) patch.displayName = body.displayName;
    if (body.bio !== undefined) patch.bio = body.bio;
    if (body.links !== undefined) patch.links = body.links;
    if (body.avatarUploadId !== undefined) patch.avatarUrl = body.avatarUploadId ? (await resolveUploads(db, me.id, [body.avatarUploadId]))[0]!.url : null;
    if (body.bannerUploadId !== undefined) patch.bannerUrl = body.bannerUploadId ? (await resolveUploads(db, me.id, [body.bannerUploadId]))[0]!.url : null;
    if (Object.keys(patch).length) await db.update(users).set(patch).where(eq(users.id, me.id));
    return settings(await fresh(me.id));
  });

  app.put('/me/wallet', async (req) => {
    const me = requireUser(req);
    const body = parse(Wallet, req.body);
    await db.insert(walletLinks).values({ userId: me.id, ...body, verified: false })
      .onConflictDoUpdate({ target: walletLinks.userId, set: { address: body.address, displayWallet: body.displayWallet, displayHoldings: body.displayHoldings, verified: false } });
    return settings(me);
  });
  app.delete('/me/wallet', async (req) => {
    const me = requireUser(req);
    await db.delete(walletLinks).where(eq(walletLinks.userId, me.id));
    return settings(me);
  });

  app.put('/me/notification-prefs', async (req) => {
    const me = requireUser(req);
    const body = parse(Prefs, req.body);
    for (const p of body.prefs) {
      await db.insert(notificationPrefs).values({ userId: me.id, type: p.type, enabled: p.enabled })
        .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.type], set: { enabled: p.enabled } });
    }
    return settings(me);
  });

  for (const [path, table] of [['muted', mutes], ['blocked', blocks]] as const) {
    app.get(`/me/${path}`, async (req) => {
      const me = requireUser(req);
      const rows = await db.select({ u: users }).from(table).innerJoin(users, eq(users.id, table.targetId)).where(eq(table.userId, me.id));
      return { users: rows.map((r) => toUserSummary(r.u)) };
    });
  }
}
```
The `PATCH /me/profile` handler returns `SettingsView` with an added `profile` key matching the test (`ok.body.profile.bio`) — `SettingsView.profile` already satisfies this.

- [ ] **Step 4: Register, run, commit**

Register `usersRoutes` and `meRoutes` with `/api` prefix.
Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): profiles, follows, mutes, blocks, settings and wallet display opt-in"
```

---

### Task 8: Notifications API and call updates

**Files:**
- Create: `apps/server/src/routes/notifications.ts`, `apps/server/src/routes/calls.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/notifications.test.ts`, `apps/server/test/calls.test.ts`

**Interfaces:**
- Consumes: `notify`, `toNotificationViews`, `unreadCount`, `hydratePosts`, `loadPost`, `CALL_STATUSES`, `CALL_STATUS_LABELS`.
- Produces:
  - `GET /api/notifications?filter=all|mentions|calls&cursor` → `Page<NotificationView>`; mentions filter = types `mention` + `reply`; calls filter = `call_update` + `token_discussion`
  - `POST /api/notifications/read` `{ ids?: string[] }` → `{ unread: number }`
  - `GET /api/notifications/unread-count` → `{ unread: number }`
  - `POST /api/posts/:id/call-updates` `{ status: CallStatus; note?: string (≤280) }` → `201 { update: CallUpdateView; post: PostView }`; 403 `NOT_AUTHOR`; 400 `NO_TOKEN` when the post has no token mention; 400 `POST_DELETED`
  - Call updates are immutable (no edit/delete endpoint — the timeline stays honest).
  - Emits `call:update` `{ postId, update }` to each subscriber's user room; `notify(type: 'call_update')` to subscribers except the author.

- [ ] **Step 1: Failing tests**

`apps/server/test/calls.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
let ctx: TestCtx; let caller: TestUser; let fan: TestUser; let call: any; let plain: any;
beforeAll(async () => {
  ctx = await makeTestApp();
  caller = await ctx.createUser('caller'); fan = await ctx.createUser('fan');
  call = (await ctx.as(caller).post('/api/posts', { body: `watching ${MINT}` })).body.post;
  plain = (await ctx.as(caller).post('/api/posts', { body: 'no token here' })).body.post;
  await ctx.as(fan).put(`/api/posts/${call.id}/subscription`);
});
afterAll(() => ctx.close());

describe('call updates', () => {
  it('author adds self-reported updates that stay attached in order', async () => {
    ctx.bus.clear();
    const a = await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'bought', note: 'small bag' });
    expect(a.status).toBe(201);
    expect(a.body.update).toMatchObject({ status: 'bought', note: 'small bag', selfReported: true });
    await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'taking_profit' });
    const t = (await ctx.as(fan).get(`/api/posts/${call.id}`)).body;
    expect(t.post.callUpdates.map((u: any) => u.status)).toEqual(['bought', 'taking_profit']);
    expect(ctx.bus.find('call:update').filter((e) => e.target === `user:${fan.id}`)).toHaveLength(2);
    const n = (await ctx.as(fan).get('/api/notifications?filter=calls')).body.items;
    expect(n[0].text).toMatch(/Taking profit \(self-reported\)/);
  });
  it('rejects non-authors, posts without tokens, and bad statuses', async () => {
    expect((await ctx.as(fan).post(`/api/posts/${call.id}/call-updates`, { status: 'out' })).body.code).toBe('NOT_AUTHOR');
    expect((await ctx.as(caller).post(`/api/posts/${plain.id}/call-updates`, { status: 'out' })).body.code).toBe('NO_TOKEN');
    expect((await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'moon' })).status).toBe(400);
    expect((await ctx.as(caller).post(`/api/posts/${call.id}/call-updates`, { status: 'out', note: 'x'.repeat(281) })).status).toBe(400);
  });
});
```

`apps/server/test/notifications.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';

let ctx: TestCtx; let a: TestUser; let b: TestUser;
beforeAll(async () => {
  ctx = await makeTestApp();
  a = await ctx.createUser('notif_a'); b = await ctx.createUser('notif_b');
  const p = (await ctx.as(a).post('/api/posts', { body: 'hello' })).body.post;
  await ctx.as(b).post('/api/posts', { body: 'reply', parentId: p.id });
  await ctx.as(b).put('/api/users/notif_a/follow');
  await ctx.as(b).post('/api/posts', { body: 'yo @notif_a' });
});
afterAll(() => ctx.close());

describe('notifications', () => {
  it('lists newest first with text and href', async () => {
    const r = await ctx.as(a).get('/api/notifications');
    expect(r.body.items.map((n: any) => n.type)).toEqual(['mention', 'follow', 'reply']);
    expect(r.body.items[1]).toMatchObject({ text: 'notif_b followed you', href: '/u/notif_b', read: false });
  });
  it('filters mentions (mention + reply)', async () => {
    const r = await ctx.as(a).get('/api/notifications?filter=mentions');
    expect(r.body.items.map((n: any) => n.type)).toEqual(['mention', 'reply']);
  });
  it('marks read individually and all', async () => {
    const list = (await ctx.as(a).get('/api/notifications')).body.items;
    expect((await ctx.as(a).post('/api/notifications/read', { ids: [list[0].id] })).body.unread).toBe(2);
    expect((await ctx.as(a).post('/api/notifications/read', {})).body.unread).toBe(0);
    expect((await ctx.as(a).get('/api/notifications/unread-count')).body.unread).toBe(0);
  });
  it('never returns another user’s notifications', async () => {
    const list = (await ctx.as(a).get('/api/notifications')).body.items;
    await ctx.as(b).post('/api/notifications/read', { ids: [list[0].id] });
    expect((await ctx.as(b).get('/api/notifications')).body.items.every((n: any) => !list.some((x: any) => x.id === n.id))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

`apps/server/src/routes/notifications.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { NotificationView, Page } from '@shillex/shared';
import { notifications } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { clampLimit } from '../lib/pagination.ts';
import { toNotificationViews, unreadCount } from '../services/notify.ts';

const FILTERS: Record<string, string[] | null> = { all: null, mentions: ['mention', 'reply'], calls: ['call_update', 'token_discussion'] };

export default async function notificationsRoutes(app: FastifyInstance) {
  const { db, now } = app.deps;

  app.get<{ Querystring: { filter?: string; cursor?: string; limit?: string } }>('/notifications', async (req) => {
    const me = requireUser(req);
    const types = FILTERS[req.query.filter ?? 'all'] ?? null;
    const limit = clampLimit(req.query.limit, 30, 100);
    const rows = await db.select().from(notifications).where(and(
      eq(notifications.userId, me.id), types ? inArray(notifications.type, types) : undefined,
      req.query.cursor ? lt(notifications.id, req.query.cursor) : undefined,
    )).orderBy(desc(notifications.id)).limit(limit + 1);
    const page: Page<NotificationView> = { items: await toNotificationViews(db, rows.slice(0, limit)), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null };
    return page;
  });

  app.post('/notifications/read', async (req) => {
    const me = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).optional() }), req.body ?? {});
    await db.update(notifications).set({ readAt: now() }).where(and(
      eq(notifications.userId, me.id), isNull(notifications.readAt), ids ? inArray(notifications.id, ids) : undefined,
    ));
    return { unread: await unreadCount(db, me.id) };
  });

  app.get('/notifications/unread-count', async (req) => ({ unread: await unreadCount(db, requireUser(req).id) }));
}
```

`apps/server/src/routes/calls.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { CALL_STATUSES, CALL_STATUS_LABELS, type CallUpdateView } from '@shillex/shared';
import { callUpdates, subscriptions, tokenMentions } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { parse } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { loadPost } from '../services/posts.ts';
import { hydratePosts } from '../services/hydrate.ts';
import { canReadPost } from '../services/visibility.ts';
import { notify } from '../services/notify.ts';

const Body = z.object({ status: z.enum(CALL_STATUSES), note: z.string().trim().max(280).optional() });

export default async function callsRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now, bus } = deps;

  app.post<{ Params: { id: string } }>('/posts/:id/call-updates', async (req, reply) => {
    const me = requireUser(req);
    const body = parse(Body, req.body);
    const post = await loadPost(db, req.params.id);
    if (!post || !(await canReadPost(db, post, me.id))) throw errors.notFound('Post');
    if (post.authorId !== me.id) throw errors.forbidden('NOT_AUTHOR', 'Only the author can update this call');
    if (post.deletedAt) throw errors.badRequest('POST_DELETED', 'That post was deleted');
    const hasToken = await db.select({ id: tokenMentions.id }).from(tokenMentions)
      .where(and(eq(tokenMentions.sourceType, 'post'), eq(tokenMentions.sourceId, post.id))).limit(1);
    if (!hasToken.length || (post.kind !== 'post' && post.kind !== 'quote')) throw errors.badRequest('NO_TOKEN', 'Call updates need a post that mentions a token');
    const [row] = await db.insert(callUpdates).values({
      id: newId(), postId: post.id, authorId: me.id, status: body.status, note: body.note || null, selfReported: true, createdAt: now(),
    }).returning();
    const update: CallUpdateView = { id: row!.id, status: body.status, note: row!.note, selfReported: true, createdAt: row!.createdAt.toISOString() };
    const subs = await db.select({ u: subscriptions.userId }).from(subscriptions)
      .where(and(eq(subscriptions.targetType, 'post'), eq(subscriptions.targetId, post.id)));
    for (const s of subs) {
      bus.toUser(s.u, 'call:update', { postId: post.id, update });
      if (s.u !== me.id) await notify(deps, { userId: s.u, type: 'call_update', actorId: me.id, targetType: 'post', targetId: post.id, data: { postId: post.id, label: CALL_STATUS_LABELS[body.status] } });
    }
    const [view] = await hydratePosts(db, me.id, [post]);
    return reply.status(201).send({ update, post: view });
  });
}
```
Note the author is auto-subscribed (Task 6), so the author's own clients also receive `call:update`.

- [ ] **Step 3: Register, run, commit**

Register `notificationsRoutes` and `callsRoutes` with `/api` prefix.
Run: `npm test -w @shillex/server && npm run typecheck -w @shillex/server` → PASS.
```bash
git add apps/server
git commit -m "feat(server): notifications api and self-reported call updates"
```
