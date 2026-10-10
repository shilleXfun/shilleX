# Shillex

Shillex is a chat-first social platform for Solana memecoin communities. Paste a contract address anywhere (a post, a channel, a DM) and it becomes a live token chip; open it to see the token's provenance, verified links and the public conversation around it. Communities get realtime channels, threads, pins and moderation tools, and everyone gets a feed, profiles, DMs and private groups.

## Run it locally

Requires Node 24 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and choose **Enter the demo world**. The first boot seeds a fictional demo world into `./data/pglite` (an embedded Postgres, so there is nothing else to install). `npm run seed` wipes and reseeds it.

Stop the dev servers with Ctrl+C rather than killing the process: PGlite can corrupt its data directory on an unclean shutdown. If that happens, delete `./data/pglite` and it reseeds on the next start.

## What's real and what's demo

| | |
|---|---|
| **Real** | Accounts and sessions; posts, replies, reposts, quotes, reactions and bookmarks; follows; communities and membership; realtime chat, DMs and private groups; moderation and spam controls; notifications; privacy rules; uploads. |
| **Live** (when `LIVE_TOKEN_LOOKUP=on`) | Real mint addresses resolve through public Solana RPC (`getAccountInfo` plus a mint check) and Dexscreener's public API. Results show their source and fetch time and are cached for 5 minutes. Failures are shown as errors, never invented. |
| **Demo** | Seeded people, communities, posts and DMs, and DEMO tokens: fictional mints with invented liquidity and market cap, always labeled DEMO, with external links disabled. "Promoted" placements are demo-only. The demo activity simulator posts as personas and is labeled in the sidebar. |
| **Not implemented** | Wallet connection and holdings verification (wallet display is opt-in and labeled not verified), price charts and trading, push and email notifications. |

## Configuration

Copy `.env.example` to `.env` at the repo root. Every variable is optional in development.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | unset | Postgres connection string. Unset uses the embedded PGlite database. |
| `PGLITE_DIR` | `./data/pglite` | Where PGlite keeps its data when `DATABASE_URL` is unset. |
| `SESSION_SECRET` | `dev-secret` | Signs session cookies. Required in production, and `change-me`/`dev-secret` are rejected there. |
| `PORT` | `3000` | API and (in production) web server port. |
| `PUBLIC_URL` | `http://localhost:5173` in dev, `http://localhost:$PORT` in production | The URL people open; used for CORS and links. |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | RPC used to check real mints. Use a dedicated RPC for real traffic. |
| `LIVE_TOKEN_LOOKUP` | `on` (off in tests) | Resolve real mint addresses through RPC and Dexscreener. |
| `DEMO_SIMULATOR` | `on` in development, off otherwise | Demo personas post and chat automatically. |
| `SEED_ON_EMPTY` | `on` (off in tests) | Seed the demo world when the database is empty. |
| `UPLOADS_DIR` | `./data/uploads` | Where uploaded images are stored. |
| `NODE_ENV` | `development` | `production` enforces `SESSION_SECRET` and turns the demo simulator off by default. |

## Architecture

```
apps/server     Fastify API, Socket.IO realtime, Drizzle (PGlite or Postgres), token resolver, demo seed and simulator
apps/web        React 19 + Vite SPA: TanStack Query, React Router, motion
packages/shared Types, limits, copy and formatting shared by both apps
e2e             Playwright end-to-end suite with axe accessibility scans
```

- **Requests:** the web app calls `/api/*`. In development Vite proxies `/api`, `/media`, `/uploads` and `/socket.io` to the server on :3000. Once `apps/web/dist` exists (`npm run build`), the server also serves it with an SPA fallback, plus security headers (CSP, nosniff, frame denial) on every response.
- **Realtime:** each socket joins `user:<id>` for personal events and subscribes to `channel:<id>` or `conversation:<id>` rooms after a membership check. Messages, edits and typing go to those rooms only, and members who lose access are evicted from them.
- **Privacy rule:** every contract-address mention is recorded in `token_mentions` with `is_public`. Only public mentions (public posts and public community channels) ever count toward token discussion, discovery or mention totals; DMs, private groups and private communities never surface there.
- **Look and feel:** a live night-sky backdrop (`apps/web/src/components/atmosphere`) with a candlestick skyline that reacts to new posts and messages; the visual spec is in `docs/superpowers/specs/2026-10-09-shillex-visual-v2.md`.

## Testing

```bash
npm test           # unit and integration suites (server on PGlite, web on jsdom)
npm run typecheck  # TypeScript across all workspaces
npm run e2e        # Playwright end-to-end, desktop and mobile; run `npx playwright install chromium` once first
```

The e2e suite starts its own server on :3100 and web app on :5174 with a throwaway database under `./data/e2e-*` (gitignored, safe to delete).

## Deploying to Railway

`railway.json` builds with `npm ci --include=dev && npm run build`, starts with `npm start`, and health-checks `/api/health`.

1. Create a Postgres service and set `DATABASE_URL` on the app service.
2. Set `SESSION_SECRET` (a long random string), `PUBLIC_URL` (the service's public URL) and `NODE_ENV=production`.
3. `DEMO_SIMULATOR` is off by default in production. `SEED_ON_EMPTY=on` seeds the demo world on first boot.
4. Mount a volume for `UPLOADS_DIR`, or uploads disappear on redeploy.

The Postgres path runs the same Drizzle migrations as PGlite, but the automated suites run on PGlite.

## Known limitations

- Reports on content outside communities are stored, but there is no global admin console yet.
- Public Solana RPC and Dexscreener are rate limited; set `SOLANA_RPC_URL` to a dedicated RPC for real use.
- Presence and rate limits are in memory, so they are per process; a multi-instance deploy needs Redis.
- Uploads live on local disk; use a volume or object storage on Railway.
