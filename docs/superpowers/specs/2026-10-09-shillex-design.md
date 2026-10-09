# Shillex — Design Spec

Date: 2026-10-09
Status: Approved in conversation, awaiting written-spec review

## 1. Intent

Shillex is a social platform for Solana memecoin communities. **Communication is the product**: people come to talk, meet traders, build communities, share ideas, and discover coins *through conversations*. Token data supports conversations; it never leads them.

Success for the first build:

- Opening the app (after login or "Try as demo user") lands directly in a lively, populated social feed — not a landing page.
- The core loops work end to end against a real backend: posting, replying, reacting, following, community chat, DMs/groups, CA mentions resolving into interactive chips, and a token side panel that shows public conversations about that exact mint.
- The app is honest: demo data is labeled, live token data is labeled with source and fetch time, unresolved/unavailable states are shown as such, self-reported calls are labeled, and private content never leaks into public surfaces.

### Decisions made with the user

| Topic | Decision |
|---|---|
| Data scope | Real backend (accounts, multi-user, realtime, persistence) |
| Auth | Username + password; "Try as demo user" logs into a seeded persona; wallet is an optional profile feature |
| Token resolution | Server-side live lookup (Solana RPC + Dexscreener), demo tokens resolved from DB |
| Deployment | Local-first, one command; Railway-ready via `DATABASE_URL`. No deploy without asking |
| Architecture | Approach A: TypeScript monorepo, Vite React SPA + Fastify + Socket.IO + Drizzle (PGlite locally / Postgres in prod) |

### Non-goals (this build)

- Real wallet connection or holdings verification (stubbed and labeled).
- Live price charts, trading, or any price streaming.
- Profitability scores, win rates, credibility/trust badges, or rankings that imply trustworthiness.
- Push notifications, email, media transcoding, end-to-end encryption.
- Paid promotion purchasing (promoted placements exist only as seeded, clearly labeled demo data).

## 2. Architecture

```
shillex/
  package.json            npm workspaces root; scripts: dev, build, seed, test, e2e
  packages/shared/        types, zod schemas, mint parsing/validation, link builders, constants
  apps/server/            Fastify REST + Socket.IO, Drizzle, TokenResolver, demo simulator
  apps/web/               Vite + React + TS SPA (React Router, TanStack Query)
  e2e/                    Playwright tests
  docs/superpowers/       specs and plans
```

- **Server**: one Node process running Fastify (REST under `/api`) and Socket.IO on the same HTTP server. In production it also serves the built SPA.
- **Database**: Drizzle ORM with a `pg-core` schema and SQL migrations.
  - Local: PGlite (Postgres compiled to WASM) persisted at `./data/pglite`. No Docker or installed DB.
  - Production: `DATABASE_URL` set → `node-postgres` driver, same schema and migrations.
  - Tests: in-memory PGlite per test file.
- **Client**: React SPA. Server state via TanStack Query; socket events update the query cache. UI state (open token panel) lives in the URL (`?token=<mint>`).
- **Dev**: `npm run dev` starts server (watch) and Vite (proxying `/api` and `/socket.io`). `npm run seed` resets and seeds the demo world.
- **Config** (`.env`): `DATABASE_URL` (optional), `SESSION_SECRET`, `SOLANA_RPC_URL` (default `https://api.mainnet-beta.solana.com`), `LIVE_TOKEN_LOOKUP` (default `on`), `DEMO_SIMULATOR` (default `on` in dev, `off` in production).

## 3. Data model

All ids are text (ULID-like, sortable). Timestamps are `timestamptz`. Demo-seeded rows carry `is_demo boolean`.

**Identity & social graph**
- `users`: id, username (unique, case-insensitive), display_name, password_hash (argon2), avatar_url, banner_url, bio, links (jsonb array of {label,url}), created_at, is_demo.
- `sessions`: id (random token hash), user_id, expires_at.
- `follows`: follower_id, followee_id, created_at.
- `blocks`, `mutes`: user_id, target_id.
- `wallet_links`: user_id, address, display_wallet (default false), display_holdings (default false), verified (always false in this build).

**Posts**
- `posts`: id, author_id, kind (`post` | `reply` | `repost` | `quote`), body, parent_id (reply target), root_id (thread root), quote_of_id, repost_of_id, community_id (nullable: community-scoped discussion threads), visibility (`public` | `community`), created_at, deleted_at, is_demo.
- `post_media`: id, post_id, url, width, height, alt.
- `reactions`: target_type (`post` | `message`), target_id, user_id, emoji. Unique per (target, user, emoji).
- `bookmarks`: user_id, post_id.
- `call_updates`: id, post_id, author_id, status (`watching` | `bought` | `taking_profit` | `out` | `thesis_changed`), note, self_reported (always true), created_at.

**Communities**
- `communities`: id, slug, name, description, avatar_url, banner_url, visibility (`public` | `private` | `invite`), owner_id, rules, created_at, is_demo.
- `community_members`: community_id, user_id, role (`owner` | `mod` | `member`), status (`active` | `pending` | `banned`), joined_at.
- `invites`: code, community_id, created_by, expires_at, max_uses, uses.
- `channels`: id, community_id, name, topic, position, slow_mode_seconds, hold_new_member_posts (bool).
- `pins`: community_id, channel_id (nullable), target_type, target_id, pinned_by.
- Discussion threads in a community are `posts` with `community_id` set.

**Messaging**
- `conversations`: id, kind (`dm` | `group`), name (groups), created_by, created_at.
- `conversation_members`: conversation_id, user_id, joined_at, muted.
- `messages`: id, channel_id (nullable), conversation_id (nullable) — exactly one set; author_id, body, reply_to_id, attachments (jsonb: image urls or token-card mints), status (`visible` | `held` | `deleted`), created_at.
- `read_markers`: user_id, scope_type (`channel` | `conversation`), scope_id, last_read_message_id.

**Tokens**
- `tokens`: mint (pk), source (`demo` | `live`), status (`resolved` | `unindexed` | `not_a_token` | `error`), name, symbol, image_url, decimals, liquidity_usd, market_cap_usd, fdv_usd, pair_address, dex_id, pair_created_at, promoted (bool, demo only), fetched_at, meta_fetched_at, error.
- `token_mentions`: id, mint, source_type (`post` | `message`), source_id, author_id, community_id (nullable), **is_public** (bool, computed on write), created_at.

**Engagement**
- `subscriptions`: user_id, target_type (`post` | `token`), target_id.
- `notifications`: id, user_id, type (`reply` | `mention` | `follow` | `reaction` | `quote` | `repost` | `dm` | `call_update` | `token_discussion` | `invite` | `report_resolved`), actor_id, target_type, target_id, read_at, created_at.
- `notification_prefs`: user_id, type, enabled (in-app).
- `reports`: id, reporter_id, target_type (`post` | `message` | `user`), target_id, community_id (nullable), reason, status (`open` | `resolved` | `dismissed`), created_at.

**`is_public` rule** (single function `computeMentionVisibility` in server):
- post with `visibility = public` and no community → public;
- post or message in a community with `visibility = public` → public;
- anything in a DM, group, private or invite-only community → **never** public.
If a community changes from public to private, its mentions are recomputed in the same transaction.

## 4. Contract-address mentions

### 4.1 Detection (`packages/shared/src/mint.ts`)
- Candidate regex: base58 alphabet, 32–44 chars, bounded by non-base58 characters.
- Candidate is kept only if base58-decoding yields exactly 32 bytes.
- `extractMintCandidates(text) → { mint, start, end }[]` (deduplicated per message for storage; positions kept for rendering).
- A candidate is not yet a token; rendering depends on resolution status.

### 4.2 Resolution (`apps/server/src/tokens/resolver.ts`)
1. DB lookup. Demo tokens return immediately. Live tokens: identity fields cached permanently once resolved; market fields refreshed if `fetched_at` older than 5 minutes (stale data is still returned immediately, refresh happens in background).
2. If unknown: RPC `getAccountInfo(mint, {encoding: "jsonParsed"})`. Token iff `owner ∈ {TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb}` and `data.parsed.type === "mint"`. Otherwise → `not_a_token` (cached; never rendered as a token).
3. Mint confirmed: GET `https://api.dexscreener.com/tokens/v1/solana/<mint>`. Choose the pair whose `baseToken.address === mint` with the highest `liquidity.usd`. Store name, symbol, `info.imageUrl`, liquidity, marketCap, fdv, pairAddress, dexId, pairCreatedAt.
4. Mint with no pairs → `unindexed` (decimals from RPC; name/symbol unknown).
5. Network/RPC failure → `error` with message; not cached long (retry after 60s).
- Concurrency: per-mint in-flight promise dedupe; global limiter (e.g. 4 concurrent, ~5 req/s to RPC).
- `LIVE_TOKEN_LOOKUP=off` → unknown candidates resolve to `error` with reason "Live lookup disabled".
- Mentions are written immediately at post/message creation; resolution is kicked off asynchronously and `token:resolved` is emitted to clients viewing content containing that mint (broadcast to a `token:<mint>` room that clients join for visible chips).
- Endpoints: `GET /api/tokens/:mint`, `POST /api/tokens/resolve` (batch, max 25).

### 4.3 External links (`packages/shared/src/links.ts`)
Verified in a real browser on 2026-10-09:
- Dexscreener: `https://dexscreener.com/solana/<mint>`
- GMGN: `https://gmgn.ai/sol/token/<mint>`
- Solscan: `https://solscan.io/token/<mint>`
- Axiom: `https://axiom.trade/meme/<pairAddress>?chain=sol` — requires the pool/pair address (the `/t/<mint>` path redirects to discover). Only built when `pair_address` is known.
For demo tokens all external links render disabled with the reason "Fictional demo token — not on-chain". All external links open in a new tab with `rel="noopener noreferrer"`.

### 4.4 Chip (`<TokenMention>`)
States:
- **loading**: skeleton chip with abbreviated address.
- **resolved**: thumbnail (fallback: generated identicon from mint), `$SYMBOL`, name, `AbC1…xYz9`, DEMO tag if demo.
- **unindexed**: "Unindexed mint" + abbreviated address.
- **error**: "Couldn't load" + retry affordance in preview.
- **not_a_token**: plain monospace text, no interaction.
Full address is always available: `title`/`aria-label` contain it; preview has copy button. Hover (after 300ms) or keyboard focus shows a preview card; tap on touch devices opens the preview with an "Open" button. Click/Enter opens the side panel.

### 4.5 Token side panel
- Desktop: drawer overlaying the right sidebar (420px). Mobile: full-height bottom sheet. Opened via `?token=<mint>`; the underlying route remains mounted, scroll position preserved. Esc / close returns focus to the triggering chip.
- Header: image, name, `$SYMBOL`, full mint + copy, provenance line ("Live · Dexscreener · fetched 2m ago" or "DEMO data — fictional token").
- Stats (each shows "—" with tooltip reason when unknown): age (from `pair_created_at`), liquidity, market cap. PROMOTED tag shown if promoted.
- External link row (Axiom, GMGN, Dexscreener, Solscan) per 4.3.
- "Follow discussion" toggle (subscription target `token`).
- Tabs: **Posts** (public posts mentioning the mint), **Community chat** (public-community messages mentioning the mint, showing community/channel and a link into context). Counts labeled "mentions in last 24h". No scores.
- Copy: a neutral note — "Mentions measure discussion, not quality. Do your own research."

## 5. Social features

- **Feed**: Following tab (posts/reposts/quotes from followed users, reverse-chron) and Discover tab (public posts ranked by recent engagement among people you don't follow, with author diversity; tokens play no role in ranking). New posts arrive as a "N new posts" pill; feed never auto-jumps. Cursor pagination.
- **Composer**: text (max 1000 chars), up to 4 images (uploaded to `./data/uploads`, served at `/uploads`, 5MB limit, image mime types only), inline CA detection preview (shows chips as you type), optional "Attach to community". Keyboard: `n` opens, Ctrl/Cmd+Enter submits.
- **Post card**: author, time, body with chips and @mentions, media grid, quote embed, action bar (reply, repost, quote, react, bookmark, share-copy-link, overflow: mute/block/report/subscribe). Call-update timeline for posts with updates.
- **Thread view** (`/p/:id`): ancestors, focused post, replies; "Subscribe to conversation".
- **Reactions**: a fixed set of 6 emoji (🔥 🚀 👀 💀 😂 🫡) with counts.
- **Following**: follow/unfollow from cards, profiles, suggestions.
- **Call updates**: author-only "Add update" on own posts that contain at least one token mention. Timeline under post, each item labeled "self-reported". Subscribers get `call_update` notifications.

## 6. Communities

- Directory (`/communities`) and joined list in the left sidebar with unread counts and mention dots.
- Community page (`/c/:slug`): header (banner, avatar, name, visibility badge, member count, online count, join/leave/request), channel list, active channel chat, Threads tab (community discussion posts), Pinned, Members (role badges, presence), About/Rules.
- Visibility:
  - public: anyone can read and join;
  - private: listed in directory by name/description only, content hidden; join by request approved by mod;
  - invite: not listed; join only via invite link.
- Chat: message list grouped by author/time, reply previews (quoted snippet, click jumps to original), reactions, token chips, typing indicator ("alpha_jane is typing…", max 3 names then "several people"), presence dots, unread divider, jump-to-latest.
- Moderation tools (mods/owner): delete message, pin/unpin, slow mode per channel (0, 5, 15, 30, 60, 300s), hold-new-member-posts toggle, member remove/ban, approve join requests, invite links, review reports queue.
- User tools (all): mute, block, report.
- Spam controls (server-enforced): per-user rate limit (e.g. 10 messages / 10s), duplicate text within 60s across channels rejected, accounts younger than 24h limited to 2 links/mentions per message, held messages visible only to author and mods until approved.

## 7. Private communication

- Messages (`/messages`, `/messages/:id`): conversation list (DMs and groups, last message preview, unread count, presence), conversation view with the same message component as channels: replies, reactions, image attachments, token cards (share-token action from panel creates a token card attachment), typing, search within conversation and across own conversations (Postgres `ILIKE` over messages the user can read).
- New DM / new group (name + up to 20 members). Blocks prevent DMs.
- Token mentions in DMs/groups render normally for participants, but are stored with `is_public = false` and never appear in token panels, discovery, or any public count.

## 8. Discovery (`/discover`)

Order of sections reflects priority: **Live conversations** (public channels with activity in last 15 min), **Active communities**, **Interesting people** (active, not followed, not blocked), **New coins** (secondary: tokens first mentioned publicly in last 24h, showing age, liquidity, market cap when available, and public discussion activity; sorted by recency of first mention, not by mention count). Promoted entries carry a visible "Promoted" label and are never mixed in unlabeled. Copy near the coins list: "Listed by recency. Mentions are not an endorsement."

Right sidebar mirrors compact versions: active rooms, suggested people, new coins (5 items).

## 9. Profiles (`/u/:username`)

Banner, avatar, display name, @username, bio, social links, joined date, follower/following counts, Follow / Message / overflow (mute, block, report). Tabs: Posts, Replies, Communities (public only for other viewers). Wallet: section shown only when `display_wallet` is true; holdings section only when `display_holdings` is true and shows "Not verified — wallet connection is not implemented in this build". Settings (`/settings`): profile edit, wallet display toggles (default off), notification preferences per type, muted/blocked lists.

## 10. Notifications (`/notifications`)

List with filter tabs (All, Mentions, Calls). Real-time badge counts. Mark-as-read on view, "mark all read". Preferences per type control creation.

## 11. Realtime

Socket.IO authenticated by session cookie. Rooms: `user:<id>`, `channel:<id>`, `conversation:<id>`, `community:<id>` (presence/unread), `token:<mint>`. Joins authorized through the visibility module.
Events: `message:new`, `message:update` (reactions, deletion, approval), `typing` (client throttled to 1/3s, expires 4s), `presence` (online/idle/offline), `unread:update`, `notification:new`, `post:new`, `call:update`, `token:resolved`.
Reconnect: client re-joins rooms and fetches messages after last known id per open scope. Sends are optimistic with client nonce; server echo replaces pending; failures show "Failed · Retry".

## 12. Visual identity & UI

- Wordmark: lowercase `shillex`, Space Grotesk 700 with tight tracking; final `x` is a custom SVG of two crossing strokes, one in volt accent. Square app icon uses the `x` mark.
- Tokens (CSS custom properties): `--bg #0E1219`, `--panel #141924`, `--raised #1A2030`, `--line #232B3D`, `--text #E6E9EF`, `--muted #8B94A8`, `--accent #C8F135` (volt), `--token #3DD6F5` (cyan, token chips only), `--up #3DDC84`, `--down #F2546B`, `--warn #F5B53D` (DEMO, PROMOTED). All text/background pairs meet WCAG AA.
- Type: Inter (UI, 13–14px base), JetBrains Mono (addresses, tickers, numbers), Space Grotesk (wordmark only). Self-hosted via `@fontsource`.
- Panels: 1px borders, 8px radius, compact spacing (4px grid), no glows, no decorative gradients.
- Layout ≥1200px: left 240px / center fluid (feeds max 720px, chat full) / right 320px. 768–1199px: right column hidden (token panel becomes overlay). <768px: bottom nav (Home, Discover, Communities, Messages, Profile), dedicated conversation routes with back button, token panel as bottom sheet.
- Accessibility: full keyboard navigation, visible 2px volt focus ring (`:focus-visible`), skip-to-content link, ARIA roles for tabs/dialogs/menus/log (chat uses `role="log"` with polite live region for new messages), focus trap in dialogs/drawers, Esc closes, `prefers-reduced-motion` respected. Shortcuts: `/` search, `n` compose, `g h`/`g m` navigation, `?` help.
- States: skeletons for every list, written empty states, inline error with retry, global "Reconnecting…" banner.

## 13. Demo world & labeling

- `npm run seed`: ~40 fictional personas (all `is_demo`), the demo user `@demo`, 8 communities (5 public, 2 private, 1 invite-only), ~20 fictional demo tokens with valid-format but non-existent mints, ~300 posts with threads/quotes/reposts/reactions/call updates, channel histories, 6 DM/group conversations involving `@demo`, a few promoted demo tokens.
- Labeling: DEMO tag on demo tokens everywhere; a persistent, unobtrusive "Demo world" indicator in the sidebar footer explaining that seeded users/communities/tokens are fictional; demo personas show a small "demo account" note on their profiles.
- Demo simulator (`DEMO_SIMULATOR=on`): every 4–12s a random seeded persona types then posts a message in an active public channel, or publishes a post/reply, from a curated pool of realistic lines. Off in production unless explicitly enabled. Indicator "Demo activity on" shown when active.
- Real users created via signup are not demo; their content coexists with the demo world.

## 14. Errors

- API: JSON `{ code, message, details? }` with appropriate status; zod validation on every input.
- Client: TanStack Query error states with retry; error boundaries per column; toasts for action failures.
- Token lookups never fabricate values; failures map to `error` state.

## 15. Security

- argon2id password hashing; httpOnly, SameSite=Lax session cookies; CSRF protection via SameSite + origin check on mutating requests.
- All reads/writes go through the visibility module; integration tests cover leaks.
- Uploads: mime sniffing, size limit, random filenames.
- Body text rendered as text (no HTML); links rendered with `rel="noopener noreferrer nofollow"`.
- Login rate limiting.

## 16. Testing

- **Vitest unit**: mint parsing/validation (valid mints, wallets-format strings, tickers, URLs, 31/33-byte decodes), link builders, resolver state machine with mocked RPC/Dexscreener, `computeMentionVisibility`, slow mode, rate limits, duplicate filter, call-update permissions.
- **Integration** (Fastify `inject` + in-memory PGlite): auth, posting and threads, reactions, following feed, community join flows per visibility, DMs/groups, moderation, and **privacy leak tests** (mint mentioned only in DM/group/private/invite community never appears in token discussion, discovery, or counts; private community content not readable by non-members).
- **Playwright e2e**: demo login → feed populated; post with CA → chip → preview → panel opens while feed stays; channel message seen in second browser context; DM send; follow/unfollow; mobile viewport navigation; keyboard-only path through composer and panel.
