# Phase 1 — Foundation (Tasks 1–4)

Read the plan index `../2026-10-09-shillex.md` (Global Constraints, Review Focus) and the spec first.

---

### Task 1: Monorepo scaffold and `@shillex/shared`

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/{index,mint,text,links,format,constants,types,events}.ts`
- Test: `packages/shared/test/{mint,text,links,format}.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (imported everywhere as `@shillex/shared`):
  - `isValidSolanaAddress(s: string): boolean`, `isValidMintFormat` (alias)
  - `extractMintCandidates(text: string): { mint: string; start: number; end: number }[]`
  - `uniqueMints(text: string): string[]`
  - `abbreviateMint(mint: string, head = 4, tail = 4): string`
  - `tokenizeBody(text: string): BodySegment[]`, `extractMentions(text: string): string[]` (lowercased usernames)
  - `buildTokenLinks(t: { mint: string; pairAddress: string | null; source: 'demo' | 'live' | null }): ExternalLink[]`
  - `formatUsd`, `formatAge`, `relativeTime`, `formatCount`
  - constants `LIMITS`, `SLOW_MODE_OPTIONS`, `REACTIONS`, `CALL_STATUSES`, `CALL_STATUS_LABELS`, `NOTIFICATION_TYPES`, `IMAGE_MIME_TYPES`, `TOKEN_PROGRAM_ID`, `TOKEN_2022_PROGRAM_ID`, `COPY`
  - all view types in `types.ts`, socket maps in `events.ts`

- [ ] **Step 1: Root workspace files**

`package.json`:
```json
{
  "name": "shillex",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "concurrently -n server,web -c green,cyan \"npm:dev -w @shillex/server\" \"npm:dev -w @shillex/web\"",
    "build": "npm run build -w @shillex/web",
    "start": "npm run start -w @shillex/server",
    "seed": "npm run seed -w @shillex/server",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "e2e": "playwright test -c e2e/playwright.config.ts"
  },
  "devDependencies": {
    "concurrently": "10.0.6",
    "typescript": "5.9.3",
    "@playwright/test": "1.64.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  }
}
```

`.env.example`:
```
# Leave unset to use the embedded PGlite database in ./data/pglite
DATABASE_URL=
SESSION_SECRET=change-me
PORT=3000
PUBLIC_URL=http://localhost:5173
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
LIVE_TOKEN_LOOKUP=on
DEMO_SIMULATOR=on
SEED_ON_EMPTY=on
```

- [ ] **Step 2: Shared package config**

`packages/shared/package.json`:
```json
{
  "name": "@shillex/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "bs58": "6.0.0" },
  "devDependencies": { "vitest": "3.2.7", "typescript": "5.9.3" }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "allowImportingTsExtensions": true },
  "include": ["src", "test"]
}
```
Note: all relative imports inside `packages/shared/src` use the `.ts` extension (e.g. `import { COPY } from './constants.ts'`) so that both Vite and `tsx` resolve them without a build step.

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

Run: `npm install` (from repo root). Expected: installs without errors.

- [ ] **Step 3: Write failing tests for mint parsing**

`packages/shared/test/mint.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isValidSolanaAddress, extractMintCandidates, uniqueMints, abbreviateMint } from '../src/mint.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const WSOL = 'So11111111111111111111111111111111111111112';

describe('isValidSolanaAddress', () => {
  it('accepts real 32-byte addresses', () => {
    expect(isValidSolanaAddress(BONK)).toBe(true);
    expect(isValidSolanaAddress(WSOL)).toBe(true);
  });
  it('rejects non-base58 characters', () => {
    expect(isValidSolanaAddress(BONK.replace('D', '0'))).toBe(false);
    expect(isValidSolanaAddress(BONK.replace('D', 'l'))).toBe(false);
  });
  it('rejects base58 strings that do not decode to 32 bytes', () => {
    expect(isValidSolanaAddress('z'.repeat(44))).toBe(false); // 33 bytes
    expect(isValidSolanaAddress('2'.repeat(32))).toBe(false); // < 32 bytes
    expect(isValidSolanaAddress('abc')).toBe(false);
  });
});

describe('extractMintCandidates', () => {
  it('finds a mint with positions', () => {
    const text = `aping ${BONK} now`;
    expect(extractMintCandidates(text)).toEqual([{ mint: BONK, start: 6, end: 6 + BONK.length }]);
  });
  it('ignores tickers and ordinary words', () => {
    expect(extractMintCandidates('$BONK is pumping, gm frens')).toEqual([]);
  });
  describe('punctuation and URLs (Review Focus #1)', () => {
    it('handles trailing period, parentheses and comma-joined mints', () => {
      expect(uniqueMints(`CA: ${BONK}.`)).toEqual([BONK]);
      expect(uniqueMints(`(${BONK})`)).toEqual([BONK]);
      expect(uniqueMints(`${BONK},${WSOL}`)).toEqual([BONK, WSOL]);
    });
    it('does not extract mints embedded in a URL', () => {
      expect(uniqueMints(`chart https://dexscreener.com/solana/${BONK} lol`)).toEqual([]);
    });
    it('does not match when glued to other alphanumerics', () => {
      expect(uniqueMints(`x${BONK}`)).toEqual([]);
      expect(uniqueMints(`${BONK}0`)).toEqual([]);
    });
    it('rejects 44-char base58 that decodes to 33 bytes', () => {
      expect(uniqueMints(`look ${'z'.repeat(44)} here`)).toEqual([]);
    });
  });
  it('uniqueMints deduplicates and keeps first-seen order', () => {
    expect(uniqueMints(`${WSOL} ${BONK} ${WSOL}`)).toEqual([WSOL, BONK]);
  });
});

describe('abbreviateMint', () => {
  it('keeps head and tail', () => {
    expect(abbreviateMint(BONK)).toBe('DezX…B263');
    expect(abbreviateMint(BONK, 6, 4)).toBe('DezXAZ…B263');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test -w @shillex/shared`
Expected: FAIL — cannot resolve `../src/mint.ts`.

- [ ] **Step 5: Implement `mint.ts`**

`packages/shared/src/mint.ts`:
```ts
import bs58 from 'bs58';

const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const WORD_CHAR = /[A-Za-z0-9_]/;

export function isValidSolanaAddress(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}
export const isValidMintFormat = isValidSolanaAddress;

export interface MintCandidate { mint: string; start: number; end: number }

export function urlSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const trimmed = raw.replace(/[.,;:!?)\]}]+$/, '');
    spans.push([m.index!, m.index! + trimmed.length]);
  }
  return spans;
}

export function extractMintCandidates(text: string): MintCandidate[] {
  const urls = urlSpans(text);
  const out: MintCandidate[] = [];
  for (const m of text.matchAll(BASE58_RUN)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = start > 0 ? text[start - 1]! : '';
    const after = end < text.length ? text[end]! : '';
    if (before && WORD_CHAR.test(before)) continue;
    if (after && WORD_CHAR.test(after)) continue;
    if (urls.some(([s, e]) => start >= s && end <= e)) continue;
    if (!isValidSolanaAddress(m[0])) continue;
    out.push({ mint: m[0], start, end });
  }
  return out;
}

export function uniqueMints(text: string): string[] {
  return [...new Set(extractMintCandidates(text).map((c) => c.mint))];
}

export function abbreviateMint(mint: string, head = 4, tail = 4): string {
  if (mint.length <= head + tail + 1) return mint;
  return `${mint.slice(0, head)}…${mint.slice(-tail)}`;
}
```

- [ ] **Step 6: Run mint tests**

Run: `npm test -w @shillex/shared`
Expected: PASS (mint.test.ts). If the `'2'.repeat(32)` or `'z'.repeat(44)` expectations fail, print `bs58.decode(x).length` and replace the vector with one that decodes to 31 / 33 bytes respectively — the property under test is "≠ 32 bytes is rejected".

- [ ] **Step 7: Failing tests for `text.ts`**

`packages/shared/test/text.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tokenizeBody, extractMentions } from '../src/text.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

describe('tokenizeBody', () => {
  it('splits text, mentions, urls and mints in order', () => {
    const segs = tokenizeBody(`gm @alpha_jane check ${BONK}. https://x.com/a`);
    expect(segs).toEqual([
      { type: 'text', text: 'gm ' },
      { type: 'mention', text: '@alpha_jane', username: 'alpha_jane' },
      { type: 'text', text: ' check ' },
      { type: 'mint', text: BONK, mint: BONK },
      { type: 'text', text: '. ' },
      { type: 'url', text: 'https://x.com/a', href: 'https://x.com/a' },
    ]);
  });
  it('keeps a mint inside a url as part of the url', () => {
    const segs = tokenizeBody(`https://dexscreener.com/solana/${BONK}`);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.type).toBe('url');
  });
  it('does not treat emails as mentions', () => {
    expect(tokenizeBody('mail me a@bcd.com')).toEqual([{ type: 'text', text: 'mail me a@bcd.com' }]);
  });
  it('returns [] for empty input', () => {
    expect(tokenizeBody('')).toEqual([]);
  });
});

describe('extractMentions', () => {
  it('returns unique lowercased usernames', () => {
    expect(extractMentions('@Alpha_Jane and @alpha_jane and @bob_99')).toEqual(['alpha_jane', 'bob_99']);
  });
  it('ignores too-short handles', () => {
    expect(extractMentions('@ab hi')).toEqual([]);
  });
});
```

- [ ] **Step 8: Implement `text.ts`**

`packages/shared/src/text.ts`:
```ts
import { extractMintCandidates, urlSpans } from './mint.ts';

export type BodySegment =
  | { type: 'text'; text: string }
  | { type: 'url'; text: string; href: string }
  | { type: 'mention'; text: string; username: string }
  | { type: 'mint'; text: string; mint: string };

const MENTION_RE = /(?<![A-Za-z0-9_.])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g;

interface Span { start: number; end: number; seg: BodySegment }

export function tokenizeBody(text: string): BodySegment[] {
  if (!text) return [];
  const spans: Span[] = [];
  for (const [start, end] of urlSpans(text)) {
    const t = text.slice(start, end);
    spans.push({ start, end, seg: { type: 'url', text: t, href: t } });
  }
  const inside = (s: number, e: number) => spans.some((x) => s < x.end && e > x.start);
  for (const c of extractMintCandidates(text)) {
    if (!inside(c.start, c.end)) spans.push({ start: c.start, end: c.end, seg: { type: 'mint', text: c.mint, mint: c.mint } });
  }
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!inside(start, end)) spans.push({ start, end, seg: { type: 'mention', text: m[0], username: m[1]! } });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: BodySegment[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ type: 'text', text: text.slice(pos, s.start) });
    out.push(s.seg);
    pos = s.end;
  }
  if (pos < text.length) out.push({ type: 'text', text: text.slice(pos) });
  return out;
}

export function extractMentions(text: string): string[] {
  const set = new Set<string>();
  for (const seg of tokenizeBody(text)) if (seg.type === 'mention') set.add(seg.username.toLowerCase());
  return [...set];
}

export function codePointLength(s: string): number {
  return [...s].length;
}
```

Export `urlSpans` from `mint.ts` (already `export`ed in Step 5).

- [ ] **Step 9: Constants, links, format — failing tests**

`packages/shared/test/links.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTokenLinks } from '../src/links.ts';
import { COPY } from '../src/constants.ts';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PAIR = '5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9';

describe('buildTokenLinks', () => {
  it('builds verified formats for live tokens with a pair', () => {
    const links = buildTokenLinks({ mint: BONK, pairAddress: PAIR, source: 'live' });
    expect(links.map((l) => [l.id, l.url])).toEqual([
      ['axiom', `https://axiom.trade/meme/${PAIR}?chain=sol`],
      ['gmgn', `https://gmgn.ai/sol/token/${BONK}`],
      ['dexscreener', `https://dexscreener.com/solana/${BONK}`],
      ['solscan', `https://solscan.io/token/${BONK}`],
    ]);
    expect(links.every((l) => l.unavailableReason === null)).toBe(true);
  });
  it('disables axiom without a pair', () => {
    const axiom = buildTokenLinks({ mint: BONK, pairAddress: null, source: 'live' })[0]!;
    expect(axiom.url).toBeNull();
    expect(axiom.unavailableReason).toBe(COPY.axiomNoPair);
  });
  it('disables every link for demo tokens', () => {
    const links = buildTokenLinks({ mint: BONK, pairAddress: PAIR, source: 'demo' });
    expect(links.every((l) => l.url === null && l.unavailableReason === COPY.demoLinkReason)).toBe(true);
  });
  it('throws on an invalid mint or pair', () => {
    expect(() => buildTokenLinks({ mint: 'nope', pairAddress: null, source: 'live' })).toThrow();
    expect(() => buildTokenLinks({ mint: BONK, pairAddress: 'bad/../x', source: 'live' })).toThrow();
  });
});
```

`packages/shared/test/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatUsd, formatAge, formatCount } from '../src/format.ts';

describe('formatUsd', () => {
  it('formats compact values and unknowns', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(950)).toBe('$950');
    expect(formatUsd(12_340)).toBe('$12.3K');
    expect(formatUsd(4_500_000)).toBe('$4.5M');
    expect(formatUsd(2_100_000_000)).toBe('$2.1B');
  });
});
describe('formatAge', () => {
  const now = new Date('2026-10-09T12:00:00Z').getTime();
  it('formats durations', () => {
    expect(formatAge('2026-10-09T11:59:30Z', now)).toBe('<1m');
    expect(formatAge('2026-10-09T11:48:00Z', now)).toBe('12m');
    expect(formatAge('2026-10-09T07:00:00Z', now)).toBe('5h');
    expect(formatAge('2026-10-06T12:00:00Z', now)).toBe('3d');
    expect(formatAge('2026-07-01T12:00:00Z', now)).toBe('3mo');
    expect(formatAge('2024-10-01T12:00:00Z', now)).toBe('2y');
    expect(formatAge(null, now)).toBe('—');
  });
});
describe('formatCount', () => {
  it('compacts', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1200)).toBe('1.2K');
  });
});
```

- [ ] **Step 10: Implement `constants.ts`, `links.ts`, `format.ts`**

`packages/shared/src/constants.ts`:
```ts
export const LIMITS = {
  postMax: 1000,
  messageMax: 2000,
  maxImages: 4,
  uploadBytes: 5 * 1024 * 1024,
  groupMax: 20,
  profileLinksMax: 5,
  newAccountLinkMentionCap: 2,
  messageRateCount: 10,
  messageRateWindowMs: 10_000,
  duplicateWindowMs: 60_000,
  newAccountMs: 24 * 60 * 60 * 1000,
} as const;

export const SLOW_MODE_OPTIONS = [0, 5, 15, 30, 60, 300] as const;
export const REACTIONS = ['🔥', '🚀', '👀', '💀', '😂', '🫡'] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

export const CALL_STATUSES = ['watching', 'bought', 'taking_profit', 'out', 'thesis_changed'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  watching: 'Watching',
  bought: 'Bought',
  taking_profit: 'Taking profit',
  out: 'Out',
  thesis_changed: 'Thesis changed',
};

export const NOTIFICATION_TYPES = [
  'reply', 'mention', 'follow', 'reaction', 'quote', 'repost', 'dm',
  'call_update', 'token_discussion', 'invite', 'join_request', 'report_resolved',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const COPY = {
  selfReported: 'self-reported',
  demoTag: 'DEMO',
  promoted: 'Promoted',
  tokenPanelNote: 'Mentions measure discussion, not quality. Do your own research.',
  discoveryNote: 'Listed by recency. Mentions are not an endorsement.',
  holdingsNote: 'Not verified — wallet connection is not implemented in this build',
  demoLinkReason: 'Fictional demo token — not on-chain',
  axiomNoPair: 'Axiom needs a trading pair address; none found yet',
  liveLookupDisabled: 'Live lookup disabled',
} as const;
```

`packages/shared/src/links.ts`:
```ts
import { isValidSolanaAddress } from './mint.ts';
import { COPY } from './constants.ts';

export type ExternalLinkId = 'axiom' | 'gmgn' | 'dexscreener' | 'solscan';
export interface ExternalLink { id: ExternalLinkId; label: string; url: string | null; unavailableReason: string | null }

export function buildTokenLinks(t: { mint: string; pairAddress: string | null; source: 'demo' | 'live' | null }): ExternalLink[] {
  if (!isValidSolanaAddress(t.mint)) throw new Error(`invalid mint: ${t.mint}`);
  if (t.pairAddress !== null && !isValidSolanaAddress(t.pairAddress)) throw new Error(`invalid pair: ${t.pairAddress}`);
  const m = encodeURIComponent(t.mint);
  const demo = t.source === 'demo';
  const link = (id: ExternalLinkId, label: string, url: string | null, missing: string): ExternalLink =>
    demo ? { id, label, url: null, unavailableReason: COPY.demoLinkReason }
      : url ? { id, label, url, unavailableReason: null }
      : { id, label, url: null, unavailableReason: missing };
  return [
    link('axiom', 'Axiom', t.pairAddress ? `https://axiom.trade/meme/${encodeURIComponent(t.pairAddress)}?chain=sol` : null, COPY.axiomNoPair),
    link('gmgn', 'GMGN', `https://gmgn.ai/sol/token/${m}`, ''),
    link('dexscreener', 'Dexscreener', `https://dexscreener.com/solana/${m}`, ''),
    link('solscan', 'Solscan', `https://solscan.io/token/${m}`, ''),
  ];
}
```

`packages/shared/src/format.ts`:
```ts
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const fmt = (v: number, s: string) => `$${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e3) return fmt(n / 1e3, 'K');
  return `$${Math.round(n)}`;
}

export function formatAge(from: string | Date | null | undefined, now: number = Date.now()): string {
  if (!from) return '—';
  const ms = now - new Date(from).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export function relativeTime(from: string | Date, now: number = Date.now()): string {
  const a = formatAge(from, now);
  return a === '<1m' ? 'now' : a;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(Math.round(n / 100) / 10).toString()}K`;
  return `${(Math.round(n / 1e5) / 10).toString()}M`;
}
```

- [ ] **Step 11: Types and socket events**

`packages/shared/src/types.ts`:
```ts
import type { CallStatus, NotificationType, ReactionEmoji } from './constants.ts';

export type Iso = string;
export type CommunityVisibility = 'public' | 'private' | 'invite';
export type MemberRole = 'owner' | 'mod' | 'member';
export type MemberStatus = 'active' | 'pending' | 'banned';

export interface ApiErrorBody { code: string; message: string; details?: unknown }
export interface Page<T> { items: T[]; nextCursor: string | null; tokens?: Record<string, TokenView> }

export interface UserSummary {
  id: string; username: string; displayName: string; avatarUrl: string; isDemo: boolean;
}
export interface UserProfile extends UserSummary {
  bannerUrl: string | null; bio: string; links: { label: string; url: string }[]; createdAt: Iso;
  followers: number; following: number;
  isSelf: boolean; isFollowing: boolean; followsYou: boolean; isMuted: boolean; isBlocked: boolean;
  wallet: { address: string; showHoldings: boolean; verified: false } | null;
}
export interface MeView extends UserSummary { unreadNotifications: number; createdAt: Iso }

/** `userIds` is set for message reactions (broadcast to many viewers; clients derive `mine` from it). */
export interface ReactionSummary { emoji: ReactionEmoji; count: number; mine: boolean; userIds?: string[] }
export interface MediaView { url: string; width: number; height: number; alt: string }
export interface CallUpdateView { id: string; status: CallStatus; note: string | null; selfReported: true; createdAt: Iso }
export interface CommunityRef { id: string; slug: string; name: string; visibility: CommunityVisibility }

export interface PostView {
  id: string;
  kind: 'post' | 'reply' | 'repost' | 'quote';
  author: UserSummary;
  body: string;
  createdAt: Iso;
  deleted: boolean;
  parentId: string | null;
  rootId: string | null;
  replyTo: { id: string; author: UserSummary } | null;
  community: CommunityRef | null;
  media: MediaView[];
  quoted: PostView | null;      // one level deep; quoted.quoted is always null
  reposted: PostView | null;    // for kind 'repost'
  counts: { replies: number; reposts: number; quotes: number };
  reactions: ReactionSummary[];
  viewer: { bookmarked: boolean; reposted: boolean; subscribed: boolean; canAddCallUpdate: boolean };
  mints: string[];
  callUpdates: CallUpdateView[];
}
export interface ThreadView { post: PostView; ancestors: PostView[]; replies: PostView[]; tokens: Record<string, TokenView> }

export type TokenStatus = 'pending' | 'resolved' | 'unindexed' | 'not_a_token' | 'error';
export interface TokenView {
  mint: string;
  status: TokenStatus;
  source: 'demo' | 'live' | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  decimals: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  pairAddress: string | null;
  dexId: string | null;
  pairCreatedAt: Iso | null;
  promoted: boolean;
  fetchedAt: Iso | null;
  error: string | null;
}
export interface TokenDiscussionStats { mentions24h: number; posts24h: number; chat24h: number; subscribed: boolean }
export interface PublicChatMention {
  message: MessageView;
  community: CommunityRef;
  channel: { id: string; name: string };
}

export interface CommunitySummary {
  id: string; slug: string; name: string; description: string; avatarUrl: string;
  visibility: CommunityVisibility; memberCount: number; onlineCount: number;
  myRole: MemberRole | null; myStatus: MemberStatus | null; unread: number; isDemo: boolean;
}
export interface ChannelView {
  id: string; communityId: string; name: string; topic: string; position: number;
  slowModeSeconds: number; holdNewMemberPosts: boolean; unread: number; lastMessageId: string | null;
}
export interface CommunityDetail {
  community: CommunitySummary;
  bannerUrl: string | null; rules: string; createdAt: Iso;
  owner: UserSummary | null; moderators: UserSummary[]; // both hidden (null / []) for non-members of private communities
  canRead: boolean; canPost: boolean; isMod: boolean;
  channels: ChannelView[];
}
export interface MemberView { user: UserSummary; role: MemberRole; status: MemberStatus; online: boolean; joinedAt: Iso }
export interface PinView { id: string; channelId: string | null; post: PostView | null; message: MessageView | null; createdAt: Iso }
export interface InviteView { code: string; url: string; expiresAt: Iso | null; maxUses: number | null; uses: number }

export type ScopeRef = { type: 'channel' | 'conversation'; id: string };
export type Attachment =
  | { type: 'image'; url: string; width: number; height: number; alt: string }
  | { type: 'token'; mint: string };
export interface MessageView {
  id: string;
  scope: ScopeRef;
  author: UserSummary;
  body: string;
  replyTo: { id: string; author: UserSummary; snippet: string; deleted: boolean } | null;
  attachments: Attachment[];
  reactions: ReactionSummary[];
  status: 'visible' | 'held' | 'deleted';
  mints: string[];
  createdAt: Iso;
  nonce: string | null;
}
export interface ConversationView {
  id: string; kind: 'dm' | 'group'; name: string | null; members: UserSummary[];
  lastMessage: MessageView | null; unread: number; muted: boolean; createdAt: Iso;
}

export interface NotificationView {
  id: string; type: NotificationType; actor: UserSummary | null;
  target: { type: 'post' | 'message' | 'user' | 'community' | 'token' | 'report'; id: string };
  text: string; href: string; read: boolean; createdAt: Iso;
}
export interface NotificationPref { type: NotificationType; enabled: boolean }

export interface SettingsView {
  profile: { displayName: string; bio: string; links: { label: string; url: string }[]; avatarUrl: string; bannerUrl: string | null };
  wallet: { address: string; displayWallet: boolean; displayHoldings: boolean; verified: false } | null;
  notificationPrefs: NotificationPref[];
}

export interface LiveRoomView {
  community: CommunityRef & { avatarUrl: string }; channel: { id: string; name: string };
  messagesLast15m: number; onlineCount: number; lastActivityAt: Iso;
}
export interface PersonSuggestion { user: UserSummary; bio: string; followers: number; reason: string }
export interface NewCoinView { token: TokenView; firstMentionAt: Iso; mentions24h: number; promoted: boolean }
export interface DiscoverView {
  liveRooms: LiveRoomView[]; communities: CommunitySummary[]; people: PersonSuggestion[];
  newCoins: NewCoinView[]; promoted: NewCoinView[];
}
export interface SidebarView { liveRooms: LiveRoomView[]; people: PersonSuggestion[]; newCoins: NewCoinView[]; promoted: NewCoinView | null; demoSimulator: boolean }
export interface UploadView { id: string; url: string; width: number; height: number; mime: string }
export interface ReportView {
  id: string; reporter: UserSummary; targetType: 'post' | 'message' | 'user'; targetId: string;
  reason: string; status: 'open' | 'resolved' | 'dismissed'; createdAt: Iso;
  preview: { author: UserSummary | null; body: string } | null;
}
export interface MessageSearchHit { message: MessageView; conversation: { id: string; name: string } }
```

`packages/shared/src/events.ts`:
```ts
import type { CallUpdateView, MessageView, NotificationView, ScopeRef, TokenView, UserSummary } from './types.ts';

export type RoomScope = 'channel' | 'conversation' | 'community' | 'token';

export interface ServerToClientEvents {
  'message:new': (p: { message: MessageView; tokens: Record<string, TokenView>; nonce?: string | null }) => void;
  'message:update': (p: { message: MessageView }) => void;
  'channel:activity': (p: { communityId: string; channelId: string; messageId: string; authorId: string; mentions: string[] }) => void;
  typing: (p: { scope: ScopeRef; user: UserSummary }) => void;
  presence: (p: { userId: string; online: boolean }) => void;
  'notification:new': (p: { notification: NotificationView; unreadCount: number }) => void;
  'post:new': (p: { postId: string; authorId: string }) => void;
  'call:update': (p: { postId: string; update: CallUpdateView }) => void;
  'token:resolved': (p: { token: TokenView }) => void;
  'conversation:update': (p: { conversationId: string }) => void;
  'community:update': (p: { communityId: string }) => void;
}

export type SubscribeAck = { ok: true } | { ok: false; code: string };

export interface ClientToServerEvents {
  subscribe: (p: { scope: RoomScope; id: string }, ack: (r: SubscribeAck) => void) => void;
  unsubscribe: (p: { scope: RoomScope; id: string }) => void;
  typing: (p: { scope: 'channel' | 'conversation'; id: string }) => void;
}
```

`packages/shared/src/index.ts`:
```ts
export * from './mint.ts';
export * from './text.ts';
export * from './links.ts';
export * from './format.ts';
export * from './constants.ts';
export * from './types.ts';
export * from './events.ts';
```

- [ ] **Step 12: Run all shared tests and typecheck**

Run: `npm test -w @shillex/shared && npm run typecheck -w @shillex/shared`
Expected: all PASS; tsc exits 0.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .env.example packages/shared
git commit -m "feat(shared): mint parsing, body tokenizer, link builders, view types"
```

---

### Task 2: Server package, database schema, migrations

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/drizzle.config.ts`
- Create: `apps/server/src/db/schema.ts`, `apps/server/src/db/client.ts`, `apps/server/src/lib/ids.ts`
- Generate: `apps/server/drizzle/*.sql`
- Test: `apps/server/test/db.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 except types.
- Produces:
  - `type Db = PgDatabase<PgQueryResultHKT, typeof schema>`; `createDb(opts: { url?: string; pgliteDir?: string }): Promise<{ db: Db; close(): Promise<void> }>` (no `url` and no `pgliteDir` → in-memory PGlite)
  - Every table exported from `schema.ts` with the names below; row types `UserRow = typeof users.$inferSelect` etc.
  - `newId(): string` (monotonic ULID)

- [ ] **Step 1: Package config**

`apps/server/package.json`:
```json
{
  "name": "@shillex/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=../../.env src/index.ts",
    "start": "tsx --env-file-if-exists=../../.env src/index.ts",
    "seed": "tsx --env-file-if-exists=../../.env src/seed/cli.ts",
    "db:generate": "drizzle-kit generate",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@electric-sql/pglite": "0.5.8",
    "@fastify/cookie": "11.1.3",
    "@fastify/multipart": "10.1.3",
    "@fastify/rate-limit": "11.2.1",
    "@fastify/static": "10.1.5",
    "@node-rs/argon2": "2.2.2",
    "@shillex/shared": "*",
    "drizzle-orm": "0.45.4",
    "fastify": "5.12.5",
    "pg": "8.23.1",
    "socket.io": "4.8.4",
    "tsx": "4.23.15",
    "ulidx": "2.4.1",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "@types/pg": "8.23.1",
    "drizzle-kit": "0.31.11",
    "socket.io-client": "4.8.4",
    "typescript": "5.9.3",
    "vitest": "3.2.7"
  }
}
```
`tsx` is a runtime dependency because `start` runs TypeScript directly (documented in README, Task 26).

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "NodeNext", "moduleResolution": "NodeNext", "allowImportingTsExtensions": true, "types": ["node"] },
  "include": ["src", "test", "drizzle.config.ts", "vitest.config.ts"]
}
```
All relative imports in `apps/server` use `.ts` extensions.

`apps/server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 30_000, pool: 'forks' } });
```

`apps/server/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'postgresql', schema: './src/db/schema.ts', out: './drizzle' });
```

Run: `npm install` at root.

- [ ] **Step 2: Ids**

`apps/server/src/lib/ids.ts`:
```ts
import { monotonicFactory } from 'ulidx';
const ulid = monotonicFactory();
export const newId = (): string => ulid();
```

- [ ] **Step 3: Schema**

`apps/server/src/db/schema.ts`:
```ts
import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, timestamp, jsonb, doublePrecision, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  avatarUrl: text('avatar_url'),
  bannerUrl: text('banner_url'),
  bio: text('bio').notNull().default(''),
  links: jsonb('links').$type<{ label: string; url: string }[]>().notNull().default([]),
  createdAt: ts('created_at').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull(),
});

export const follows = pgTable('follows', {
  followerId: text('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  followeeId: text('followee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index('follows_followee_idx').on(t.followeeId)]);

export const blocks = pgTable('blocks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.targetId] }), index('blocks_target_idx').on(t.targetId)]);

export const mutes = pgTable('mutes', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: text('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.targetId] })]);

export const walletLinks = pgTable('wallet_links', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  displayWallet: boolean('display_wallet').notNull().default(false),
  displayHoldings: boolean('display_holdings').notNull().default(false),
  verified: boolean('verified').notNull().default(false),
});

export const uploads = pgTable('uploads', {
  id: text('id').primaryKey(),
  uploaderId: text('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  mime: text('mime').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  createdAt: ts('created_at').notNull(),
});

// Spec §3 lists a post_media table; media is stored as jsonb on posts instead (same data, fewer joins).
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'post' | 'reply' | 'repost' | 'quote'>().notNull(),
  body: text('body').notNull().default(''),
  parentId: text('parent_id'),
  rootId: text('root_id'),
  quoteOfId: text('quote_of_id'),
  repostOfId: text('repost_of_id'),
  communityId: text('community_id'),
  visibility: text('visibility').$type<'public' | 'community'>().notNull(),
  media: jsonb('media').$type<{ url: string; width: number; height: number; alt: string }[]>().notNull().default([]),
  createdAt: ts('created_at').notNull(),
  deletedAt: ts('deleted_at'),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('posts_author_idx').on(t.authorId, t.id),
  index('posts_parent_idx').on(t.parentId),
  index('posts_root_idx').on(t.rootId),
  index('posts_community_idx').on(t.communityId, t.id),
  index('posts_quote_idx').on(t.quoteOfId),
  index('posts_repost_idx').on(t.repostOfId),
]);

export const reactions = pgTable('reactions', {
  targetType: text('target_type').$type<'post' | 'message'>().notNull(),
  targetId: text('target_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: text('emoji').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.targetType, t.targetId, t.userId, t.emoji] }), index('reactions_target_idx').on(t.targetType, t.targetId)]);

export const bookmarks = pgTable('bookmarks', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  postId: text('post_id').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.postId] })]);

export const callUpdates = pgTable('call_updates', {
  id: text('id').primaryKey(),
  postId: text('post_id').notNull(),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  note: text('note'),
  selfReported: boolean('self_reported').notNull().default(true),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('call_updates_post_idx').on(t.postId)]);

export const communities = pgTable('communities', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  avatarUrl: text('avatar_url'),
  bannerUrl: text('banner_url'),
  visibility: text('visibility').$type<'public' | 'private' | 'invite'>().notNull(),
  ownerId: text('owner_id').notNull().references(() => users.id),
  rules: text('rules').notNull().default(''),
  createdAt: ts('created_at').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
});

export const communityMembers = pgTable('community_members', {
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'owner' | 'mod' | 'member'>().notNull(),
  status: text('status').$type<'active' | 'pending' | 'banned'>().notNull(),
  joinedAt: ts('joined_at').notNull(),
}, (t) => [primaryKey({ columns: [t.communityId, t.userId] }), index('members_user_idx').on(t.userId)]);

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id),
  expiresAt: ts('expires_at'),
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  createdAt: ts('created_at').notNull(),
});

export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  topic: text('topic').notNull().default(''),
  position: integer('position').notNull().default(0),
  slowModeSeconds: integer('slow_mode_seconds').notNull().default(0),
  holdNewMemberPosts: boolean('hold_new_member_posts').notNull().default(false),
}, (t) => [index('channels_community_idx').on(t.communityId)]);

export const pins = pgTable('pins', {
  id: text('id').primaryKey(),
  communityId: text('community_id').notNull().references(() => communities.id, { onDelete: 'cascade' }),
  channelId: text('channel_id'),
  targetType: text('target_type').$type<'post' | 'message'>().notNull(),
  targetId: text('target_id').notNull(),
  pinnedBy: text('pinned_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'dm' | 'group'>().notNull(),
  name: text('name'),
  dmKey: text('dm_key').unique(), // "<smallerUserId>:<largerUserId>" for DMs, null for groups
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: ts('created_at').notNull(),
});

export const conversationMembers = pgTable('conversation_members', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull(),
  muted: boolean('muted').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conv_members_user_idx').on(t.userId)]);

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id'),
  conversationId: text('conversation_id'),
  authorId: text('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull().default(''),
  replyToId: text('reply_to_id'),
  attachments: jsonb('attachments').$type<
    ({ type: 'image'; url: string; width: number; height: number; alt: string } | { type: 'token'; mint: string })[]
  >().notNull().default([]),
  status: text('status').$type<'visible' | 'held' | 'deleted'>().notNull().default('visible'),
  createdAt: ts('created_at').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
}, (t) => [
  index('messages_channel_idx').on(t.channelId, t.id),
  index('messages_conversation_idx').on(t.conversationId, t.id),
  index('messages_author_idx').on(t.authorId, t.createdAt),
]);

export const readMarkers = pgTable('read_markers', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopeType: text('scope_type').$type<'channel' | 'conversation'>().notNull(),
  scopeId: text('scope_id').notNull(),
  lastReadMessageId: text('last_read_message_id').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.scopeType, t.scopeId] })]);

export const tokens = pgTable('tokens', {
  mint: text('mint').primaryKey(),
  source: text('source').$type<'demo' | 'live'>(),
  status: text('status').$type<'resolved' | 'unindexed' | 'not_a_token' | 'error'>().notNull(),
  name: text('name'),
  symbol: text('symbol'),
  imageUrl: text('image_url'),
  decimals: integer('decimals'),
  liquidityUsd: doublePrecision('liquidity_usd'),
  marketCapUsd: doublePrecision('market_cap_usd'),
  fdvUsd: doublePrecision('fdv_usd'),
  pairAddress: text('pair_address'),
  dexId: text('dex_id'),
  pairCreatedAt: ts('pair_created_at'),
  promoted: boolean('promoted').notNull().default(false),
  fetchedAt: ts('fetched_at'),
  metaFetchedAt: ts('meta_fetched_at'),
  error: text('error'),
});

export const tokenMentions = pgTable('token_mentions', {
  id: text('id').primaryKey(),
  mint: text('mint').notNull(),
  sourceType: text('source_type').$type<'post' | 'message'>().notNull(),
  sourceId: text('source_id').notNull(),
  authorId: text('author_id').notNull(),
  communityId: text('community_id'),
  channelId: text('channel_id'),
  isPublic: boolean('is_public').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [
  uniqueIndex('mentions_source_mint_idx').on(t.sourceType, t.sourceId, t.mint),
  index('mentions_mint_public_idx').on(t.mint, t.isPublic, t.createdAt),
  index('mentions_public_created_idx').on(t.isPublic, t.createdAt),
]);

export const subscriptions = pgTable('subscriptions', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type').$type<'post' | 'token'>().notNull(),
  targetId: text('target_id').notNull(),
  createdAt: ts('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.targetType, t.targetId] }), index('subs_target_idx').on(t.targetType, t.targetId)]);

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actorId: text('actor_id'),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.id)]);

export const notificationPrefs = pgTable('notification_prefs', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  enabled: boolean('enabled').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.type] })]);

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type').$type<'post' | 'message' | 'user'>().notNull(),
  targetId: text('target_id').notNull(),
  communityId: text('community_id'),
  reason: text('reason').notNull(),
  status: text('status').$type<'open' | 'resolved' | 'dismissed'>().notNull().default('open'),
  resolvedBy: text('resolved_by'),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('reports_community_idx').on(t.communityId, t.status)]);

export type UserRow = typeof users.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
export type MemberRow = typeof communityMembers.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
```

- [ ] **Step 4: Generate migrations**

Run: `npm run db:generate -w @shillex/server`
Expected: `apps/server/drizzle/0000_*.sql` and `meta/` created. Open the SQL and confirm `users_username_lower_idx` uses `lower("username")`.

- [ ] **Step 5: Failing DB test**

`apps/server/test/db.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createDb } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';

describe('createDb (in-memory PGlite)', async () => {
  const h = await createDb({});
  afterAll(() => h.close());

  it('runs migrations and round-trips a user', async () => {
    const id = newId();
    await h.db.insert(users).values({ id, username: 'Alpha', displayName: 'Alpha', createdAt: new Date() });
    const rows = await h.db.select().from(users);
    expect(rows.map((r) => r.username)).toContain('Alpha');
  });

  it('enforces case-insensitive unique usernames', async () => {
    await expect(
      h.db.insert(users).values({ id: newId(), username: 'alpha', displayName: 'x', createdAt: new Date() }),
    ).rejects.toThrow();
  });

  it('newId is monotonic', () => {
    const a = newId(); const b = newId();
    expect(a < b).toBe(true);
  });
});
```

Run: `npm test -w @shillex/server` → Expected: FAIL (client.ts missing).

- [ ] **Step 6: Implement `client.ts`**

`apps/server/src/db/client.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export interface DbHandle { db: Db; close(): Promise<void>; kind: 'pglite' | 'postgres' }

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function createDb(opts: { url?: string; pgliteDir?: string }): Promise<DbHandle> {
  if (opts.url) {
    const pg = (await import('pg')).default;
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder });
    return { db: db as unknown as Db, close: () => pool.end(), kind: 'postgres' };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close(), kind: 'pglite' };
}
```

- [ ] **Step 7: Run tests**

Run: `npm test -w @shillex/server`
Expected: PASS. If PGlite 0.5 rejects the constructor form, check `node_modules/@electric-sql/pglite/dist/index.d.ts` for the constructor signature and adapt (e.g. `await PGlite.create(dir)`), keeping `createDb`'s signature unchanged.

- [ ] **Step 8: Commit**

```bash
git add apps/server package-lock.json
git commit -m "feat(server): drizzle schema, migrations, PGlite/Postgres client"
```

---

### Task 3: App factory, errors, config, deps, auth

**Files:**
- Create: `apps/server/src/config.ts`, `src/deps.ts`, `src/app.ts`, `src/index.ts`
- Create: `src/lib/errors.ts`, `src/lib/validate.ts`, `src/lib/auth.ts`, `src/lib/pagination.ts`
- Create: `src/realtime/bus.ts`, `src/services/presence.ts`, `src/services/users.ts`
- Create: `src/routes/auth.ts`
- Create: `test/helpers.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `createDb`, `Db`, schema tables, `newId` (Task 2).
- Produces:
  - `loadConfig(env?: Record<string, string | undefined>): Config`
  - `interface EventBus { toRoom(room: string, event: string, payload: unknown): void; toUser(userId: string, event: string, payload: unknown): void; evict(userId: string, room: string): void }`
  - `class RecordingBus implements EventBus { events: { target: string; event: string; payload: any }[]; evictions: { userId: string; room: string }[]; clear(): void; find(event: string): any[] }`
  - `interface TokenResolverPort { enqueue(mints: string[]): void; resolve(mint: string): Promise<TokenView>; getViews(mints: string[]): Promise<Record<string, TokenView>> }` — `getViews` reads DB only (no network), returning `pending` views for unknown mints and calling `enqueue` for them.
  - `interface PresenceRegistry { connect(userId: string, socketId: string): boolean; disconnect(userId: string, socketId: string): boolean; isOnline(userId: string): boolean; countOnline(userIds: string[]): number }` (connect/disconnect return true when online status changed); `class InMemoryPresence`.
  - `interface AppDeps { db: Db; dbKind: 'pglite' | 'postgres'; config: Config; bus: EventBus; tokens: TokenResolverPort; presence: PresenceRegistry; now: () => Date }`
  - `buildApp(deps: AppDeps): Promise<FastifyInstance>` with `app.deps`, `req.user: UserRow | null`
  - `AppError`, `errors.*`, `parse(schema, data)`, `requireUser(req): UserRow`
  - `toUserSummary(row: UserRow): UserSummary`, `avatarFor(row)` (in `services/users.ts`)
  - `createSession(db, userId, now): Promise<string /* raw token */>`; `SESSION_COOKIE = 'sx_session'`
  - test helper `makeTestApp()` (see Step 7)

- [ ] **Step 1: Config**

`apps/server/src/config.ts`:
```ts
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string | undefined;
  pgliteDir: string;
  sessionSecret: string;
  publicUrl: string;
  allowedOrigins: string[];
  solanaRpcUrl: string;
  liveTokenLookup: boolean;
  demoSimulator: boolean;
  seedOnEmpty: boolean;
  uploadsDir: string;
  webDistDir: string;
}

const on = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : ['on', 'true', '1', 'yes'].includes(v.toLowerCase()));

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = (env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development') as Config['nodeEnv'];
  const port = Number(env.PORT ?? 3000);
  const publicUrl = env.PUBLIC_URL || `http://localhost:${nodeEnv === 'production' ? port : 5173}`;
  if (nodeEnv === 'production' && (!env.SESSION_SECRET || env.SESSION_SECRET === 'change-me')) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR || `${root}data/pglite`,
    sessionSecret: env.SESSION_SECRET || 'dev-secret',
    publicUrl,
    allowedOrigins: [publicUrl, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    solanaRpcUrl: env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    liveTokenLookup: on(env.LIVE_TOKEN_LOOKUP, nodeEnv !== 'test'),
    demoSimulator: on(env.DEMO_SIMULATOR, nodeEnv === 'development'),
    seedOnEmpty: on(env.SEED_ON_EMPTY, nodeEnv !== 'test'),
    uploadsDir: env.UPLOADS_DIR || `${root}data/uploads`,
    webDistDir: `${root}apps/web/dist`,
  };
}
```

- [ ] **Step 2: Errors, validate, pagination**

`apps/server/src/lib/errors.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const errors = {
  badRequest: (code: string, message: string, details?: unknown) => new AppError(400, code, message, details),
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'Sign in to continue'),
  forbidden: (code = 'FORBIDDEN', message = 'You do not have access to this') => new AppError(403, code, message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  tooMany: (code: string, message: string, retryAfterSec?: number) => new AppError(429, code, message, retryAfterSec ? { retryAfterSec } : undefined),
};

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ code: 'VALIDATION', message: 'Invalid input', details: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Too many requests, slow down' });
    if (status && status < 500) return reply.status(status).send({ code: 'BAD_REQUEST', message: err.message });
    app.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong' });
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' });
    return reply.callNotFound();
  });
}
```

`apps/server/src/lib/validate.ts`:
```ts
import type { z } from 'zod';
import { errors } from './errors.ts';
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw errors.badRequest('VALIDATION', 'Invalid input', r.error.issues);
  return r.data;
}
```

`apps/server/src/lib/pagination.ts`:
```ts
export function clampLimit(raw: unknown, def = 30, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}
```

- [ ] **Step 3: Deps, bus, presence, user helpers**

`apps/server/src/deps.ts`:
```ts
import type { TokenView } from '@shillex/shared';
import type { Db } from './db/client.ts';
import type { Config } from './config.ts';

export interface EventBus {
  toRoom(room: string, event: string, payload: unknown): void;
  toUser(userId: string, event: string, payload: unknown): void;
  evict(userId: string, room: string): void;
}
export interface TokenResolverPort {
  enqueue(mints: string[]): void;
  resolve(mint: string): Promise<TokenView>;
  getViews(mints: string[]): Promise<Record<string, TokenView>>;
}
export interface PresenceRegistry {
  connect(userId: string, socketId: string): boolean;
  disconnect(userId: string, socketId: string): boolean;
  isOnline(userId: string): boolean;
  countOnline(userIds: string[]): number;
}
export interface AppDeps { db: Db; dbKind: 'pglite' | 'postgres'; config: Config; bus: EventBus; tokens: TokenResolverPort; presence: PresenceRegistry; now: () => Date }
```

`apps/server/src/realtime/bus.ts`:
```ts
import type { EventBus } from '../deps.ts';

export class RecordingBus implements EventBus {
  events: { target: string; event: string; payload: any }[] = [];
  evictions: { userId: string; room: string }[] = [];
  toRoom(room: string, event: string, payload: unknown) { this.events.push({ target: room, event, payload }); }
  toUser(userId: string, event: string, payload: unknown) { this.events.push({ target: `user:${userId}`, event, payload }); }
  evict(userId: string, room: string) { this.evictions.push({ userId, room }); }
  find(event: string) { return this.events.filter((e) => e.event === event); }
  clear() { this.events = []; this.evictions = []; }
}
```

`apps/server/src/services/presence.ts`:
```ts
import type { PresenceRegistry } from '../deps.ts';
export class InMemoryPresence implements PresenceRegistry {
  private sockets = new Map<string, Set<string>>();
  connect(userId: string, socketId: string) {
    const set = this.sockets.get(userId) ?? new Set();
    const wasOnline = set.size > 0;
    set.add(socketId); this.sockets.set(userId, set);
    return !wasOnline;
  }
  disconnect(userId: string, socketId: string) {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) { this.sockets.delete(userId); return true; }
    return false;
  }
  isOnline(userId: string) { return (this.sockets.get(userId)?.size ?? 0) > 0; }
  countOnline(userIds: string[]) { return userIds.reduce((n, id) => n + (this.isOnline(id) ? 1 : 0), 0); }
  /** demo personas marked online by the simulator */
  setVirtual(userId: string, online: boolean) { online ? this.connect(userId, 'virtual') : this.disconnect(userId, 'virtual'); }
}
```

`apps/server/src/services/users.ts`:
```ts
import type { UserSummary } from '@shillex/shared';
import type { UserRow } from '../db/schema.ts';
export const avatarFor = (u: Pick<UserRow, 'id' | 'avatarUrl'>) => u.avatarUrl ?? `/media/avatar/${u.id}.svg`;
export function toUserSummary(u: UserRow): UserSummary {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: avatarFor(u), isDemo: u.isDemo };
}
```
(`/media/avatar/:seed.svg` is implemented in Task 5.)

- [ ] **Step 4: Auth lib**

`apps/server/src/lib/auth.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { sessions, users, type UserRow } from '../db/schema.ts';
import { errors } from './errors.ts';

export const SESSION_COOKIE = 'sx_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createSession(db: Db, userId: string, now: Date): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ id: hashToken(token), userId, createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) });
  return token;
}
export async function destroySession(db: Db, token: string) {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}
export async function userForToken(db: Db, token: string | undefined, now: Date): Promise<UserRow | null> {
  if (!token) return null;
  const rows = await db.select({ u: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now))).limit(1);
  return rows[0]?.u ?? null;
}
export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw errors.unauthorized();
  return req.user;
}
```

- [ ] **Step 5: App factory**

`apps/server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { UserRow } from './db/schema.ts';
import type { AppDeps } from './deps.ts';
import { registerErrorHandler, errors } from './lib/errors.ts';
import { SESSION_COOKIE, userForToken } from './lib/auth.ts';
import authRoutes from './routes/auth.ts';

declare module 'fastify' {
  interface FastifyInstance { deps: AppDeps }
  interface FastifyRequest { user: UserRow | null }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.nodeEnv === 'development' ? { level: 'info' } : false, bodyLimit: 1_000_000 });
  app.decorate('deps', deps);
  app.decorateRequest('user', null);
  await app.register(cookie, { secret: deps.config.sessionSecret });
  await app.register(rateLimit, { global: false });
  registerErrorHandler(app);

  app.addHook('onRequest', async (req) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.url.startsWith('/api')) {
      const origin = req.headers.origin;
      if (origin && !deps.config.allowedOrigins.includes(origin)) throw errors.forbidden('BAD_ORIGIN', 'Cross-origin request blocked');
    }
    if (req.url.startsWith('/api')) req.user = await userForToken(deps.db, req.cookies[SESSION_COOKIE], deps.now());
  });

  await app.register(authRoutes, { prefix: '/api' });
  // Later tasks register more route plugins here, in this order:
  // uploads, media, posts, feed, users, me, notifications, communities, channels,
  // conversations, messages, tokens, discover, reports, search.
  return app;
}
```

- [ ] **Step 6: Auth routes**

`apps/server/src/routes/auth.ts`:
```ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { sql, eq, and, isNull } from 'drizzle-orm';
import { users, notifications } from '../db/schema.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, destroySession } from '../lib/auth.ts';
import { toUserSummary } from '../services/users.ts';
import type { MeView } from '@shillex/shared';
import type { UserRow } from '../db/schema.ts';

const Username = z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 letters, numbers or underscores');
const Signup = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), password: z.string().min(8).max(128) });
const Login = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(128) });

export default async function authRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', maxAge: SESSION_TTL_MS / 1000,
    });

  async function meView(u: UserRow): Promise<MeView> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
      .where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
    return { ...toUserSummary(u), unreadNotifications: row?.n ?? 0, createdAt: u.createdAt.toISOString() };
  }

  app.post('/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Signup, req.body);
    const taken = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`).limit(1);
    if (taken.length) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    const id = newId();
    const passwordHash = await hash(body.password);
    const [u] = await db.insert(users).values({ id, username: body.username, displayName: body.displayName, passwordHash, createdAt: now() }).returning();
    setCookie(reply, await createSession(db, id, now()));
    return reply.status(201).send({ user: await meView(u!) });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Login, req.body);
    const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`).limit(1);
    if (!u || !u.passwordHash || !(await verify(u.passwordHash, body.password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    }
    setCookie(reply, await createSession(db, u.id, now()));
    return { user: await meView(u) };
  });

  app.post('/auth/demo', async (_req, reply) => {
    const [u] = await db.select().from(users).where(eq(users.username, 'demo')).limit(1);
    if (!u) throw errors.notFound('Demo account (run npm run seed)');
    setCookie(reply, await createSession(db, u.id, now()));
    return { user: await meView(u) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) await destroySession(db, t);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => ({ user: req.user ? await meView(req.user) : null }));
}
```

- [ ] **Step 7: Test helpers**

`apps/server/test/helpers.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { TokenView } from '@shillex/shared';
import { createDb } from '../src/db/client.ts';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { RecordingBus } from '../src/realtime/bus.ts';
import { InMemoryPresence } from '../src/services/presence.ts';
import { users } from '../src/db/schema.ts';
import { newId } from '../src/lib/ids.ts';
import { createSession, SESSION_COOKIE } from '../src/lib/auth.ts';
import type { AppDeps, TokenResolverPort } from '../src/deps.ts';

export const pendingView = (mint: string): TokenView => ({
  mint, status: 'pending', source: null, name: null, symbol: null, imageUrl: null, decimals: null,
  liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null,
  pairCreatedAt: null, promoted: false, fetchedAt: null, error: null,
});

export class FakeTokens implements TokenResolverPort {
  enqueued: string[] = [];
  views = new Map<string, TokenView>();
  enqueue(mints: string[]) { this.enqueued.push(...mints); }
  async resolve(mint: string) { return this.views.get(mint) ?? pendingView(mint); }
  async getViews(mints: string[]) { return Object.fromEntries(mints.map((m) => [m, this.views.get(m) ?? pendingView(m)])); }
}

export interface Res { status: number; body: any }
export interface TestUser { id: string; username: string; cookie: string }

export async function makeTestApp(over: Partial<AppDeps> = {}) {
  const handle = await createDb({});
  let current = new Date('2026-10-09T12:00:00Z');
  const clock = { now: () => current, set: (d: Date) => { current = d; }, advance: (ms: number) => { current = new Date(current.getTime() + ms); } };
  const bus = new RecordingBus();
  const tokens = (over.tokens as FakeTokens | undefined) ?? new FakeTokens();
  const presence = new InMemoryPresence();
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'test-secret' });
  const deps: AppDeps = { db: handle.db, dbKind: handle.kind, config, bus, tokens, presence, now: clock.now, ...over };
  const app: FastifyInstance = await buildApp(deps);

  async function createUser(username: string, opts: { createdAt?: Date; isDemo?: boolean } = {}): Promise<TestUser> {
    const id = newId();
    await handle.db.insert(users).values({
      id, username, displayName: username, createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'), isDemo: opts.isDemo ?? false,
    });
    const token = await createSession(handle.db, id, clock.now());
    return { id, username, cookie: `${SESSION_COOKIE}=${token}` };
  }

  function as(user: TestUser | null) {
    const call = async (method: string, url: string, payload?: unknown): Promise<Res> => {
      const r = await app.inject({ method: method as any, url, payload: payload as any, headers: user ? { cookie: user.cookie } : {} });
      return { status: r.statusCode, body: r.body ? safeJson(r.body) : null };
    };
    return {
      get: (u: string) => call('GET', u),
      post: (u: string, b: unknown = {}) => call('POST', u, b),
      put: (u: string, b: unknown = {}) => call('PUT', u, b),
      patch: (u: string, b: unknown = {}) => call('PATCH', u, b),
      del: (u: string) => call('DELETE', u),
    };
  }

  return { app, db: handle.db, bus, tokens, presence, clock, deps, createUser, as, close: async () => { await app.close(); await handle.close(); } };
}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }
export type TestCtx = Awaited<ReturnType<typeof makeTestApp>>;
```

- [ ] **Step 8: Failing auth tests**

`apps/server/test/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx } from './helpers.ts';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeTestApp(); });
afterAll(() => ctx.close());

const cookieFrom = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0]!;

describe('auth', () => {
  it('signs up, sets an httpOnly session cookie, and /me returns the user', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'trader_one', displayName: 'Trader One', password: 'hunter2hunter2' } });
    expect(r.statusCode).toBe(201);
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieFrom(r) } });
    expect(me.json().user.username).toBe('trader_one');
    expect(me.json().user.unreadNotifications).toBe(0);
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'TRADER_ONE', displayName: 'x', password: 'hunter2hunter2' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('USERNAME_TAKEN');
  });

  it('validates input with a structured error', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { username: 'a', displayName: '', password: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: 'VALIDATION', message: expect.any(String) });
  });

  it('logs in with correct password and rejects wrong password', async () => {
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'Trader_One', password: 'hunter2hunter2' } });
    expect(ok.statusCode).toBe(200);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'trader_one', password: 'nope-nope' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('logout destroys the session', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'trader_one', password: 'hunter2hunter2' } });
    const cookie = cookieFrom(r);
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user).toBeNull();
  });

  it('demo login returns 404 when not seeded, logs in when the demo user exists', async () => {
    expect((await ctx.as(null).post('/api/auth/demo')).status).toBe(404);
    await ctx.createUser('demo', { isDemo: true });
    const r = await ctx.as(null).post('/api/auth/demo');
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('demo');
  });

  it('blocks cross-origin mutations', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('BAD_ORIGIN');
  });

  it('unknown api routes return the error shape', async () => {
    const r = await ctx.as(null).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });
});
```

Run: `npm test -w @shillex/server` → Expected: FAIL until all files above exist; then PASS.

- [ ] **Step 9: Boot file**

`apps/server/src/index.ts`:
```ts
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { buildApp } from './app.ts';
import { RecordingBus } from './realtime/bus.ts';
import { InMemoryPresence } from './services/presence.ts';
import type { TokenResolverPort } from './deps.ts';

const config = loadConfig();
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
// Temporary wiring; Task 11 replaces tokens with TokenResolver, Task 12 replaces bus with SocketBus.
const tokens: TokenResolverPort = { enqueue() {}, async resolve(m) { throw new Error(`no resolver for ${m}`); }, async getViews() { return {}; } };
const app = await buildApp({ db: handle.db, dbKind: handle.kind, config, bus: new RecordingBus(), tokens, presence: new InMemoryPresence(), now: () => new Date() });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`shillex server on :${config.port} (${handle.kind})`);
```

Run: `npm run dev -w @shillex/server` → Expected: "shillex server on :3000 (pglite)"; `curl -s localhost:3000/api/auth/me` → `{"user":null}`. Stop it.

- [ ] **Step 10: Typecheck and commit**

Run: `npm run typecheck -w @shillex/server && npm test -w @shillex/server` → Expected: PASS.
```bash
git add apps/server
git commit -m "feat(server): app factory, config, error shape, sessions and auth routes"
```

---

### Task 4: Visibility module

**Files:**
- Create: `apps/server/src/services/visibility.ts`
- Test: `apps/server/test/visibility.test.ts`

**Interfaces:**
- Consumes: schema, `errors`, `Db`.
- Produces:
  - `interface CommunityAccess { community: CommunityRow; member: MemberRow | null; isActive: boolean; canRead: boolean; canPost: boolean; isMod: boolean; isOwner: boolean }`
  - `accessFor(community: CommunityRow, member: MemberRow | null): CommunityAccess` (pure)
  - `getCommunityAccess(db, communityId, userId): Promise<CommunityAccess | null>`
  - `getCommunityAccessBySlug(db, slug, userId): Promise<CommunityAccess | null>`
  - `requireCommunityRead(access: CommunityAccess | null): CommunityAccess` — throws 404 for missing or (invite-only and not active member); 403 `MEMBERS_ONLY` for private non-members
  - `requireMod(access): CommunityAccess` — 403 `MODS_ONLY`
  - `requireChannel(db, channelId, userId, mode: 'read' | 'post'): Promise<{ channel: ChannelRow; access: CommunityAccess }>` — 403 `BANNED` / `JOIN_TO_POST` for post mode
  - `requireConversationMember(db, conversationId, userId): Promise<ConversationRow>` — 404 if not a member (never reveal existence)
  - `canReadPost(db, post: PostRow, userId): Promise<boolean>`
  - `type MentionSource = { kind: 'post'; communityVisibility: CommunityVisibility | null } | { kind: 'channel_message'; communityVisibility: CommunityVisibility } | { kind: 'conversation_message' }`
  - `computeMentionVisibility(src: MentionSource): boolean`
  - `isBlockedEitherWay(db, a, b): Promise<boolean>`
  - `hiddenAuthorIds(db, viewerId): Promise<string[]>` — muted by viewer ∪ blocked by viewer ∪ users who blocked viewer

- [ ] **Step 1: Failing tests**

`apps/server/test/visibility.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { communities, communityMembers, blocks, mutes, conversations, conversationMembers } from '../src/db/schema.ts';
import { accessFor, computeMentionVisibility, getCommunityAccess, requireCommunityRead, requireConversationMember, hiddenAuthorIds, isBlockedEitherWay } from '../src/services/visibility.ts';
import { newId } from '../src/lib/ids.ts';

const comm = (visibility: 'public' | 'private' | 'invite') => ({
  id: newId(), slug: `c-${visibility}-${Math.random().toString(36).slice(2, 7)}`, name: 'C', description: '', avatarUrl: null, bannerUrl: null,
  visibility, ownerId: 'x', rules: '', createdAt: new Date(), isDemo: false,
});
const mem = (role: 'owner' | 'mod' | 'member', status: 'active' | 'pending' | 'banned') => ({ communityId: 'c', userId: 'u', role, status, joinedAt: new Date() });

describe('accessFor (pure)', () => {
  it('public: anyone reads, only active members post', () => {
    expect(accessFor(comm('public'), null)).toMatchObject({ canRead: true, canPost: false, isMod: false });
    expect(accessFor(comm('public'), mem('member', 'active'))).toMatchObject({ canRead: true, canPost: true });
    expect(accessFor(comm('public'), mem('member', 'banned'))).toMatchObject({ canRead: true, canPost: false });
  });
  it('private/invite: only active members read', () => {
    for (const v of ['private', 'invite'] as const) {
      expect(accessFor(comm(v), null).canRead).toBe(false);
      expect(accessFor(comm(v), mem('member', 'pending')).canRead).toBe(false);
      expect(accessFor(comm(v), mem('member', 'active')).canRead).toBe(true);
    }
  });
  it('mods and owners', () => {
    expect(accessFor(comm('public'), mem('mod', 'active')).isMod).toBe(true);
    expect(accessFor(comm('public'), mem('owner', 'active'))).toMatchObject({ isMod: true, isOwner: true });
    expect(accessFor(comm('public'), mem('mod', 'banned')).isMod).toBe(false);
  });
});

describe('computeMentionVisibility', () => {
  it('only public posts and public-community content are public', () => {
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: null })).toBe(true);
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: 'public' })).toBe(true);
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: 'private' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'post', communityVisibility: 'invite' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'channel_message', communityVisibility: 'public' })).toBe(true);
    expect(computeMentionVisibility({ kind: 'channel_message', communityVisibility: 'private' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'channel_message', communityVisibility: 'invite' })).toBe(false);
    expect(computeMentionVisibility({ kind: 'conversation_message' })).toBe(false);
  });
});

describe('db-backed checks', () => {
  let ctx: TestCtx; let a: TestUser; let b: TestUser; let c: TestUser;
  beforeAll(async () => {
    ctx = await makeTestApp();
    a = await ctx.createUser('alice'); b = await ctx.createUser('bob'); c = await ctx.createUser('carol');
  });
  afterAll(() => ctx.close());

  it('requireCommunityRead: 404 for invite-only, 403 for private, ok for members', async () => {
    const inv = { ...comm('invite'), ownerId: a.id };
    const priv = { ...comm('private'), ownerId: a.id };
    await ctx.db.insert(communities).values([inv, priv]);
    await ctx.db.insert(communityMembers).values({ communityId: priv.id, userId: a.id, role: 'owner', status: 'active', joinedAt: new Date() });
    expect(() => requireCommunityRead(null)).toThrow(expect.objectContaining({ status: 404 }));
    const invB = await getCommunityAccess(ctx.db, inv.id, b.id);
    expect(() => requireCommunityRead(invB)).toThrow(expect.objectContaining({ status: 404 }));
    const privB = await getCommunityAccess(ctx.db, priv.id, b.id);
    expect(() => requireCommunityRead(privB)).toThrow(expect.objectContaining({ status: 403, code: 'MEMBERS_ONLY' }));
    const privA = await getCommunityAccess(ctx.db, priv.id, a.id);
    expect(requireCommunityRead(privA).canRead).toBe(true);
  });

  it('requireConversationMember: 404 for non-members', async () => {
    const id = newId();
    await ctx.db.insert(conversations).values({ id, kind: 'group', name: 'g', createdBy: a.id, createdAt: new Date() });
    await ctx.db.insert(conversationMembers).values({ conversationId: id, userId: a.id, joinedAt: new Date() });
    await expect(requireConversationMember(ctx.db, id, a.id)).resolves.toMatchObject({ id });
    await expect(requireConversationMember(ctx.db, id, b.id)).rejects.toMatchObject({ status: 404 });
  });

  it('blocks and mutes', async () => {
    await ctx.db.insert(blocks).values({ userId: b.id, targetId: a.id, createdAt: new Date() });
    await ctx.db.insert(mutes).values({ userId: a.id, targetId: c.id, createdAt: new Date() });
    expect(await isBlockedEitherWay(ctx.db, a.id, b.id)).toBe(true);
    expect(await isBlockedEitherWay(ctx.db, b.id, a.id)).toBe(true);
    expect(await isBlockedEitherWay(ctx.db, a.id, c.id)).toBe(false);
    expect((await hiddenAuthorIds(ctx.db, a.id)).sort()).toEqual([b.id, c.id].sort());
    expect(await hiddenAuthorIds(ctx.db, b.id)).toEqual([a.id]);
  });
});
```

Run: `npm test -w @shillex/server -- visibility` → Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

`apps/server/src/services/visibility.ts`:
```ts
import { and, eq, or } from 'drizzle-orm';
import type { CommunityVisibility } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import {
  communities, communityMembers, channels, conversations, conversationMembers, blocks, mutes,
  type CommunityRow, type MemberRow, type ChannelRow, type ConversationRow, type PostRow,
} from '../db/schema.ts';
import { errors } from '../lib/errors.ts';

export interface CommunityAccess {
  community: CommunityRow; member: MemberRow | null;
  isActive: boolean; canRead: boolean; canPost: boolean; isMod: boolean; isOwner: boolean;
}

export function accessFor(community: CommunityRow, member: MemberRow | null): CommunityAccess {
  const isActive = member?.status === 'active';
  const canRead = community.visibility === 'public' || isActive;
  const isMod = isActive && (member!.role === 'mod' || member!.role === 'owner');
  return { community, member, isActive, canRead, canPost: isActive, isMod, isOwner: isActive && member!.role === 'owner' };
}

async function memberRow(db: Db, communityId: string, userId: string | null) {
  if (!userId) return null;
  const [m] = await db.select().from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId))).limit(1);
  return m ?? null;
}

export async function getCommunityAccess(db: Db, communityId: string, userId: string | null) {
  const [c] = await db.select().from(communities).where(eq(communities.id, communityId)).limit(1);
  return c ? accessFor(c, await memberRow(db, c.id, userId)) : null;
}
export async function getCommunityAccessBySlug(db: Db, slug: string, userId: string | null) {
  const [c] = await db.select().from(communities).where(eq(communities.slug, slug)).limit(1);
  return c ? accessFor(c, await memberRow(db, c.id, userId)) : null;
}

export function requireCommunityRead(access: CommunityAccess | null): CommunityAccess {
  if (!access) throw errors.notFound('Community');
  if (access.canRead) return access;
  if (access.community.visibility === 'invite') throw errors.notFound('Community');
  throw errors.forbidden('MEMBERS_ONLY', 'This community is private. Request to join to see it.');
}
export function requireMod(access: CommunityAccess): CommunityAccess {
  if (!access.isMod) throw errors.forbidden('MODS_ONLY', 'Only moderators can do that');
  return access;
}

export async function requireChannel(db: Db, channelId: string, userId: string, mode: 'read' | 'post') {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) throw errors.notFound('Channel');
  const access = requireCommunityRead(await getCommunityAccess(db, channel.communityId, userId));
  if (mode === 'post' && !access.canPost) {
    if (access.member?.status === 'banned') throw errors.forbidden('BANNED', 'You are banned from this community');
    throw errors.forbidden('JOIN_TO_POST', 'Join the community to chat');
  }
  return { channel: channel as ChannelRow, access };
}

export async function requireConversationMember(db: Db, conversationId: string, userId: string): Promise<ConversationRow> {
  const rows = await db.select({ c: conversations }).from(conversations)
    .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversations.id, conversationId), eq(conversationMembers.userId, userId))).limit(1);
  if (!rows[0]) throw errors.notFound('Conversation');
  return rows[0].c;
}

export async function canReadPost(db: Db, post: PostRow, userId: string | null): Promise<boolean> {
  if (!post.communityId) return true;
  const access = await getCommunityAccess(db, post.communityId, userId);
  return !!access?.canRead;
}

export type MentionSource =
  | { kind: 'post'; communityVisibility: CommunityVisibility | null }
  | { kind: 'channel_message'; communityVisibility: CommunityVisibility }
  | { kind: 'conversation_message' };

export function computeMentionVisibility(src: MentionSource): boolean {
  switch (src.kind) {
    case 'post': return src.communityVisibility === null || src.communityVisibility === 'public';
    case 'channel_message': return src.communityVisibility === 'public';
    case 'conversation_message': return false;
  }
}

export async function isBlockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const rows = await db.select({ u: blocks.userId }).from(blocks).where(or(
    and(eq(blocks.userId, a), eq(blocks.targetId, b)),
    and(eq(blocks.userId, b), eq(blocks.targetId, a)),
  )).limit(1);
  return rows.length > 0;
}

export async function hiddenAuthorIds(db: Db, viewerId: string): Promise<string[]> {
  const [m, bOut, bIn] = await Promise.all([
    db.select({ id: mutes.targetId }).from(mutes).where(eq(mutes.userId, viewerId)),
    db.select({ id: blocks.targetId }).from(blocks).where(eq(blocks.userId, viewerId)),
    db.select({ id: blocks.userId }).from(blocks).where(eq(blocks.targetId, viewerId)),
  ]);
  return [...new Set([...m, ...bOut, ...bIn].map((r) => r.id))];
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -w @shillex/server` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/services/visibility.ts apps/server/test/visibility.test.ts
git commit -m "feat(server): visibility and mention-privacy rules"
```
