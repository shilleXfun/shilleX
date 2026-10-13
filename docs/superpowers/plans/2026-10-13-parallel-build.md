# Parallel build: five streams at once (2026-10-13)

The owner asked to build five approved specs "all at the same time". This file is the contract every stream's plan and every stream's implementer follows. Base commit: `0036f8c` on `feat/living-shillex`.

| Stream | Spec | Plan | Branch |
|---|---|---|---|
| UI | `specs/2026-10-13-density-motion-design.md` | `plans/2026-10-13-density-motion.md` | `build/ui` |
| LOGIN | `specs/2026-10-13-wallet-email-login-design.md` | `plans/2026-10-13-wallet-email-login.md` | `build/login` |
| RAISE | `specs/2026-10-13-user-agents-design.md` | `plans/2026-10-13-user-agents.md` | `build/raise` |
| X | `specs/2026-10-13-x-feed-design.md` | `plans/2026-10-13-x-feed.md` | `build/x` |
| MAINNET | `specs/2026-10-13-mainnet-design.md` | `plans/2026-10-13-mainnet.md` | `build/mainnet` |

## 1. Isolation

- Each stream runs in its own git worktree on its own branch, created from `0036f8c`. Streams never commit to `feat/living-shillex`; the controller merges.
- **Merge order:** UI → LOGIN → RAISE → X → MAINNET. After each merge the controller runs typecheck and every suite.
- A stream whose plan has an "after merge" task (§4) rebases onto `feat/living-shillex` once the stream it waits for has merged, then runs that task.

## 2. Database migrations

Drizzle migrations form a chain (`apps/server/drizzle/meta/*_snapshot.json`, `prevId`), so parallel streams can't each own the next number.

- A stream edits `apps/server/src/db/schema.ts` and runs `npm run db:generate -w @shillex/server`, which writes `0007_<name>.sql` on its branch. That file is only for the stream's own tests.
- Hand-written SQL that drizzle-kit can't generate goes in its own custom migration (`npx drizzle-kit generate --custom --name <stream>_data` in `apps/server`). Examples are data copies and backfills. Each statement in it is idempotent and safe to replay.
- **At merge:** the controller drops the stream's generated migration (sql, snapshot and journal entry), merges `schema.ts`, and regenerates the next number. It carries the custom migration over unchanged, renumbered after it.
- Schema edits in `schema.ts` are additive and grouped under a `// ── <STREAM> ──` comment block at the end of the file. Changing an existing table is allowed only where the spec says so, for example LOGIN dropping `wallet_links` and RAISE adding owner columns to `agents`.

## 3. File ownership

Each stream owns new folders outright. Shared files get **small, additive** edits only: a one-line call into the stream's own module, a new route registration, a new union member. No reformatting and no moving of existing code.

| Area | Owner | Others may |
|---|---|---|
| `apps/web/src/layout/*`, `styles/tokens.css`, `components/ui/*` (new motion pieces), feed and post card styles, page empty states | UI | add a nav item or a route |
| Auth: `routes/auth.ts`, `services/users.ts` (auth parts), `features/auth/*`, the Settings → Sign-in methods section, the profile wallet chip | LOGIN | — |
| `apps/server/src/agents/raised/*` (new), `apps/web/src/features/raise/*` (new) | RAISE | MAINNET adds funding, after merge |
| `apps/server/src/x/*` (new), `apps/web/src/features/x/*` (new), `world_model_calls`, the `Budget.load` change | X | — |
| `apps/server/src/ledger/*` (new), `apps/web/src/features/mainnet/*` (new), launch gate, reserves | MAINNET | — |
| Engine (`agents/decide.ts`, `perceive.ts`, `act.ts`, `phrasebook.ts`, `types.ts`) | shared | RAISE and X each add one hook call (`nudge…` / `news…`) and their own union members; the logic lives in their own folder |
| `packages/shared/src/*` | shared | append new types; never rename existing ones (LOGIN's `ProfileView.wallet → wallets` is the one spec-mandated rename) |
| `apps/server/src/app.ts`, `config.ts`, `apps/web/src/App.tsx` (routes) | shared | add registrations, config fields and routes |
| The post attachment renderer | UI | X adds one branch that renders `features/x/XEmbed.tsx` |

## 4. Cross-stream dependencies (do these last, "after merge")

- **MAINNET → RAISE:** funding a raised agent, owner withdrawals, the raise page's money panel. Until RAISE merges, MAINNET codes against `ownerOf(db, agentId): Promise<string | null>` from `apps/server/src/agents/raised/owner.ts`. RAISE must export exactly that.
- **MAINNET → LOGIN:** the payout wallet is the owner's `user_wallets` row with `is_payout`, read through `payoutWallet(db, userId): Promise<string | null>` from `apps/server/src/services/wallets.ts`, which LOGIN must export.
- **X ↔ RAISE:** both add model spend. X owns `world_model_calls` and the `Budget.load()` sum. RAISE books its spend on `agent_turns`, as every agent does, and reads its 35% share through `Budget`.

## 5. Rules for every stream (from the owner, the memory and the earlier phases)

- **No browsers on the owner's screen:** no Playwright MCP, no Chrome extension, no headed browsers. Headless Playwright scripts and the headless e2e suites are fine.
- **Dev servers:** `WEB_PORT=<stream port> PORT=<api port> SHILLEX_API=http://localhost:<api port>` with a scratch `PGLITE_DIR`. The port pairs are UI 5181/3011, LOGIN 5182/3012, RAISE 5183/3013, X 5184/3014 and MAINNET 5185/3015. degenfloor owns 5173. Stop servers gracefully and kill only your own orphaned shillex processes.
- **e2e ports:** `E2E_WEB_PORT` / `E2E_API_PORT` = 52xx / 32xx with the stream's last digit (UI 5291/3291 … MAINNET 5295/3295), plus the agents suite's `E2E_AGENTS_*` equivalents.
- **Model budget:** total model spend never exceeds `AGENT_DAILY_BUDGET_USD` (the owner's hard $1/day). Tests use fakes, never real keys.
- **Privacy:** the engine's privacy invariants hold: private communities, DMs and humans' text never reach public receipts.
- **Mainnet:** stays off. No code path may reach a mainnet RPC unless the launch gate (MAINNET spec) is fully open. `assertNotMainnet` stays in force everywhere else.
- **Commits:** the repo's style, `feat(<area>): …` / `fix(<area>): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** server `npx vitest run` (uses `testDb()`), web `npx vitest run`, `npm run typecheck`, and e2e for flows the spec names. Write the failing test first.
