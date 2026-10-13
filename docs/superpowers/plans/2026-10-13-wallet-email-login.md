# Wallet and Email Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People sign up and sign in with a Solana wallet (Phantom, Solflare, Backpack and any other Wallet Standard wallet), with username + password as today, or with an unverified email + password; an account holds a password, one email and up to 5 wallets, and verified wallets can be shown on the profile.

**Architecture:** The server issues Sign In With Solana (SIWS) challenges stored in `auth_nonces`, claims each nonce atomically, then checks the signed text field by field and the Ed25519 signature with `node:crypto`. Wallet rows live in a new `user_wallets` table (address is the primary key, so a wallet belongs to one account). The web reads wallets straight from the Wallet Standard registry (`@wallet-standard/app`), and every wallet library loads in a lazy chunk only when the picker opens.

**Tech Stack:** Fastify 5, Drizzle (PGlite in tests, Postgres in production), zod 4, `@node-rs/argon2`, `node:crypto` Ed25519, `@solana/wallet-standard-util` (SIWS text parse/format), React 19, TanStack Query, `@wallet-standard/app`, `@solana-mobile/wallet-standard-mobile`, Vitest, Playwright (headless).

**Spec:** `docs/superpowers/specs/2026-10-13-wallet-email-login-design.md` (with the owner's 2026-10-13 decisions: unverified email, no mail at all, Solflare). Parallel-build contract: `docs/superpowers/plans/2026-10-13-parallel-build.md` (this is stream **LOGIN**).

## Global Constraints

Every task's requirements include these.

- **Branch and worktree:** branch `build/login` in its own git worktree, created from the base commit named in the parallel-build contract. Never commit to `feat/living-shillex`; the controller merges.
- **No browsers on the owner's screen:** no Playwright MCP, no Chrome extension, no headed browsers. Headless Playwright (`npm run e2e`) is fine.
- **Ports:** dev `WEB_PORT=5182 PORT=3012 SHILLEX_API=http://localhost:3012` with a scratch `PGLITE_DIR`. e2e `E2E_WEB_PORT=5292 E2E_API_PORT=3292`. degenfloor owns 5173. Stop servers gracefully; kill only your own orphaned shillex processes.
- **Migrations (contract §2):** schema edits go in `apps/server/src/db/schema.ts` under a `// ── LOGIN ──` block at the end of the file. Adding `users.email` edits the `users` table in place, as the spec requires. The generated migration is named `login_tables`. Hand-written SQL goes in one custom migration named `login_data` (`npx drizzle-kit generate --custom --name login_data`), and every statement in it is idempotent.
- **Ownership (contract §3):** LOGIN owns `routes/auth.ts`, the auth parts of `services/users.ts` (moved to the new `services/accounts.ts`), `features/auth/*`, the Settings → Sign-in methods section, and the profile wallet chip. Shared files take small additive edits only: `app.ts`, `routes.tsx`, `packages/shared/src/*`, `vite.config.ts`, `README.md`. `ProfileView.wallet → wallets` (the type is named `UserProfile` in code) is the one rename allowed.
- **Export for MAINNET (contract §4):** `payoutWallet(db, userId): Promise<string | null>` from `apps/server/src/services/wallets.ts`.
- **Library versions:** pinned exactly with `--save-exact`, each at least two weeks old. All checked with `npm view <pkg> time` on 2026-10-13.
  - `@solana/wallet-standard-util@1.1.4` (2026-09-10; 1.2.0 is too new)
  - `@wallet-standard/app@1.1.1`, `@wallet-standard/base@1.1.1`, `@wallet-standard/features@1.1.1` (2026-06-03)
  - `@solana/wallet-standard-features@1.5.0` (2026-09-10)
  - `@solana-mobile/wallet-standard-mobile@0.6.0` (2026-08-17; 0.7.0 is too new)
- **No email is ever sent:** no mail provider, no `RESEND_API_KEY`, no links. Email is an unverified login name, trimmed, lowercased, at most 254 characters, and checked with zod `email()`.
- **SIWS fields (spec §3.1):**
  - `domain` = the host of `PUBLIC_URL`, and `uri` = its origin. Never take either from request headers.
  - `version` `'1'`, `chainId` `'mainnet'`.
  - `nonce` = 16 random bytes in base58.
  - `issuedAt` = server time, and `expirationTime` = that plus 5 minutes.
- **Statements, verbatim:**
  - Login: "Sign in to Shillex. This only proves you own this wallet: it costs nothing and moves no funds."
  - Link: "Link this wallet to @<username> on Shillex. It costs nothing and moves no funds."
  - Confirm: "Confirm a change to your Shillex account. It costs nothing and moves no funds."
  - Reset (added by this plan, see Deviations): "Reset the password of your Shillex account. This only proves you own this wallet: it costs nothing and moves no funds."
- **Verification order (spec §3.3):** claim the nonce atomically, then the address (base58, 32 bytes), then the message (byte-for-byte in message mode, field-for-field in signIn mode), then the Ed25519 signature with `node:crypto` `verify(null, …)` behind the SPKI prefix `302a300506032b6570032100`. No new crypto dependency.
- **Error codes:**
  - An unknown, used or expired nonce always gives `400 CHALLENGE_EXPIRED`.
  - Any other signature problem gives `400 SIGN_IN_INVALID`.
  - Never a 500 for bad input.
- **Rate limits:**
  - Per IP: challenge 30 a minute, verify 10 a minute, wallet signup 10 a minute (the same as signup), reset-with-wallet 10 a minute.
  - Per user: email change 5 an hour, password change 10 an hour.
- **Limits:**
  - Up to 5 wallets per account and one email.
  - A wallet signup token lasts 15 minutes and is single-use.
  - Nonces and tokens older than a day are deleted when a new one is written.
- **Agents (`kind = 'agent'`) never sign in** by any of these methods.
- **Admin stays a password login.** Reserved usernames (`isReservedUsername`) apply to wallet and email signups.
- **Privacy:**
  - Emails are never shown to anyone but their owner, in settings only; never in `MeView`, `UserSummary` or `UserProfile`.
  - Logs never hold full emails, tokens or signatures.
  - A wallet shows on a profile only when it is verified *and* `show_on_profile` is on (off by default).
- **Sessions:** the existing `sx_session` cookie: 30 days, httpOnly, `sameSite=lax`, secure in production. A password change or a wallet reset deletes the user's other sessions and drops their sockets.
- **Commits:** `feat(auth): …` / `fix(auth): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:**
  - Server: `cd apps/server && npx vitest run <file>`, using `testDb()` / `makeTestApp()`, never `createDb({})`.
  - Web: `cd apps/web && npx vitest run <file>`.
  - All of: `npm run typecheck`.
  - Write the failing test first.

## Deviations from the spec (decided here; the controller should know)

1. **Web libraries.** The plan uses the Wallet Standard registry directly (`@wallet-standard/app` `getWallets()`, plus the feature types) instead of `@wallet-standard/react@1.0.3` + `@solana/react@8.4.0`. The registry and detection are the same; this route avoids the Kit peer dependencies of `@solana/react` and the UI-handle mapping. The wallet code is about 80 lines we own (`registry.ts`, `sign.ts`).
2. **Password reset with a wallet** uses a new nonce purpose, `reset`, which works signed out, instead of `confirm`. Spec §3.1 says `confirm` needs a session, and a person who forgot their password has none.
3. **The signup route stays `POST /api/auth/signup`.** The spec calls it `/api/auth/register`; that route doesn't exist and nothing else changes.
4. **`wallet_links` is copied but not dropped in this stream.** Under the merge rule (contract §2), a regenerated migration would put `DROP TABLE wallet_links` *before* the custom copy and lose the data. The table stays in `schema.ts` marked deprecated and nothing reads or writes it after Task 6. **The controller drops it in a one-line cleanup migration after every stream has merged** (see Controller notes).
5. **Removing the email has no last-method guard.** Email login always needs the password, and username + password works whenever email + password would, so removing the email can never lock anyone out.
6. **MAINNET seams.** `payoutEnabled(config)` returns `false` and `payoutHeld(db, userId)` returns `false` in `services/wallets.ts`. The `PAYOUT_OFF` / `PAYOUT_LOCKED` paths exist and are tested with the seams; MAINNET replaces the two bodies and adds the 72-hour payout hold.
7. **Bundle.** `vite.config.ts` gains a `wallet` code-splitting group (priority above `vendor`) so the wallet libraries don't land in the eager `vendor` chunk. It also gains an `optimizeDeps.include` for the wallet packages, so the dev server never reloads mid-e2e.

## Review Focus

These are the five failure modes that no task's main tests target, most likely first. Each has a pinning test in the task named.

1. **A taken username on the wallet "Pick a username" step must not burn the signup token.** The person retries with another name, without signing again. Pinned in Task 4: `a taken name doesn't burn the token`.
2. **A double submit, or a replay of one signature, succeeds exactly once.** This covers two tabs and a double click. Pinned in Task 3: `a double submit of one signature succeeds once`.
3. **Malformed wallet input is a 400, never a 500.** The cases are a 31-byte address, invalid base58, a 63-byte signature, non-base64 text, and SIWS text with fields the server never issued. Pinned in Task 2 (`rejects fields the server never issued`) and Task 3 (`malformed input is a 400, never a 500`).
4. **Mixed-case email at signup and login.** `Ape@Example.COM` signs up, and `ape@example.com` / `APE@EXAMPLE.COM` both log in. Taken in any case gives `EMAIL_TAKEN`. Pinned in Task 5.
5. **A wallet-only account (no password):**
   - username login with any password gets the generic 401;
   - it can't remove its only verified wallet;
   - setting a password needs a wallet `confirm` signature, never a password proof.
   Pinned in Task 5 (`same 401 for…`), Task 7 (`the last-method guard`) and Task 8 (`a wallet-only account sets a password with a confirm signature`).

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/auth.ts` (new) | Auth types and constants: `WalletPurpose`, `SiwsInput`, `WalletChallenge`, `WalletProof`, `WalletVerifyResult`, `WalletView`, `SignInView`, `ProfileWallet`, `AccountProof`, `AUTH_LIMITS`, `WALLET_STATEMENTS` |
| `packages/shared/src/types.ts` | `SettingsView.wallet → signIn` (Task 6), `UserProfile.wallet → wallets` (Task 9) |
| `packages/shared/src/constants.ts` | drop `COPY.holdingsNote` (Task 9) |
| `apps/server/src/db/schema.ts` | `users.email` + index; LOGIN block: `userWallets`, `authNonces`, `authTokens`; `walletLinks` marked deprecated |
| `apps/server/drizzle/0007_login_tables.sql` (generated), `0008_login_data.sql` (custom) | tables + the `wallet_links` copy |
| `apps/server/src/lib/siws.ts` (new) | pure SIWS + Ed25519 helpers |
| `apps/server/src/lib/pg-errors.ts` (new) | `isUniqueViolation` (moved out of `routes/auth.ts`) |
| `apps/server/src/services/accounts.ts` (new) | `meView`, `startSession`, `endOtherSessions`, `usernameTaken`, `emailOwner`, `Username`, `Email`, `emailTaken` |
| `apps/server/src/services/passwords.ts` (new) | `dummyVerify`, `passwordMatches` |
| `apps/server/src/services/wallet-auth.ts` (new) | challenges, nonce claim + proof verification, signup tokens, `WalletProofBody` |
| `apps/server/src/services/wallets.ts` (new) | wallet rows: owner lookup, views, link/unlink/prefs, `payoutWallet` + MAINNET seams |
| `apps/server/src/services/account-proof.ts` (new) | `requireProof` (password or wallet `confirm`) |
| `apps/server/src/services/settings.ts` (new) | `settingsView` (moved out of `routes/me.ts`) |
| `apps/server/src/routes/wallet-auth.ts` (new) | `/auth/wallet/*`, `/auth/password/reset-with-wallet` |
| `apps/server/src/routes/auth.ts` | signup email, login by username or email, dummy hash |
| `apps/server/src/routes/me.ts` | settings view, `/me/email`, `/me/password`, `/me/wallets/:address`; `/me/wallet` removed |
| `apps/server/src/routes/users.ts` | profile `wallets` |
| `apps/web/src/features/auth/wallet/{featured,registry,sign,mobile}.ts`, `WalletGlyph.tsx`, `WalletPicker.tsx`, `wallet.module.css` (new) | wallet detection, signing, picker |
| `apps/web/src/features/auth/WalletButton.tsx`, `ForgotPassword.tsx`, `WalletSignupPage.tsx` (new) | entry button (lazy picker), wallet reset, "Pick a username" |
| `apps/web/src/features/auth/LoginPage.tsx`, `SignupPage.tsx`, `auth.module.css` | the screens in spec §6 |
| `apps/web/src/features/profile/SignInSection.tsx` (new), `SettingsPage.tsx`, `ProfilePage.tsx`, `profile.module.css` | settings and profile |
| `e2e/fake-wallet.ts`, `e2e/wallet-login.spec.ts` (new) | headless e2e with a Node-signed fake wallet |

---

### Task 1: Shared auth types, schema and migrations

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/db/schema.ts` (`users` table, `walletLinks` comment, LOGIN block at the end)
- Create (generated): `apps/server/drizzle/0007_login_tables.sql`, `apps/server/drizzle/meta/0007_snapshot.json`, journal entry
- Create (custom): `apps/server/drizzle/0008_login_data.sql`, its snapshot and journal entry
- Test: `apps/server/test/login-migration.test.ts`

**Interfaces:**
- Produces (shared, `@shillex/shared`):
  - `type WalletPurpose = 'login' | 'reset' | 'link' | 'confirm'`
  - `interface SiwsInput { domain: string; uri: string; statement: string; version: '1'; chainId: 'mainnet'; nonce: string; issuedAt: Iso; expirationTime: Iso; address?: string }`
  - `interface WalletChallenge { nonce: string; input: SiwsInput; message: string | null }`
  - `interface WalletProof { nonce: string; mode: 'signIn' | 'message'; address: string; signedMessage: string; signature: string; walletName?: string | null }` (bytes base64)
  - `type WalletVerifyResult = { status: 'signedIn'; user: MeView } | { status: 'new'; signupToken: string; address: string; walletName: string | null } | { status: 'linked'; settings: SettingsView }`
  - `interface WalletView { address; walletName: string | null; verified: boolean; verifiedAt: Iso | null; showOnProfile: boolean; isPayout: boolean; lastLoginAt: Iso | null }`
  - `interface SignInView { hasPassword: boolean; email: string | null; wallets: WalletView[]; payoutEnabled: boolean }`
  - `interface ProfileWallet { address: string; walletName: string | null; verifiedAt: Iso }`
  - `type AccountProof = { password: string } | { wallet: WalletProof }`
  - `AUTH_LIMITS = { walletsPerAccount: 5, emailMax: 254, walletNameMax: 40, nonceTtlMs: 300_000, signupTokenTtlMs: 900_000 }`
  - `WALLET_STATEMENTS = { login, reset, link(username), confirm }`
- Produces (server schema): `users.email`, `userWallets`, `authNonces`, `authTokens` (row types `UserWalletRow`, `AuthNonceRow`, `AuthTokenRow`).

- [ ] **Step 1: Write the shared types**

Create `packages/shared/src/auth.ts`:

```ts
import type { Iso, MeView, SettingsView } from './types.ts';

/** What a wallet signature is for. `login` and `reset` work signed out; `link` and `confirm` need a session. */
export type WalletPurpose = 'login' | 'reset' | 'link' | 'confirm';

/** The Sign In With Solana fields the server issues for one challenge; the wallet must sign them back unchanged. */
export interface SiwsInput {
  domain: string; uri: string; statement: string; version: '1'; chainId: 'mainnet';
  nonce: string; issuedAt: Iso; expirationTime: Iso;
  /** Set when the challenge was asked for a known address (wallets without `solana:signIn`). */
  address?: string;
}
/** `message` is the exact text to sign with `solana:signMessage`; null when no address was given (the `signIn` path). */
export interface WalletChallenge { nonce: string; input: SiwsInput; message: string | null }
/** A signed challenge. `signIn`: the wallet's own SIWS text; `message`: exactly the challenge's `message`. Bytes are base64. */
export interface WalletProof {
  nonce: string; mode: 'signIn' | 'message'; address: string;
  signedMessage: string; signature: string; walletName?: string | null;
}
export type WalletVerifyResult =
  | { status: 'signedIn'; user: MeView }
  | { status: 'new'; signupToken: string; address: string; walletName: string | null }
  | { status: 'linked'; settings: SettingsView };

/** A wallet on the owner's settings page. `verified` false: an address typed before wallet sign-in existed. */
export interface WalletView {
  address: string; walletName: string | null; verified: boolean; verifiedAt: Iso | null;
  showOnProfile: boolean; isPayout: boolean; lastLoginAt: Iso | null;
}
export interface SignInView { hasPassword: boolean; email: string | null; wallets: WalletView[]; payoutEnabled: boolean }
/** A wallet as anyone sees it on a profile: only signed ones the owner chose to show. */
export interface ProfileWallet { address: string; walletName: string | null; verifiedAt: Iso }
/** Proof for a settings change: the current password, or (accounts with no password) a wallet `confirm` signature. */
export type AccountProof = { password: string } | { wallet: WalletProof };

export const AUTH_LIMITS = { walletsPerAccount: 5, emailMax: 254, walletNameMax: 40, nonceTtlMs: 5 * 60_000, signupTokenTtlMs: 15 * 60_000 } as const;

export const WALLET_STATEMENTS = {
  login: 'Sign in to Shillex. This only proves you own this wallet: it costs nothing and moves no funds.',
  reset: 'Reset the password of your Shillex account. This only proves you own this wallet: it costs nothing and moves no funds.',
  link: (username: string) => `Link this wallet to @${username} on Shillex. It costs nothing and moves no funds.`,
  confirm: 'Confirm a change to your Shillex account. It costs nothing and moves no funds.',
} as const;
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './auth.ts';
```

- [ ] **Step 2: Write the failing migration test**

Create `apps/server/test/login-migration.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asc, sql } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { userWallets, users, walletLinks } from '../src/db/schema.ts';

const dir = fileURLToPath(new URL('../drizzle/', import.meta.url));
/** LOGIN's custom data migration, found by name: the controller renumbers it at merge (parallel-build contract §2). */
function copySql(): string {
  const f = readdirSync(dir).find((n) => n.endsWith('_login_data.sql'));
  if (!f) throw new Error('no *_login_data.sql migration');
  return readFileSync(dir + f, 'utf8');
}
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';

let h: Awaited<ReturnType<typeof testDb>> | null = null;
afterEach(async () => { await h?.close(); h = null; });

describe('LOGIN migration', () => {
  it('adds the sign-in tables and the email column', async () => {
    h = await testDb();
    const t = await h.db.execute(sql`select table_name from information_schema.tables where table_name in ('user_wallets', 'auth_nonces', 'auth_tokens') order by 1`);
    expect((t.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual(['auth_nonces', 'auth_tokens', 'user_wallets']);
    const c = await h.db.execute(sql`select column_name from information_schema.columns where table_name = 'users' and column_name = 'email'`);
    expect(c.rows).toHaveLength(1);
  });

  it('copies typed addresses as unverified rows that keep their show-on-profile choice, one per address, idempotently', async () => {
    h = await testDb();
    const at = new Date('2026-10-01T00:00:00Z');
    // Fixed ids: when two accounts typed the same address, the copy keeps the smallest user id.
    await h.db.insert(users).values(['u_typed_a', 'u_typed_b', 'u_typed_c'].map((id) => ({ id, username: id, displayName: id, createdAt: at })));
    await h.db.insert(walletLinks).values([
      { userId: 'u_typed_a', address: A, displayWallet: true },
      { userId: 'u_typed_b', address: A, displayWallet: false },
      { userId: 'u_typed_c', address: B, displayWallet: false },
    ]);
    for (let run = 0; run < 2; run++) {
      for (const stmt of copySql().split('--> statement-breakpoint')) if (stmt.trim()) await h.db.execute(sql.raw(stmt));
    }
    const rows = await h.db.select().from(userWallets).orderBy(asc(userWallets.address));
    expect(rows.map((r) => [r.address, r.userId, r.verifiedAt, r.showOnProfile, r.isPayout])).toEqual([
      [A, 'u_typed_a', null, true, false],
      [B, 'u_typed_c', null, false, false],
    ]);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd apps/server && npx vitest run test/login-migration.test.ts`
Expected: FAIL, with `userWallets` not exported by `schema.ts` (an import error).

- [ ] **Step 4: Edit the schema**

In `apps/server/src/db/schema.ts`, extend the shared-types import on line 4:

```ts
import type { ChainTxKind,ContextItem, SiwsInput, ToolCallRecord, TurnStatus, TurnTrigger, WalletPurpose } from '@shillex/shared';
```

Change the `users` table to add `email` and its index (keep every other column as is):

```ts
  kind: text('kind').$type<'human' | 'agent'>().notNull().default('human'),
  /** LOGIN: a sign-in name shaped like an address. Never verified, never mailed, never shown to anyone but its owner. */
  email: text('email'),
}, (t) => [
  uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
  uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
]);
```

Mark `walletLinks` as deprecated (leave the table definition unchanged):

```ts
/**
 * @deprecated LOGIN: typed wallet addresses, copied into `user_wallets` (unverified) by the `login_data` migration.
 * Nothing reads or writes it any more; the controller drops it after every parallel stream has merged.
 */
export const walletLinks = pgTable('wallet_links', {
```

Append at the very end of the file:

```ts
// ── LOGIN ──

/** Wallets on an account. The address is the key, so a wallet belongs to one account. `verified_at` null: a typed address from before wallet sign-in. */
export const userWallets = pgTable('user_wallets', {
  address: text('address').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** As the wallet reports its own name; display only. */
  walletName: text('wallet_name'),
  verifiedAt: ts('verified_at'),
  showOnProfile: boolean('show_on_profile').notNull().default(false),
  isPayout: boolean('is_payout').notNull().default(false),
  createdAt: ts('created_at').notNull(),
  lastLoginAt: ts('last_login_at'),
}, (t) => [
  index('user_wallets_user_idx').on(t.userId),
  uniqueIndex('user_wallets_payout_idx').on(t.userId).where(sql`${t.isPayout}`),
]);
export type UserWalletRow = typeof userWallets.$inferSelect;

/** One SIWS challenge. Claimed once (`used_at`), atomically, before its signature is checked. */
export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  purpose: text('purpose').$type<WalletPurpose>().notNull(),
  /** Set for `link` and `confirm`: only this user may use the nonce. */
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  input: jsonb('input').$type<SiwsInput>().notNull(),
  /** The exact text a wallet without `solana:signIn` signs; null when the challenge had no address. */
  message: text('message'),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});
export type AuthNonceRow = typeof authNonces.$inferSelect;

/** One-use tokens, stored as sha256 like sessions. `wallet_signup`: a wallet signed in but has no account yet. */
export const authTokens = pgTable('auth_tokens', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'wallet_signup'>().notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<{ address: string; walletName: string | null }>().notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});
export type AuthTokenRow = typeof authTokens.$inferSelect;
```

- [ ] **Step 5: Generate the structural migration**

Run: `cd apps/server && npx drizzle-kit generate --name login_tables`
Expected: it writes `drizzle/0007_login_tables.sql`, `drizzle/meta/0007_snapshot.json` and a journal entry. Open the SQL and check it holds exactly these:
- `CREATE TABLE "auth_nonces"`, `"auth_tokens"` and `"user_wallets"`
- `ALTER TABLE "users" ADD COLUMN "email" text`
- three foreign keys to `users` with `ON DELETE cascade`
- `CREATE INDEX "user_wallets_user_idx"`
- `CREATE UNIQUE INDEX "user_wallets_payout_idx" … WHERE "user_wallets"."is_payout"`
- `CREATE UNIQUE INDEX "users_email_lower_idx" … (lower("email"))`

There must be **no** `DROP TABLE`. If drizzle-kit asks an interactive rename question, answer "create" for each new table.

- [ ] **Step 6: Write the custom data migration**

Run: `cd apps/server && npx drizzle-kit generate --custom --name login_data`
Expected: it writes an empty `drizzle/0008_login_data.sql` plus its snapshot and journal entry. Replace the file's contents with:

```sql
-- LOGIN custom migration (parallel-build contract §2): carried over unchanged at merge, after LOGIN's generated migration.
-- Typed wallet addresses become unverified user_wallets rows that keep their show-on-profile choice. When two accounts
-- typed the same address, the smallest user id keeps it. Idempotent: replaying it inserts nothing new.
INSERT INTO "user_wallets" ("address", "user_id", "wallet_name", "verified_at", "show_on_profile", "is_payout", "created_at", "last_login_at")
SELECT DISTINCT ON (w."address") w."address", w."user_id", NULL, NULL, w."display_wallet", false, now(), NULL
FROM "wallet_links" w
ORDER BY w."address", w."user_id"
ON CONFLICT ("address") DO NOTHING;
```

- [ ] **Step 7: Run the test to see it pass**

Run: `cd apps/server && npx vitest run test/login-migration.test.ts`
Expected: PASS (2 tests). The global setup re-migrates its snapshot on every run, so the new migrations are included.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add packages/shared/src/auth.ts packages/shared/src/index.ts apps/server/src/db/schema.ts apps/server/drizzle apps/server/test/login-migration.test.ts
git commit -m "feat(auth): user_wallets, auth_nonces, auth_tokens and users.email; typed wallet addresses copied as unverified rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: SIWS and Ed25519 helpers

**Files:**
- Modify: `apps/server/package.json` (dependency)
- Create: `apps/server/src/lib/siws.ts`
- Test: `apps/server/test/login-siws.test.ts`

**Interfaces:**
- Consumes: `SiwsInput`, `WalletPurpose`, `WALLET_STATEMENTS`, `AUTH_LIMITS` (Task 1).
- Produces:
  - `newNonce(): string`
  - `challengeInput(o: { publicUrl: string; purpose: WalletPurpose; username: string | null; nonce: string; now: Date; address?: string }): SiwsInput`
  - `messageText(input: SiwsInput & { address: string }): string`
  - `decodeAddress(address: string): Uint8Array | null`
  - `fromBase64(s: string): Uint8Array | null`
  - `verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean`
  - `signInMatches(issued: SiwsInput, signedText: string, address: string): boolean`

- [ ] **Step 1: Install the SIWS text library**

Run: `npm install --save-exact -w @shillex/server @solana/wallet-standard-util@1.1.4`
Expected: `apps/server/package.json` lists `"@solana/wallet-standard-util": "1.1.4"`, and the lockfile updates.

- [ ] **Step 2: Write the failing tests**

Create `apps/server/test/login-siws.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import { WALLET_STATEMENTS } from '@shillex/shared';
import { challengeInput, decodeAddress, fromBase64, messageText, newNonce, signInMatches, verifyEd25519 } from '../src/lib/siws.ts';

function key() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return { raw, address: bs58.encode(raw), sign: (m: Uint8Array) => new Uint8Array(sign(null, m, privateKey)) };
}
const NOW = new Date('2026-10-13T12:00:00.000Z');
const issued = (address?: string) => challengeInput({ publicUrl: 'https://shillex.example', purpose: 'login', username: null, nonce: 'abc123nonce', now: NOW, address });
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('SIWS helpers', () => {
  it('issues the spec fields from PUBLIC_URL', () => {
    expect(issued()).toEqual({
      domain: 'shillex.example', uri: 'https://shillex.example', statement: WALLET_STATEMENTS.login, version: '1', chainId: 'mainnet',
      nonce: 'abc123nonce', issuedAt: '2026-10-13T12:00:00.000Z', expirationTime: '2026-10-13T12:05:00.000Z',
    });
    const link = challengeInput({ publicUrl: 'http://localhost:5173', purpose: 'link', username: 'anon_ape', nonce: 'n', now: NOW });
    expect(link.domain).toBe('localhost:5173');
    expect(link.statement).toBe('Link this wallet to @anon_ape on Shillex. It costs nothing and moves no funds.');
    expect(challengeInput({ publicUrl: 'http://localhost:5173', purpose: 'reset', username: null, nonce: 'n', now: NOW }).statement).toBe(WALLET_STATEMENTS.reset);
  });

  it('makes nonces of 16 random bytes in base58', () => {
    const n = newNonce();
    expect(bs58.decode(n)).toHaveLength(16);
    expect(newNonce()).not.toBe(n);
  });

  it('decodes 32-byte base58 addresses only', () => {
    const k = key();
    expect(decodeAddress(k.address)).toEqual(k.raw);
    expect(decodeAddress(bs58.encode(new Uint8Array(31)))).toBeNull();
    expect(decodeAddress('0OIl-is-not-base58-at-all-0OIl0OIl')).toBeNull();
  });

  it('checks Ed25519 with node:crypto: another key, a changed message and bad lengths fail', () => {
    const k = key(), other = key();
    const m = utf8('hello'), sig = k.sign(m);
    expect(verifyEd25519(k.raw, m, sig)).toBe(true);
    expect(verifyEd25519(other.raw, m, sig)).toBe(false);
    expect(verifyEd25519(k.raw, utf8('hellO'), sig)).toBe(false);
    expect(verifyEd25519(k.raw, m, sig.subarray(0, 63))).toBe(false);
    expect(verifyEd25519(k.raw.subarray(0, 31), m, sig)).toBe(false);
  });

  it('accepts SIWS text carrying exactly the issued fields for the claimed address', () => {
    const k = key();
    const text = createSignInMessageText({ ...issued(), address: k.address });
    expect(signInMatches(issued(), text, k.address)).toBe(true);
    expect(signInMatches(issued(), text, key().address)).toBe(false);
    expect(signInMatches(issued(key().address), text, k.address)).toBe(false); // the challenge named another address
  });

  it.each(['domain', 'uri', 'statement', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime'] as const)('rejects a changed %s', (field) => {
    const k = key();
    const text = createSignInMessageText({ ...issued(), address: k.address, [field]: `${issued()[field]}x` });
    expect(signInMatches(issued(), text, k.address)).toBe(false);
  });

  it('rejects fields the server never issued, and text that is not SIWS (Review Focus 3)', () => {
    const k = key();
    expect(signInMatches(issued(), createSignInMessageText({ ...issued(), address: k.address, notBefore: '2026-10-13T12:00:00.000Z' }), k.address)).toBe(false);
    expect(signInMatches(issued(), createSignInMessageText({ ...issued(), address: k.address, resources: ['https://evil.example'] }), k.address)).toBe(false);
    expect(signInMatches(issued(), 'not a sign-in message', k.address)).toBe(false);
  });

  it('message mode signs the same SIWS format, with the address', () => {
    const k = key();
    expect(messageText({ ...issued(k.address), address: k.address })).toBe(createSignInMessageText({ ...issued(), address: k.address }));
  });

  it('reads strict base64 only', () => {
    expect(fromBase64('aGVsbG8=')).toEqual(utf8('hello'));
    expect(fromBase64('***')).toBeNull();
    expect(fromBase64('abc')).toBeNull();
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-siws.test.ts`
Expected: FAIL, with `Cannot find module '../src/lib/siws.ts'`.

- [ ] **Step 4: Write the helpers**

Create `apps/server/src/lib/siws.ts`:

```ts
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText, parseSignInMessageText } from '@solana/wallet-standard-util';
import { AUTH_LIMITS, WALLET_STATEMENTS, type SiwsInput, type WalletPurpose } from '@shillex/shared';

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32 raw key bytes follow it. */
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
/** Every field the server issues; each must come back unchanged (spec §3.3 step 4). */
const FIELDS = ['domain', 'uri', 'statement', 'version', 'chainId', 'nonce', 'issuedAt', 'expirationTime'] as const;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** 16 random bytes, base58: 128 bits, as spec §9 asks. */
export const newNonce = () => bs58.encode(randomBytes(16));

/** The SIWS fields for one challenge. Domain and uri come from PUBLIC_URL, never from the request. */
export function challengeInput(o: { publicUrl: string; purpose: WalletPurpose; username: string | null; nonce: string; now: Date; address?: string }): SiwsInput {
  const url = new URL(o.publicUrl);
  const { purpose } = o;
  const statement = purpose === 'link' ? WALLET_STATEMENTS.link(o.username ?? '') : WALLET_STATEMENTS[purpose];
  return {
    domain: url.host, uri: url.origin, statement, version: '1', chainId: 'mainnet', nonce: o.nonce,
    issuedAt: o.now.toISOString(), expirationTime: new Date(o.now.getTime() + AUTH_LIMITS.nonceTtlMs).toISOString(),
    ...(o.address ? { address: o.address } : {}),
  };
}

/** The exact text a wallet without `solana:signIn` signs: the same SIWS format, with the address filled in. */
export const messageText = (input: SiwsInput & { address: string }) => createSignInMessageText(input);

/** The 32 key bytes behind a base58 address, or null for anything else. */
export function decodeAddress(address: string): Uint8Array | null {
  try {
    const b = bs58.decode(address);
    return b.length === 32 ? b : null;
  } catch { return null; }
}

/** Strict base64 (no URL alphabet, padded); null when it isn't. */
export function fromBase64(s: string): Uint8Array | null {
  if (!B64.test(s) || s.length % 4 !== 0) return null;
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, publicKey]), format: 'der', type: 'spki' });
    return verify(null, message, key, signature);
  } catch { return false; }
}

/** True when `signedText` is SIWS text for `address` carrying exactly the issued fields, and no field the server never issued. */
export function signInMatches(issued: SiwsInput, signedText: string, address: string): boolean {
  const p = parseSignInMessageText(signedText);
  if (!p || p.address !== address) return false;
  if (issued.address !== undefined && issued.address !== address) return false;
  if (p.notBefore !== undefined || p.requestId !== undefined || p.resources !== undefined) return false;
  return FIELDS.every((k) => p[k] === issued[k]);
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-siws.test.ts`
Expected: PASS (all cases, including the 8 `it.each` rows).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/server/package.json package-lock.json apps/server/src/lib/siws.ts apps/server/test/login-siws.test.ts
git commit -m "feat(auth): SIWS challenge fields from PUBLIC_URL, field-by-field message checks, Ed25519 through node:crypto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wallet challenge and sign-in

**Files:**
- Create: `apps/server/src/lib/pg-errors.ts`
- Create: `apps/server/src/services/accounts.ts`
- Create: `apps/server/src/services/wallet-auth.ts`
- Create: `apps/server/src/services/wallets.ts`
- Create: `apps/server/src/routes/wallet-auth.ts`
- Modify: `apps/server/src/routes/auth.ts` (use the shared helpers)
- Modify: `apps/server/src/app.ts:66` (register the routes)
- Test: `apps/server/test/wallet-helpers.ts`, `apps/server/test/login-wallet.test.ts`

**Interfaces:**
- Consumes: Task 2's helpers; Task 1's tables.
- Produces:
  - `isUniqueViolation(e: unknown): boolean` (`lib/pg-errors.ts`)
  - `meView(db, u: UserRow): Promise<MeView>`, `startSession(app, reply, userId): Promise<void>`, `endOtherSessions(app, req, userId): Promise<void>`, `usernameTaken(db, name): Promise<boolean>`, `emailOwner(db, email): Promise<string | null>`, `Username` (zod) (`services/accounts.ts`)
  - `WalletProofBody` (zod), `issueChallenge(deps, { purpose, user, address? }): Promise<WalletChallenge>`, `verifyProof(deps, proof, purpose, userId | null): Promise<{ address: string; walletName: string | null }>`, `issueSignupToken(deps, data): Promise<string>` (`services/wallet-auth.ts`)
  - `verifiedWalletOwner(db, address): Promise<UserRow | null>`, `touchLogin(db, address, now)`, `payoutWallet(db, userId): Promise<string | null>`, `payoutEnabled(config): boolean`, `payoutHeld(db, userId): Promise<boolean>`, `WALLET_IN_USE` (`services/wallets.ts`)
  - Routes: `POST /api/auth/wallet/challenge {purpose, address?} → WalletChallenge`; `POST /api/auth/wallet/verify {…WalletProof, purpose: 'login'} → WalletVerifyResult`
  - Test helpers: `testWallet()`, `challenge()`, `signInProof()`, `messageProof()`, `walletPost()`

- [ ] **Step 1: Write the test helpers**

Create `apps/server/test/wallet-helpers.ts`:

```ts
import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import type { SiwsInput, WalletChallenge, WalletProof, WalletPurpose } from '@shillex/shared';
import type { TestCtx, TestUser } from './helpers.ts';

export interface TestWallet { address: string; sign(message: Uint8Array): Uint8Array }
/** A real Ed25519 keypair standing in for a wallet. */
export function testWallet(): TestWallet {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: bs58.encode(raw), sign: (m) => new Uint8Array(sign(null, m, privateKey)) };
}
export const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const utf8 = (s: string) => new TextEncoder().encode(s);
type SignInText = Parameters<typeof createSignInMessageText>[0];

export async function challenge(ctx: TestCtx, user: TestUser | null, purpose: WalletPurpose, address?: string): Promise<WalletChallenge> {
  const r = await ctx.as(user).post('/api/auth/wallet/challenge', address ? { purpose, address } : { purpose });
  if (r.status !== 200) throw new Error(`challenge ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body as WalletChallenge;
}

/** A `signIn`-mode proof: the SIWS text a wallet builds from the challenge, signed by `signer` (default: the wallet). */
export async function signInProof(ctx: TestCtx, w: TestWallet, purpose: WalletPurpose, user: TestUser | null = null,
  o: { edit?: (fields: SiwsInput & { address: string }) => object; signer?: TestWallet } = {}): Promise<WalletProof> {
  const ch = await challenge(ctx, user, purpose);
  const fields = { ...ch.input, address: w.address };
  const bytes = utf8(createSignInMessageText((o.edit ? o.edit(fields) : fields) as SignInText));
  return { nonce: ch.nonce, mode: 'signIn', address: w.address, signedMessage: b64(bytes), signature: b64((o.signer ?? w).sign(bytes)), walletName: 'Phantom' };
}

/** A `message`-mode proof: the challenge asked for this address, and the wallet signs its `message` (or `text(message)`). */
export async function messageProof(ctx: TestCtx, w: TestWallet, purpose: WalletPurpose, user: TestUser | null = null,
  o: { text?: (message: string) => string } = {}): Promise<WalletProof> {
  const ch = await challenge(ctx, user, purpose, w.address);
  const bytes = utf8(o.text ? o.text(ch.message!) : ch.message!);
  return { nonce: ch.nonce, mode: 'message', address: w.address, signedMessage: b64(bytes), signature: b64(w.sign(bytes)), walletName: 'Solflare' };
}

export interface Posted { status: number; body: any; cookie: string | null }
/** POST through inject, keeping the session cookie the reply set (if any). */
export async function walletPost(ctx: TestCtx, url: string, payload: unknown, user: TestUser | null = null): Promise<Posted> {
  const r = await ctx.app.inject({ method: 'POST', url, payload: payload as object, headers: user ? { cookie: user.cookie } : {} });
  const set = r.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : set;
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, cookie: first ? String(first).split(';')[0]! : null };
}
```

- [ ] **Step 2: Write the failing route tests**

Create `apps/server/test/login-wallet.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import bs58 from 'bs58';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { b64, challenge, messageProof, signInProof, testWallet, walletPost } from './wallet-helpers.ts';
import { authNonces, userWallets } from '../src/db/schema.ts';

const VERIFY = '/api/auth/wallet/verify';
let ctx: TestCtx;
// A fresh app per test: the verify route allows 10 calls a minute per IP.
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

describe('wallet challenge', () => {
  it('issues and stores a challenge bound to PUBLIC_URL', async () => {
    const r = await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'login' });
    expect(r.status).toBe(200);
    expect(r.body.input).toMatchObject({ domain: 'localhost:5173', uri: 'http://localhost:5173', version: '1', chainId: 'mainnet', nonce: r.body.nonce });
    expect(r.body.message).toBeNull();
    const [row] = await ctx.db.select().from(authNonces).where(eq(authNonces.nonce, r.body.nonce));
    expect(row).toMatchObject({ purpose: 'login', userId: null, usedAt: null });
  });

  it('builds the message to sign when an address is given, and refuses a non-address', async () => {
    const w = testWallet();
    const ch = await challenge(ctx, null, 'login', w.address);
    expect(ch.message).toContain(`${w.address}\n\nSign in to Shillex.`);
    expect((await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'login', address: bs58.encode(new Uint8Array(31)) })).status).toBe(400);
  });

  it('link and confirm need a session', async () => {
    expect((await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'link' })).status).toBe(401);
    expect((await ctx.as(null).post('/api/auth/wallet/challenge', { purpose: 'confirm' })).status).toBe(401);
  });
});

describe('wallet sign-in', () => {
  it('an unknown wallet, in either mode, gets a signup token and no session', async () => {
    for (const make of [signInProof, messageProof]) {
      const w = testWallet();
      const r = await walletPost(ctx, VERIFY, { ...(await make(ctx, w, 'login')), purpose: 'login' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'new', address: w.address, signupToken: expect.any(String) });
      expect(r.cookie).toBeNull();
    }
  });

  it('a verified wallet signs its owner in and records the login', async () => {
    const u = await ctx.createUser('wallet_owner');
    const w = testWallet();
    await ctx.db.insert(userWallets).values({ address: w.address, userId: u.id, walletName: 'Phantom', verifiedAt: ctx.clock.now(), createdAt: ctx.clock.now() });
    const r = await walletPost(ctx, VERIFY, { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
    expect(r.body).toMatchObject({ status: 'signedIn', user: { username: 'wallet_owner' } });
    expect(r.cookie).toMatch(/^sx_session=/);
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: r.cookie! } });
    expect(me.json().user.username).toBe('wallet_owner');
    expect((await ctx.db.select().from(userWallets))[0]!.lastLoginAt).not.toBeNull();
  });

  it('a typed (unverified) address never signs anyone in', async () => {
    const u = await ctx.createUser('typed_owner');
    const w = testWallet();
    await ctx.db.insert(userWallets).values({ address: w.address, userId: u.id, verifiedAt: null, createdAt: ctx.clock.now() });
    const r = await walletPost(ctx, VERIFY, { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
    expect(r.body.status).toBe('new');
    expect(r.cookie).toBeNull();
  });

  it('replay, expiry and an unknown nonce all give CHALLENGE_EXPIRED', async () => {
    const w = testWallet();
    const p = { ...(await signInProof(ctx, w, 'login')), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, p)).status).toBe(200);
    const replay = await walletPost(ctx, VERIFY, p);
    expect([replay.status, replay.body.code]).toEqual([400, 'CHALLENGE_EXPIRED']);
    const late = { ...(await signInProof(ctx, w, 'login')), purpose: 'login' };
    ctx.clock.advance(5 * 60_000 + 1);
    expect((await walletPost(ctx, VERIFY, late)).body.code).toBe('CHALLENGE_EXPIRED');
    expect((await walletPost(ctx, VERIFY, { ...p, nonce: 'no-such-nonce-at-all' })).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('a double submit of one signature succeeds once (Review Focus 2)', async () => {
    const p = { ...(await signInProof(ctx, testWallet(), 'login')), purpose: 'login' };
    const rs = await Promise.all([walletPost(ctx, VERIFY, p), walletPost(ctx, VERIFY, p)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('a nonce issued for one purpose is useless for another', async () => {
    const w = testWallet();
    const ch = await challenge(ctx, null, 'reset');
    const p = await signInProof(ctx, w, 'login');
    expect((await walletPost(ctx, VERIFY, { ...p, nonce: ch.nonce, purpose: 'login' })).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('rejects a signature by another key, and a message that differs from the issued one', async () => {
    const w = testWallet();
    const byOther = { ...(await signInProof(ctx, w, 'login', null, { signer: testWallet() })), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, byOther)).body.code).toBe('SIGN_IN_INVALID');
    const edited = { ...(await messageProof(ctx, w, 'login', null, { text: (m) => m.replace('Sign in', 'Sign up') })), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, edited)).body.code).toBe('SIGN_IN_INVALID');
    const wrongField = { ...(await signInProof(ctx, w, 'login', null, { edit: (f) => ({ ...f, domain: 'evil.example' }) })), purpose: 'login' };
    expect((await walletPost(ctx, VERIFY, wrongField)).body.code).toBe('SIGN_IN_INVALID');
  });

  it('malformed input is a 400, never a 500 (Review Focus 3)', async () => {
    const w = testWallet();
    const cases: ((p: Record<string, unknown>) => Record<string, unknown>)[] = [
      (p) => ({ ...p, address: bs58.encode(new Uint8Array(31).fill(1)) }),
      (p) => ({ ...p, address: '0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl' }),
      (p) => ({ ...p, signature: b64(new Uint8Array(63)) }),
      (p) => ({ ...p, signedMessage: '***not base64***' }),
    ];
    for (const breakIt of cases) {
      const r = await walletPost(ctx, VERIFY, breakIt({ ...(await signInProof(ctx, w, 'login')), purpose: 'login' }));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('SIGN_IN_INVALID');
    }
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-wallet.test.ts`
Expected: FAIL, with every test hitting `404` from `/api/auth/wallet/challenge` (the "challenge 404" error from the helper).

- [ ] **Step 4: Move `isUniqueViolation` and the session helpers out of `routes/auth.ts`**

Create `apps/server/src/lib/pg-errors.ts`:

```ts
/** True when `e`, or a cause up to four levels down, is a Postgres unique violation (23505). */
export const isUniqueViolation = (e: unknown): boolean => {
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) if (x.code === '23505') return true;
  return false;
};
```

Create `apps/server/src/services/accounts.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AUTH_LIMITS, type MeView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { notifications, sessions, users, type UserRow } from '../db/schema.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, hashToken } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { toUserSummary } from './users.ts';

export const Username = z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 letters, numbers or underscores');
/** An unverified sign-in email: trimmed, lowercased, at most 254 characters, shaped like an address. */
export const Email = z.string().trim().toLowerCase().max(AUTH_LIMITS.emailMax).pipe(z.email());
export const emailTaken = () => errors.conflict('EMAIL_TAKEN', 'That email is already used on Shillex');

export async function meView(db: Db, u: UserRow): Promise<MeView> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.userId, u.id), isNull(notifications.readAt)));
  return { ...toUserSummary(u), unreadNotifications: row?.n ?? 0, createdAt: u.createdAt.toISOString(), mutedWords: u.mutedWords };
}

/** Creates a session for `userId` and sets the `sx_session` cookie (30 days, httpOnly, lax, secure in production). */
export async function startSession(app: FastifyInstance, reply: FastifyReply, userId: string): Promise<void> {
  const { db, config, now } = app.deps;
  reply.setCookie(SESSION_COOKIE, await createSession(db, userId, now()), {
    path: '/', httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production', maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Deletes every session of `userId` except the one this request uses (all of them when signed out), and drops their sockets. */
export async function endOtherSessions(app: FastifyInstance, req: FastifyRequest, userId: string): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  const keep = token ? hashToken(token) : null;
  const ids = (await app.deps.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)))
    .map((r) => r.id).filter((id) => id !== keep);
  if (!ids.length) return;
  await app.deps.db.delete(sessions).where(inArray(sessions.id, ids));
  for (const id of ids) app.deps.bus.disconnectSession(id);
}

export async function usernameTaken(db: Db, name: string): Promise<boolean> {
  return (await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${name.toLowerCase()}`).limit(1)).length > 0;
}
/** The id of the account using this email (any case), if one does. */
export async function emailOwner(db: Db, email: string): Promise<string | null> {
  const [r] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
  return r?.id ?? null;
}
```

Rewrite `apps/server/src/routes/auth.ts` to use them. Behaviour is unchanged in this task; the existing `test/auth.test.ts` must stay green.

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hash, verify } from '@node-rs/argon2';
import { sql, eq } from 'drizzle-orm';
import { users } from '../db/schema.ts';
import { parse } from '../lib/validate.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { SESSION_COOKIE, destroySession, hashToken } from '../lib/auth.ts';
import { Username, meView, startSession, usernameTaken } from '../services/accounts.ts';
import type { UserRow } from '../db/schema.ts';

const Signup = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), password: z.string().min(8).max(128) });
const Login = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(128) });

export default async function authRoutes(app: FastifyInstance) {
  const { db, config, now } = app.deps;

  app.post('/auth/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Signup, req.body);
    if (isReservedUsername(config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
    if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    const id = newId();
    const passwordHash = await hash(body.password);
    let u: UserRow | undefined;
    try {
      [u] = await db.insert(users).values({ id, username: body.username, displayName: body.displayName, passwordHash, createdAt: now() }).returning();
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
      throw e;
    }
    await startSession(app, reply, id);
    return reply.status(201).send({ user: await meView(db, u!) });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(Login, req.body);
    const [u] = await db.select().from(users).where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`).limit(1);
    if (!u || !u.passwordHash || !(await verify(u.passwordHash, body.password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password');
    }
    await startSession(app, reply, u.id);
    return { user: await meView(db, u) };
  });

  app.post('/auth/demo', async (_req, reply) => {
    const [u] = await db.select().from(users).where(eq(users.username, 'demo')).limit(1);
    if (!u) throw errors.notFound('Demo account (run npm run seed)');
    await startSession(app, reply, u.id);
    return { user: await meView(db, u) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const t = req.cookies[SESSION_COOKIE];
    if (t) { await destroySession(db, t); app.deps.bus.disconnectSession(hashToken(t)); }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => ({ user: req.user ? await meView(db, req.user) : null }));
}
```

- [ ] **Step 5: Write the wallet services**

Create `apps/server/src/services/wallets.ts`:

```ts
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { userWallets, users, type UserRow } from '../db/schema.ts';

export const WALLET_IN_USE = 'This wallet is linked to another Shillex account. Sign in with it there and unlink it first.';

/** The account a verified wallet signs into. Humans only: agents never sign in with a wallet. */
export async function verifiedWalletOwner(db: Db, address: string): Promise<UserRow | null> {
  const [r] = await db.select({ u: users }).from(userWallets).innerJoin(users, eq(users.id, userWallets.userId))
    .where(and(eq(userWallets.address, address), isNotNull(userWallets.verifiedAt), eq(users.kind, 'human'))).limit(1);
  return r?.u ?? null;
}

export async function touchLogin(db: Db, address: string, now: Date): Promise<void> {
  await db.update(userWallets).set({ lastLoginAt: now }).where(eq(userWallets.address, address));
}

/** Parallel-build contract §4 (MAINNET): the user's verified payout wallet, the only place withdrawals may go. */
export async function payoutWallet(db: Db, userId: string): Promise<string | null> {
  const [r] = await db.select({ a: userWallets.address }).from(userWallets)
    .where(and(eq(userWallets.userId, userId), eq(userWallets.isPayout, true), isNotNull(userWallets.verifiedAt))).limit(1);
  return r?.a ?? null;
}

/** MAINNET seam: whether payout wallets exist yet. LOGIN ships it off; the mainnet plan returns its launch-gate state. */
export const payoutEnabled = (_config: Config): boolean => false;
/** MAINNET seam: true while the user's agent holds mainnet funds, which locks the payout wallet. LOGIN ships it false. */
export async function payoutHeld(_db: Db, _userId: string): Promise<boolean> { return false; }
```

Create `apps/server/src/services/wallet-auth.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { AUTH_LIMITS, type WalletChallenge, type WalletProof, type WalletPurpose } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import type { Db } from '../db/client.ts';
import { authNonces, authTokens } from '../db/schema.ts';
import { hashToken } from '../lib/auth.ts';
import { AppError } from '../lib/errors.ts';
import { challengeInput, decodeAddress, fromBase64, messageText, newNonce, signInMatches, verifyEd25519 } from '../lib/siws.ts';

type Deps = Pick<AppDeps, 'db' | 'config' | 'now'>;
const DAY_MS = 24 * 60 * 60_000;

export const WalletProofBody = z.object({
  nonce: z.string().min(8).max(64),
  mode: z.enum(['signIn', 'message']),
  address: z.string().min(32).max(44),
  signedMessage: z.string().min(1).max(4096),
  signature: z.string().min(1).max(128),
  walletName: z.string().trim().max(AUTH_LIMITS.walletNameMax).nullish(),
});

const expired = () => new AppError(400, 'CHALLENGE_EXPIRED', 'That sign-in request expired. Try again.');
const invalid = () => new AppError(400, 'SIGN_IN_INVALID', 'The wallet signature didn’t check out. Try again.');

/** Stores and returns a fresh SIWS challenge. Nonces older than a day are cleared on the way (no separate job). */
export async function issueChallenge(deps: Deps, o: { purpose: WalletPurpose; user: { id: string; username: string } | null; address?: string }): Promise<WalletChallenge> {
  const now = deps.now();
  await deps.db.delete(authNonces).where(lt(authNonces.createdAt, new Date(now.getTime() - DAY_MS)));
  const nonce = newNonce();
  const input = challengeInput({ publicUrl: deps.config.publicUrl, purpose: o.purpose, username: o.user?.username ?? null, nonce, now, address: o.address });
  const message = o.address ? messageText({ ...input, address: o.address }) : null;
  await deps.db.insert(authNonces).values({ nonce, purpose: o.purpose, userId: o.user?.id ?? null, input, message, createdAt: now, expiresAt: new Date(input.expirationTime) });
  return { nonce, input, message };
}

/**
 * Checks a signed challenge (spec §3.3) and returns the wallet it proves. The nonce is claimed first, in one atomic update,
 * so a bad signature still burns it and nothing can be replayed. `userId` binds `link` and `confirm` nonces to their user.
 */
export async function verifyProof(deps: Deps, proof: WalletProof, purpose: WalletPurpose, userId: string | null): Promise<{ address: string; walletName: string | null }> {
  const now = deps.now();
  const [row] = await deps.db.update(authNonces).set({ usedAt: now }).where(and(
    eq(authNonces.nonce, proof.nonce), eq(authNonces.purpose, purpose), isNull(authNonces.usedAt), gt(authNonces.expiresAt, now),
    userId ? eq(authNonces.userId, userId) : isNull(authNonces.userId),
  )).returning();
  if (!row) throw expired();
  const key = decodeAddress(proof.address);
  const signed = fromBase64(proof.signedMessage);
  const signature = fromBase64(proof.signature);
  if (!key || !signed || !signature) throw invalid();
  if (proof.mode === 'message') {
    if (row.message === null || row.input.address !== proof.address || !Buffer.from(signed).equals(Buffer.from(row.message, 'utf8'))) throw invalid();
  } else if (!signInMatches(row.input, new TextDecoder().decode(signed), proof.address)) throw invalid();
  if (!verifyEd25519(key, signed, signature)) throw invalid();
  return { address: proof.address, walletName: proof.walletName?.trim() || null };
}

/** A one-use token (15 minutes) letting a just-signed, unknown wallet pick a username. Stored as sha256 like sessions. */
export async function issueSignupToken(deps: Deps, data: { address: string; walletName: string | null }): Promise<string> {
  const now = deps.now();
  await deps.db.delete(authTokens).where(lt(authTokens.createdAt, new Date(now.getTime() - DAY_MS)));
  const token = randomBytes(32).toString('base64url');
  await deps.db.insert(authTokens).values({ id: hashToken(token), kind: 'wallet_signup', userId: null, data, createdAt: now, expiresAt: new Date(now.getTime() + AUTH_LIMITS.signupTokenTtlMs) });
  return token;
}

/** Claims a signup token inside the caller's transaction; null when it is unknown, used or expired. */
export async function claimSignupToken(tx: Db, token: string, now: Date): Promise<{ address: string; walletName: string | null } | null> {
  const [row] = await tx.update(authTokens).set({ usedAt: now }).where(and(
    eq(authTokens.id, hashToken(token)), eq(authTokens.kind, 'wallet_signup'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now),
  )).returning();
  return row?.data ?? null;
}
```

- [ ] **Step 6: Write the routes and register them**

Create `apps/server/src/routes/wallet-auth.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WalletVerifyResult } from '@shillex/shared';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { decodeAddress } from '../lib/siws.ts';
import { parse } from '../lib/validate.ts';
import { meView, startSession } from '../services/accounts.ts';
import { WalletProofBody, issueChallenge, issueSignupToken, verifyProof } from '../services/wallet-auth.ts';
import { touchLogin, verifiedWalletOwner } from '../services/wallets.ts';

const Challenge = z.object({ purpose: z.enum(['login', 'reset', 'link', 'confirm']), address: z.string().min(32).max(44).optional() });

export default async function walletAuthRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, now } = deps;

  app.post('/auth/wallet/challenge', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(Challenge, req.body);
    if (body.address && !decodeAddress(body.address)) throw errors.badRequest('BAD_ADDRESS', 'That isn’t a Solana address');
    const user = body.purpose === 'link' || body.purpose === 'confirm' ? requireUser(req) : null;
    return issueChallenge(deps, { purpose: body.purpose, user, address: body.address });
  });

  app.post('/auth/wallet/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<WalletVerifyResult> => {
    const body = parse(WalletProofBody.extend({ purpose: z.enum(['login']) }), req.body);
    const w = await verifyProof(deps, body, 'login', null);
    const owner = await verifiedWalletOwner(db, w.address);
    if (owner) {
      await touchLogin(db, w.address, now());
      await startSession(app, reply, owner.id);
      return { status: 'signedIn', user: await meView(db, owner) };
    }
    return { status: 'new', signupToken: await issueSignupToken(deps, w), address: w.address, walletName: w.walletName };
  });
}
```

In `apps/server/src/app.ts`, import it next to `authRoutes` and register it right after:

```ts
import walletAuthRoutes from './routes/wallet-auth.ts';
```

```ts
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(walletAuthRoutes, { prefix: '/api' });
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-wallet.test.ts test/auth.test.ts`
Expected: PASS, both files.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/server/src/lib/pg-errors.ts apps/server/src/services/accounts.ts apps/server/src/services/wallets.ts apps/server/src/services/wallet-auth.ts apps/server/src/routes/wallet-auth.ts apps/server/src/routes/auth.ts apps/server/src/app.ts apps/server/test/wallet-helpers.ts apps/server/test/login-wallet.test.ts
git commit -m "feat(auth): sign in with a wallet — one-use challenges from PUBLIC_URL, atomic nonce claim, both signing modes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A new account from a wallet

**Files:**
- Modify: `apps/server/src/routes/wallet-auth.ts`
- Modify: `apps/server/test/wallet-helpers.ts` (add `walletAccount`)
- Test: `apps/server/test/login-wallet-signup.test.ts`

**Interfaces:**
- Consumes: `claimSignupToken` (Task 3), `Username`, `usernameTaken`, `startSession`, `meView`, `isUniqueViolation`, `WALLET_IN_USE`.
- Produces:
  - `POST /api/auth/wallet/signup {signupToken, username, displayName?}`: `201 {user: MeView}`. Error codes: `400 SIGNUP_EXPIRED`, `409 USERNAME_TAKEN | USERNAME_RESERVED | WALLET_IN_USE`.
  - Test helper `walletAccount(ctx, w, username): Promise<TestUser>`.

- [ ] **Step 1: Add the test helper**

Append to `apps/server/test/wallet-helpers.ts`:

```ts
/** A wallet-only account made through the real signup flow, returned as a TestUser. */
export async function walletAccount(ctx: TestCtx, w: TestWallet, username: string): Promise<TestUser> {
  const v = await walletPost(ctx, '/api/auth/wallet/verify', { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
  const s = await walletPost(ctx, '/api/auth/wallet/signup', { signupToken: v.body.signupToken, username });
  if (s.status !== 201) throw new Error(`wallet signup ${s.status}: ${JSON.stringify(s.body)}`);
  return { id: s.body.user.id, username, cookie: s.cookie! };
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/server/test/login-wallet-signup.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { signInProof, testWallet, walletAccount, walletPost, type TestWallet } from './wallet-helpers.ts';
import { userWallets, users } from '../src/db/schema.ts';

const SIGNUP = '/api/auth/wallet/signup';
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

async function tokenFor(w: TestWallet): Promise<string> {
  const v = await walletPost(ctx, '/api/auth/wallet/verify', { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
  return v.body.signupToken as string;
}

describe('wallet signup', () => {
  it('creates a wallet-only account with a verified wallet and signs it in', async () => {
    const w = testWallet();
    const r = await walletPost(ctx, SIGNUP, { signupToken: await tokenFor(w), username: 'wallet_ape' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ username: 'wallet_ape', displayName: 'wallet_ape' });
    expect(r.cookie).toMatch(/^sx_session=/);
    const [u] = await ctx.db.select().from(users).where(eq(users.username, 'wallet_ape'));
    expect(u!.passwordHash).toBeNull();
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, w.address));
    expect(row).toMatchObject({ userId: u!.id, walletName: 'Phantom', showOnProfile: false });
    expect(row!.verifiedAt).not.toBeNull();
  });

  it('then the same wallet signs straight in', async () => {
    const w = testWallet();
    await walletAccount(ctx, w, 'returning_ape');
    const again = await walletPost(ctx, '/api/auth/wallet/verify', { ...(await signInProof(ctx, w, 'login')), purpose: 'login' });
    expect(again.body).toMatchObject({ status: 'signedIn', user: { username: 'returning_ape' } });
  });

  it('a token works once, and not after 15 minutes', async () => {
    const token = await tokenFor(testWallet());
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'first_use' })).status).toBe(201);
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'second_use' })).body.code).toBe('SIGNUP_EXPIRED');
    const late = await tokenFor(testWallet());
    ctx.clock.advance(15 * 60_000 + 1);
    expect((await walletPost(ctx, SIGNUP, { signupToken: late, username: 'too_late' })).body.code).toBe('SIGNUP_EXPIRED');
  });

  it('a taken name doesn’t burn the token (Review Focus 1); reserved names are refused', async () => {
    await ctx.createUser('taken_name');
    const token = await tokenFor(testWallet());
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'TAKEN_NAME' })).body.code).toBe('USERNAME_TAKEN');
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'admin' })).body.code).toBe('USERNAME_RESERVED');
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'free_name' })).status).toBe(201);
  });

  it('a typed address on another account gives way; a verified one refuses', async () => {
    const typedOwner = await ctx.createUser('typed_it');
    const w = testWallet();
    await ctx.db.insert(userWallets).values({ address: w.address, userId: typedOwner.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await walletPost(ctx, SIGNUP, { signupToken: await tokenFor(w), username: 'real_owner' })).status).toBe(201);
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, w.address));
    expect(row!.userId).not.toBe(typedOwner.id);

    // Another account verified the wallet after this one signed (a race): the signup must not steal it.
    const w2 = testWallet();
    const token = await tokenFor(w2);
    const other = await ctx.createUser('got_there_first');
    await ctx.db.insert(userWallets).values({ address: w2.address, userId: other.id, verifiedAt: ctx.clock.now(), createdAt: ctx.clock.now() });
    expect((await walletPost(ctx, SIGNUP, { signupToken: token, username: 'too_slow' })).body.code).toBe('WALLET_IN_USE');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-wallet-signup.test.ts`
Expected: FAIL, with `404` from `/api/auth/wallet/signup`.

- [ ] **Step 4: Add the signup route**

In `apps/server/src/routes/wallet-auth.ts`, extend the imports:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { userWallets, users, type UserRow } from '../db/schema.ts';
import { AppError, errors } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isUniqueViolation } from '../lib/pg-errors.ts';
import { isReservedUsername } from '../lib/reserved.ts';
import { Username, meView, startSession, usernameTaken } from '../services/accounts.ts';
import { WalletProofBody, claimSignupToken, issueChallenge, issueSignupToken, verifyProof } from '../services/wallet-auth.ts';
import { WALLET_IN_USE, touchLogin, verifiedWalletOwner } from '../services/wallets.ts';
```

(`errors` is now imported together with `AppError`; remove the old single `errors` import.) Add the schema at module level:

```ts
const WalletSignup = z.object({ signupToken: z.string().min(20).max(100), username: Username, displayName: z.string().trim().min(1).max(40).optional() });
```

Inside `walletAuthRoutes`, after the verify route, add (and take `config` from `deps`: `const { db, config, now } = deps;`):

```ts
  app.post('/auth/wallet/signup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(WalletSignup, req.body);
    if (isReservedUsername(config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
    if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    const id = newId();
    const at = now();
    let u: UserRow;
    try {
      // One transaction: a refused name or a lost race rolls the token claim back, so the person can retry without signing again.
      u = await db.transaction(async (raw) => {
        const tx = raw as unknown as Db;
        const data = await claimSignupToken(tx, body.signupToken, at);
        if (!data) throw new AppError(400, 'SIGNUP_EXPIRED', 'That wallet sign-in expired. Sign with your wallet again.');
        const [held] = await tx.select().from(userWallets).where(eq(userWallets.address, data.address));
        if (held?.verifiedAt) throw errors.conflict('WALLET_IN_USE', WALLET_IN_USE);
        if (held) await tx.delete(userWallets).where(eq(userWallets.address, data.address)); // a signature beats a typed address
        const [row] = await tx.insert(users).values({ id, username: body.username, displayName: body.displayName ?? body.username, passwordHash: null, createdAt: at }).returning();
        await tx.insert(userWallets).values({ address: data.address, userId: id, walletName: data.walletName, verifiedAt: at, createdAt: at, lastLoginAt: at });
        return row!;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
      throw errors.conflict('WALLET_IN_USE', WALLET_IN_USE);
    }
    await startSession(app, reply, u.id);
    return reply.status(201).send({ user: await meView(db, u) });
  });
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-wallet-signup.test.ts test/login-wallet.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/server/src/routes/wallet-auth.ts apps/server/test/wallet-helpers.ts apps/server/test/login-wallet-signup.test.ts
git commit -m "feat(auth): a new wallet picks a username — one-use token, a refused name doesn't burn it, typed addresses give way

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Email signup, login by username or email, dummy hash

**Files:**
- Create: `apps/server/src/services/passwords.ts`
- Modify: `apps/server/src/routes/auth.ts`
- Test: `apps/server/test/login-email.test.ts`

**Interfaces:**
- Consumes: `Email`, `emailTaken`, `emailOwner` (Task 3).
- Produces:
  - `dummyVerify(password): Promise<void>`, `passwordMatches(u: { passwordHash: string | null }, password): Promise<boolean>`
  - `POST /api/auth/signup` accepts an optional `email` (`409 EMAIL_TAKEN`).
  - `POST /api/auth/login {username, password}`: `username` may be an email (it contains `@`). Every failure is `401 INVALID_CREDENTIALS` "Wrong username, email or password".

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/login-email.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { testWallet, walletAccount } from './wallet-helpers.ts';
import { users } from '../src/db/schema.ts';
import { passwordMatches } from '../src/services/passwords.ts';

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());
const signup = (b: object) => ctx.as(null).post('/api/auth/signup', { displayName: 'Ape', password: 'long-enough-1', ...b });
const login = (username: string, password = 'long-enough-1') => ctx.as(null).post('/api/auth/login', { username, password });

describe('email sign-in', () => {
  it('signs up with an email, stored lowercased and never shown back', async () => {
    const r = await signup({ username: 'mail_ape', email: '  Ape@Example.COM ' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain('example.com');
    const [u] = await ctx.db.select().from(users).where(eq(users.username, 'mail_ape'));
    expect(u!.email).toBe('ape@example.com');
  });

  it('a taken email in any case is EMAIL_TAKEN; a malformed one is a validation error', async () => {
    await signup({ username: 'first_mail', email: 'same@example.com' });
    const again = await signup({ username: 'second_mail', email: 'SAME@example.com' });
    expect([again.status, again.body.code]).toEqual([409, 'EMAIL_TAKEN']);
    expect((await signup({ username: 'bad_mail', email: 'not-an-email' })).body.code).toBe('VALIDATION');
  });

  it('logs in by email in any case, and still by username (Review Focus 4)', async () => {
    await signup({ username: 'case_ape', email: 'Case@Example.com' });
    expect((await login('case@example.com')).status).toBe(200);
    expect((await login('CASE@EXAMPLE.COM')).body.user.username).toBe('case_ape');
    expect((await login('Case_Ape')).status).toBe(200);
  });

  it('gives the same 401 for a wrong password, no account, a wallet-only account and an agent (Review Focus 5)', async () => {
    await signup({ username: 'pw_ape', email: 'pw@example.com' });
    await walletAccount(ctx, testWallet(), 'wallet_only');
    await ctx.db.insert(users).values({ id: 'agent_x', username: 'agent_x', displayName: 'x', createdAt: ctx.clock.now(), kind: 'agent', passwordHash: await hash('long-enough-1') });
    for (const r of [await login('pw@example.com', 'wrong-password'), await login('nobody@example.com'), await login('nobody_here'), await login('wallet_only'), await login('agent_x')]) {
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Wrong username, email or password' });
    }
  });

  it('passwordMatches never matches a missing hash', async () => {
    expect(await passwordMatches({ passwordHash: null }, 'anything')).toBe(false);
    expect(await passwordMatches({ passwordHash: await hash('right-one') }, 'right-one')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-email.test.ts`
Expected: FAIL. The `services/passwords.ts` import is missing; once it exists, the email assertions fail because `email` is stripped and the old message is returned.

- [ ] **Step 3: Write the password helpers**

Create `apps/server/src/services/passwords.ts`:

```ts
import { hash, verify } from '@node-rs/argon2';

let dummy: Promise<string> | null = null;
/** One full argon2 verify against a fixed hash, so a login for no account (or one with no password) costs as long as a real one. */
export async function dummyVerify(password: string): Promise<void> {
  dummy ??= hash('shillex-no-such-account');
  await verify(await dummy, password).catch(() => false);
}

/** The password check every login path uses: a missing hash still pays for one verify, then fails. */
export async function passwordMatches(u: { passwordHash: string | null }, password: string): Promise<boolean> {
  if (!u.passwordHash) { await dummyVerify(password); return false; }
  return verify(u.passwordHash, password);
}
```

- [ ] **Step 4: Change signup and login**

In `apps/server/src/routes/auth.ts`:
- Change the imports: drop `verify` from the argon2 import (keep `hash`); add `import { AUTH_LIMITS } from '@shillex/shared';`.
- Extend the accounts import to `import { Email, Username, emailOwner, emailTaken, meView, startSession, usernameTaken } from '../services/accounts.ts';`.
- Add `import { dummyVerify, passwordMatches } from '../services/passwords.ts';`.

Replace the two schemas:

```ts
const Signup = z.object({ username: Username, displayName: z.string().trim().min(1).max(40), password: z.string().min(8).max(128), email: Email.optional() });
/** `username` is a username or, when it contains @, an email. */
const Login = z.object({ username: z.string().trim().min(1).max(AUTH_LIMITS.emailMax), password: z.string().min(1).max(128) });
const wrong = () => new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username, email or password');
```

Replace the signup handler body:

```ts
    const body = parse(Signup, req.body);
    if (isReservedUsername(config, body.username)) throw errors.conflict('USERNAME_RESERVED', 'That username is reserved');
    if (await usernameTaken(db, body.username)) throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    // Unverified by the owner's choice: without a check, saying the address is taken can't be avoided (rate-limited above).
    if (body.email && (await emailOwner(db, body.email))) throw emailTaken();
    const id = newId();
    const passwordHash = await hash(body.password);
    let u: UserRow | undefined;
    try {
      [u] = await db.insert(users).values({ id, username: body.username, displayName: body.displayName, passwordHash, email: body.email ?? null, createdAt: now() }).returning();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (body.email && (await emailOwner(db, body.email))) throw emailTaken();
      throw errors.conflict('USERNAME_TAKEN', 'That username is taken');
    }
    await startSession(app, reply, id);
    return reply.status(201).send({ user: await meView(db, u!) });
```

Replace the login handler body:

```ts
    const body = parse(Login, req.body);
    const id = body.username.toLowerCase();
    const [u] = await db.select().from(users)
      .where(id.includes('@') ? sql`lower(${users.email}) = ${id}` : sql`lower(${users.username}) = ${id}`).limit(1);
    if (!u) { await dummyVerify(body.password); throw wrong(); }
    // Check the password first, so an agent or a wallet-only account takes as long as any other miss.
    if (!(await passwordMatches(u, body.password)) || u.kind !== 'human') throw wrong();
    await startSession(app, reply, u.id);
    return { user: await meView(db, u) };
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-email.test.ts test/auth.test.ts test/admin-reserved.test.ts`
Expected: PASS. `auth.test.ts` checks only the `INVALID_CREDENTIALS` code, which is unchanged.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/server/src/services/passwords.ts apps/server/src/routes/auth.ts apps/server/test/login-email.test.ts
git commit -m "feat(auth): sign up and log in with an email (unverified), one error and one argon2 cost for every miss

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Settings carry sign-in methods; the typed-wallet endpoint goes

**Files:**
- Modify: `packages/shared/src/types.ts` (`SettingsView`)
- Modify: `apps/server/src/services/wallets.ts` (add `walletViews`)
- Create: `apps/server/src/services/settings.ts`
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/test/users.test.ts` (drop the old wallet test)
- Modify: `apps/web/src/features/profile/SettingsPage.tsx` (drop `WalletSection`; the new section comes in Task 14)
- Modify: `apps/web/test/SettingsPage.test.tsx`
- Test: `apps/server/test/login-settings.test.ts`

**Interfaces:**
- Consumes: `SignInView`, `WalletView` (Task 1); `payoutEnabled` (Task 3).
- Produces:
  - `SettingsView = { profile; signIn: SignInView; notificationPrefs; mutedWords }` (the `wallet` field is gone).
  - `walletViews(db, userId): Promise<WalletView[]>`, `settingsView(deps: Pick<AppDeps, 'db' | 'config'>, u: UserRow): Promise<SettingsView>`.
  - `PUT` and `DELETE /api/me/wallet` are removed (404).

- [ ] **Step 1: Write the failing server test**

Create `apps/server/test/login-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { users, userWallets } from '../src/db/schema.ts';

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

describe('settings: sign-in methods', () => {
  it('lists password, email and wallets for their owner only', async () => {
    const a = await ctx.createUser('settings_ape');
    await ctx.db.update(users).set({ email: 'ape@example.com' }).where(eq(users.id, a.id));
    const at = ctx.clock.now();
    await ctx.db.insert(userWallets).values([
      { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', userId: a.id, walletName: 'Phantom', verifiedAt: at, createdAt: at },
      { address: 'So11111111111111111111111111111111111111112', userId: a.id, verifiedAt: null, showOnProfile: true, createdAt: new Date(at.getTime() + 1) },
    ]);
    const s = (await ctx.as(a).get('/api/me/settings')).body;
    expect(s).not.toHaveProperty('wallet');
    expect(s.signIn).toEqual({
      hasPassword: false, email: 'ape@example.com', payoutEnabled: false,
      wallets: [
        { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', walletName: 'Phantom', verified: true, verifiedAt: at.toISOString(), showOnProfile: false, isPayout: false, lastLoginAt: null },
        { address: 'So11111111111111111111111111111111111111112', walletName: null, verified: false, verifiedAt: null, showOnProfile: true, isPayout: false, lastLoginAt: null },
      ],
    });
  });

  it('the typed-address endpoint is gone', async () => {
    const a = await ctx.createUser('old_client');
    expect((await ctx.as(a).put('/api/me/wallet', { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', displayWallet: true, displayHoldings: false })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd apps/server && npx vitest run test/login-settings.test.ts`
Expected: FAIL. `signIn` is undefined, and `PUT /me/wallet` answers 200.

- [ ] **Step 3: Rename the shared type**

In `packages/shared/src/types.ts`, add at the top with the other imports (or as the first line):

```ts
import type { SignInView } from './auth.ts';
```

and change `SettingsView`:

```ts
export interface SettingsView {
  profile: { displayName: string; bio: string; links: { label: string; url: string }[]; avatarUrl: string; bannerUrl: string | null };
  /** LOGIN: how this account signs in. Only its owner ever sees it (the email included). */
  signIn: SignInView;
  notificationPrefs: NotificationPref[];
  mutedWords: string[];
}
```

- [ ] **Step 4: Build the view on the server**

Append to `apps/server/src/services/wallets.ts` (add `asc` to the drizzle import and `type WalletView` from `@shillex/shared`):

```ts
const iso = (d: Date | null) => d?.toISOString() ?? null;
/** The owner's wallets in the order they were added: verified ones and typed (unverified) ones. */
export async function walletViews(db: Db, userId: string): Promise<WalletView[]> {
  const rows = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).orderBy(asc(userWallets.createdAt), asc(userWallets.address));
  return rows.map((w) => ({ address: w.address, walletName: w.walletName, verified: w.verifiedAt !== null, verifiedAt: iso(w.verifiedAt), showOnProfile: w.showOnProfile, isPayout: w.isPayout, lastLoginAt: iso(w.lastLoginAt) }));
}
```

Create `apps/server/src/services/settings.ts`:

```ts
import { eq } from 'drizzle-orm';
import { NOTIFICATION_TYPES, type SettingsView } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import { notificationPrefs, type UserRow } from '../db/schema.ts';
import { avatarFor } from './users.ts';
import { payoutEnabled, walletViews } from './wallets.ts';

/** Everything the settings page shows its owner. Pass a freshly loaded user after any change to it. */
export async function settingsView(deps: Pick<AppDeps, 'db' | 'config'>, u: UserRow): Promise<SettingsView> {
  const prefs = await deps.db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, u.id));
  const byType = new Map(prefs.map((p) => [p.type, p.enabled]));
  return {
    profile: { displayName: u.displayName, bio: u.bio, links: u.links, avatarUrl: avatarFor(u), bannerUrl: u.bannerUrl },
    signIn: { hasPassword: Boolean(u.passwordHash), email: u.email, wallets: await walletViews(deps.db, u.id), payoutEnabled: payoutEnabled(deps.config) },
    notificationPrefs: NOTIFICATION_TYPES.map((type) => ({ type, enabled: byType.get(type) ?? true })),
    mutedWords: u.mutedWords,
  };
}
```

In `apps/server/src/routes/me.ts`:
- Remove the `Wallet` zod schema, the `PUT /me/wallet` and `DELETE /me/wallet` routes, and the local `settings` function.
- Drop `isValidSolanaAddress`, `walletLinks` and `notificationPrefs`, `SettingsView` and `avatarFor` from the imports if they become unused. Keep `notificationPrefs`, because `PUT /me/notification-prefs` writes it.
- Add `import { settingsView } from '../services/settings.ts';` and inside the plugin `const settings = (u: UserRow) => settingsView(app.deps, u);` so every existing `return settings(…)` keeps working.

- [ ] **Step 5: Drop the old wallet tests and the old web section**

In `apps/server/test/users.test.ts`, delete the whole `it('wallet is hidden unless explicitly displayed', …)` block. Task 9 replaces it with `test/login-profile.test.ts`. If `ADDR` is now unused, delete its declaration as well.

In `apps/web/src/features/profile/SettingsPage.tsx`:
- delete the `<WalletSection data={q.data} save={save} />` line and the whole `WalletSection` function;
- remove `useEffect` from the React import and `isValidSolanaAddress` from the `@shillex/shared` import (both are now unused).

In `apps/web/test/SettingsPage.test.tsx`, replace the `settings` fixture and delete the wallet test:

```tsx
const settings = { profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, signIn: { hasPassword: true, email: null, wallets: [], payoutEnabled: false }, notificationPrefs: [{ type: 'follow', enabled: true }, { type: 'reaction', enabled: true }], mutedWords: [] };
```

Keep the `lists notification preferences as toggles` test unchanged.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-settings.test.ts test/users.test.ts`
Run: `cd apps/web && npx vitest run test/SettingsPage.test.tsx`
Expected: PASS, all three files.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add packages/shared/src/types.ts apps/server/src/services/wallets.ts apps/server/src/services/settings.ts apps/server/src/routes/me.ts apps/server/test/users.test.ts apps/server/test/login-settings.test.ts apps/web/src/features/profile/SettingsPage.tsx apps/web/test/SettingsPage.test.tsx
git commit -m "feat(auth): settings carry sign-in methods (password, email, wallets); the typed-address endpoint goes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Link, edit and unlink wallets

**Files:**
- Modify: `apps/server/src/services/wallets.ts`
- Modify: `apps/server/src/routes/wallet-auth.ts` (verify purpose `link`)
- Modify: `apps/server/src/routes/me.ts` (`PATCH` and `DELETE /me/wallets/:address`)
- Test: `apps/server/test/login-wallet-accounts.test.ts`

**Interfaces:**
- Consumes: `verifyProof` (Task 3), `settingsView` (Task 6), `walletAccount` (Task 4).
- Produces:
  - `linkWallet(db, userId, address, walletName, now): Promise<void>`. It throws `409 WALLET_IN_USE` and `409 WALLET_LIMIT`.
  - `setWalletPrefs(db, config, userId, address, { showOnProfile?, isPayout? }): Promise<void>`. It throws `404` and `400 PAYOUT_OFF`; `isPayout` needs a verified wallet (`400 NOT_VERIFIED`).
  - `unlinkWallet(db, user: UserRow, address): Promise<void>`. It throws `404`, `409 PAYOUT_LOCKED` and `409 LAST_SIGN_IN_METHOD`.
  - `POST /api/auth/wallet/verify` with `purpose: 'link'` (session) returns `{status: 'linked', settings}`.
  - `PATCH /api/me/wallets/:address` and `DELETE /api/me/wallets/:address` return `SettingsView`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/login-wallet-accounts.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { makeTestApp, type TestCtx } from './helpers.ts';
import { messageProof, signInProof, testWallet, walletAccount, walletPost } from './wallet-helpers.ts';
import { users, userWallets } from '../src/db/schema.ts';
import { payoutWallet } from '../src/services/wallets.ts';
import type { TestUser } from './helpers.ts';
import type { TestWallet } from './wallet-helpers.ts';

const VERIFY = '/api/auth/wallet/verify';
let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());
const link = async (user: TestUser, w: TestWallet) => walletPost(ctx, VERIFY, { ...(await messageProof(ctx, w, 'link', user)), purpose: 'link' }, user);

describe('linking wallets', () => {
  it('links a second wallet, verified, and answers with the settings', async () => {
    const me = await walletAccount(ctx, testWallet(), 'two_wallets');
    const w2 = testWallet();
    const r = await link(me, w2);
    expect(r.body.status).toBe('linked');
    expect(r.body.settings.signIn.wallets.map((w: { address: string; verified: boolean }) => [w.address, w.verified])).toContainEqual([w2.address, true]);
  });

  it('a link nonce belongs to the user who asked for it', async () => {
    const a = await walletAccount(ctx, testWallet(), 'asker');
    const b = await walletAccount(ctx, testWallet(), 'thief');
    const p = await signInProof(ctx, testWallet(), 'link', a);
    expect((await walletPost(ctx, VERIFY, { ...p, purpose: 'link' }, b)).body.code).toBe('CHALLENGE_EXPIRED');
  });

  it('a wallet verified elsewhere is WALLET_IN_USE; a typed one elsewhere gives way; my own typed one becomes verified', async () => {
    const shared = testWallet();
    await walletAccount(ctx, shared, 'first_owner');
    const me = await walletAccount(ctx, testWallet(), 'second_owner');
    expect((await link(me, shared)).body.code).toBe('WALLET_IN_USE');

    const typedElsewhere = testWallet();
    const other = await ctx.createUser('typist');
    await ctx.db.insert(userWallets).values({ address: typedElsewhere.address, userId: other.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await link(me, typedElsewhere)).body.status).toBe('linked');

    const mine = testWallet();
    await ctx.db.insert(userWallets).values({ address: mine.address, userId: me.id, verifiedAt: null, showOnProfile: true, createdAt: ctx.clock.now() });
    await link(me, mine);
    const [row] = await ctx.db.select().from(userWallets).where(eq(userWallets.address, mine.address));
    expect(row!.verifiedAt).not.toBeNull();
    expect(row!.showOnProfile).toBe(true);
  });

  it('stops at 5 wallets', async () => {
    const me = await walletAccount(ctx, testWallet(), 'collector');
    for (let i = 0; i < 4; i++) expect((await link(me, testWallet())).body.status).toBe('linked');
    expect((await link(me, testWallet())).body.code).toBe('WALLET_LIMIT');
  });
});

describe('editing and unlinking', () => {
  it('shows a wallet on the profile; payout is off until mainnet; someone else’s wallet is 404', async () => {
    const w = testWallet();
    const me = await walletAccount(ctx, w, 'editor');
    const r = await ctx.as(me).patch(`/api/me/wallets/${w.address}`, { showOnProfile: true });
    expect(r.body.signIn.wallets[0].showOnProfile).toBe(true);
    expect((await ctx.as(me).patch(`/api/me/wallets/${w.address}`, { isPayout: true })).body.code).toBe('PAYOUT_OFF');
    const stranger = await ctx.createUser('stranger');
    expect((await ctx.as(stranger).patch(`/api/me/wallets/${w.address}`, { showOnProfile: false })).status).toBe(404);
    expect((await ctx.as(stranger).del(`/api/me/wallets/${w.address}`)).status).toBe(404);
  });

  it('the last-method guard: a wallet-only account keeps one verified wallet; a typed row doesn’t count (Review Focus 5)', async () => {
    const w1 = testWallet(), w2 = testWallet(), typed = testWallet();
    const me = await walletAccount(ctx, w1, 'careful');
    await ctx.db.insert(userWallets).values({ address: typed.address, userId: me.id, verifiedAt: null, createdAt: ctx.clock.now() });
    expect((await ctx.as(me).del(`/api/me/wallets/${w1.address}`)).body.code).toBe('LAST_SIGN_IN_METHOD');
    await link(me, w2);
    expect((await ctx.as(me).del(`/api/me/wallets/${w1.address}`)).status).toBe(200);
    expect((await ctx.as(me).del(`/api/me/wallets/${w2.address}`)).body.code).toBe('LAST_SIGN_IN_METHOD');
    expect((await ctx.as(me).del(`/api/me/wallets/${typed.address}`)).status).toBe(200);
    await ctx.db.update(users).set({ passwordHash: await hash('long-enough-1') }).where(eq(users.id, me.id));
    expect((await ctx.as(me).del(`/api/me/wallets/${w2.address}`)).status).toBe(200);
  });

  it('payoutWallet reads the verified payout wallet (MAINNET contract)', async () => {
    const w = testWallet();
    const me = await walletAccount(ctx, w, 'payee');
    expect(await payoutWallet(ctx.db, me.id)).toBeNull();
    await ctx.db.update(userWallets).set({ isPayout: true }).where(eq(userWallets.address, w.address));
    expect(await payoutWallet(ctx.db, me.id)).toBe(w.address);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-wallet-accounts.test.ts`
Expected: FAIL. The verify route rejects `purpose: 'link'` (`VALIDATION`), and the `/me/wallets/*` routes answer 404.

- [ ] **Step 3: Write the wallet operations**

Append to `apps/server/src/services/wallets.ts`:
- Add `ne, sql` to the drizzle import.
- Add imports: `import { AUTH_LIMITS } from '@shillex/shared';` (merge it with the existing `@shillex/shared` import), `import { errors } from '../lib/errors.ts';` and `import { isUniqueViolation } from '../lib/pg-errors.ts';`.

```ts
const inUse = () => errors.conflict('WALLET_IN_USE', WALLET_IN_USE);

/** Spec §3.5: link a freshly signed wallet. A typed address (on any account) gives way; one verified elsewhere refuses. */
export async function linkWallet(db: Db, userId: string, address: string, walletName: string | null, now: Date): Promise<void> {
  try {
    await db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const [existing] = await tx.select().from(userWallets).where(eq(userWallets.address, address));
      if (existing && existing.userId === userId) {
        await tx.update(userWallets).set({ verifiedAt: existing.verifiedAt ?? now, walletName: walletName ?? existing.walletName }).where(eq(userWallets.address, address));
        return;
      }
      if (existing?.verifiedAt) throw inUse();
      if (existing) await tx.delete(userWallets).where(eq(userWallets.address, address)); // a signature beats a typed address
      const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(userWallets).where(eq(userWallets.userId, userId));
      if (n >= AUTH_LIMITS.walletsPerAccount) throw errors.conflict('WALLET_LIMIT', `An account can link up to ${AUTH_LIMITS.walletsPerAccount} wallets`);
      await tx.insert(userWallets).values({ address, userId, walletName, verifiedAt: now, createdAt: now });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw inUse(); // another account verified it in the same instant
    throw e;
  }
}

export async function setWalletPrefs(db: Db, config: Config, userId: string, address: string, p: { showOnProfile?: boolean; isPayout?: true }): Promise<void> {
  const [w] = await db.select().from(userWallets).where(and(eq(userWallets.address, address), eq(userWallets.userId, userId)));
  if (!w) throw errors.notFound('Wallet');
  if (p.isPayout) {
    if (!payoutEnabled(config)) throw errors.badRequest('PAYOUT_OFF', 'Payout wallets come with mainnet funding');
    if (!w.verifiedAt) throw errors.badRequest('NOT_VERIFIED', 'Sign with this wallet first');
  }
  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    if (p.isPayout) await tx.update(userWallets).set({ isPayout: false }).where(and(eq(userWallets.userId, userId), ne(userWallets.address, address)));
    await tx.update(userWallets).set({ ...(p.showOnProfile !== undefined ? { showOnProfile: p.showOnProfile } : {}), ...(p.isPayout ? { isPayout: true } : {}) })
      .where(eq(userWallets.address, address));
  });
}

/** Spec §3.5: never leave an account with no password and no other verified wallet; never drop a locked payout wallet. */
export async function unlinkWallet(db: Db, user: UserRow, address: string): Promise<void> {
  const [w] = await db.select().from(userWallets).where(and(eq(userWallets.address, address), eq(userWallets.userId, user.id)));
  if (!w) throw errors.notFound('Wallet');
  if (w.isPayout && (await payoutHeld(db, user.id))) throw errors.conflict('PAYOUT_LOCKED', 'This is your payout wallet while your agent holds funds. Withdraw first.');
  if (!user.passwordHash && w.verifiedAt) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(userWallets)
      .where(and(eq(userWallets.userId, user.id), ne(userWallets.address, address), isNotNull(userWallets.verifiedAt)));
    if (n === 0) throw errors.conflict('LAST_SIGN_IN_METHOD', 'You can’t remove your last way to sign in. Set a password or link another wallet first.');
  }
  await db.delete(userWallets).where(eq(userWallets.address, address));
}
```

- [ ] **Step 4: Accept `link` on the verify route**

In `apps/server/src/routes/wallet-auth.ts`:
- Import `linkWallet` from `../services/wallets.ts` and `settingsView` from `../services/settings.ts`.
- Add `import { users } from '../db/schema.ts';` if it isn't imported yet.
- Replace the verify handler:

```ts
  app.post('/auth/wallet/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply): Promise<WalletVerifyResult> => {
    const body = parse(WalletProofBody.extend({ purpose: z.enum(['login', 'link']) }), req.body);
    if (body.purpose === 'link') {
      const me = requireUser(req);
      const w = await verifyProof(deps, body, 'link', me.id);
      await linkWallet(db, me.id, w.address, w.walletName, now());
      return { status: 'linked', settings: await settingsView(deps, me) };
    }
    const w = await verifyProof(deps, body, 'login', null);
    const owner = await verifiedWalletOwner(db, w.address);
    if (owner) {
      await touchLogin(db, w.address, now());
      await startSession(app, reply, owner.id);
      return { status: 'signedIn', user: await meView(db, owner) };
    }
    return { status: 'new', signupToken: await issueSignupToken(deps, w), address: w.address, walletName: w.walletName };
  });
```

- [ ] **Step 5: Add the settings routes**

In `apps/server/src/routes/me.ts`, import `setWalletPrefs, unlinkWallet` from `../services/wallets.ts`, take `config` from `app.deps` (`const { db, config } = app.deps;`), and add:

```ts
const WalletPrefs = z.object({ showOnProfile: z.boolean().optional(), isPayout: z.literal(true).optional() })
  .refine((b) => b.showOnProfile !== undefined || b.isPayout !== undefined, 'Nothing to change');
```

```ts
  app.patch<{ Params: { address: string } }>('/me/wallets/:address', async (req) => {
    const me = requireUser(req);
    await setWalletPrefs(db, config, me.id, req.params.address, parse(WalletPrefs, req.body));
    return settings(me);
  });
  app.delete<{ Params: { address: string } }>('/me/wallets/:address', async (req) => {
    const me = requireUser(req);
    await unlinkWallet(db, me, req.params.address);
    return settings(me);
  });
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-wallet-accounts.test.ts test/login-wallet.test.ts test/login-settings.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/server/src/services/wallets.ts apps/server/src/routes/wallet-auth.ts apps/server/src/routes/me.ts apps/server/test/login-wallet-accounts.test.ts
git commit -m "feat(auth): link up to five wallets, show them on the profile, unlink without losing the last way in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Account proofs, password and email in settings, reset with a wallet

**Files:**
- Create: `apps/server/src/services/account-proof.ts`
- Modify: `apps/server/src/routes/me.ts` (`PUT /me/password`, `PUT /me/email`)
- Modify: `apps/server/src/routes/wallet-auth.ts` (`POST /auth/password/reset-with-wallet`)
- Test: `apps/server/test/login-account-proof.test.ts`

**Interfaces:**
- Consumes: `verifyProof`, `WalletProofBody`, `endOtherSessions`, `Email`, `emailOwner`, `emailTaken`, `verifiedWalletOwner`, `settingsView`.
- Produces:
  - `requireProof(deps, user, proof: AccountProof): Promise<void>`. It throws `403 PROOF_FAILED`, or Task 3's verification errors.
  - `PUT /api/me/password {password, proof}` returns `SettingsView` and ends the user's other sessions (10 an hour per user).
  - `PUT /api/me/email {email: string | null, proof}` returns `SettingsView`; a taken address is `409 EMAIL_TAKEN` (5 an hour per user).
  - `POST /api/auth/password/reset-with-wallet {proof, password}` returns `{user: MeView}`. It ends every session, then signs this one in. A wallet linked to nobody is `400 NO_WALLET_ACCOUNT`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/login-account-proof.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, type TestCtx, type TestUser } from './helpers.ts';
import { messageProof, signInProof, testWallet, walletAccount, walletPost } from './wallet-helpers.ts';

let ctx: TestCtx;
beforeEach(async () => { ctx = await makeTestApp(); });
afterEach(() => ctx.close());

async function passwordAccount(username: string, email?: string): Promise<TestUser> {
  const r = await walletPost(ctx, '/api/auth/signup', { username, displayName: username, password: 'old-password-1', ...(email ? { email } : {}) });
  return { id: r.body.user.id, username, cookie: r.cookie! };
}
const me = (u: TestUser) => ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: u.cookie } }).then((r) => r.json().user);

describe('password changes', () => {
  it('a password account gives the current password; other sessions end, this one stays', async () => {
    const a = await passwordAccount('pw_changer');
    const other = { ...a, cookie: (await walletPost(ctx, '/api/auth/login', { username: 'pw_changer', password: 'old-password-1' })).cookie! };
    expect((await ctx.as(a).put('/api/me/password', { password: 'new-password-1', proof: { password: 'wrong-one' } })).body.code).toBe('PROOF_FAILED');
    const ok = await ctx.as(a).put('/api/me/password', { password: 'new-password-1', proof: { password: 'old-password-1' } });
    expect(ok.status).toBe(200);
    expect(await me(other)).toBeNull();
    expect((await me(a)).username).toBe('pw_changer');
    expect(ctx.bus.disconnectedSessions).toHaveLength(1);
    expect((await walletPost(ctx, '/api/auth/login', { username: 'pw_changer', password: 'new-password-1' })).status).toBe(200);
  });

  it('a wallet-only account sets a password with a confirm signature, never a password proof (Review Focus 5)', async () => {
    const w = testWallet();
    const a = await walletAccount(ctx, w, 'wallet_setter');
    expect((await ctx.as(a).put('/api/me/password', { password: 'first-password', proof: { password: 'anything' } })).body.code).toBe('PROOF_FAILED');
    const notMine = await signInProof(ctx, testWallet(), 'confirm', a);
    expect((await ctx.as(a).put('/api/me/password', { password: 'first-password', proof: { wallet: notMine } })).body.code).toBe('PROOF_FAILED');
    const proof = await messageProof(ctx, w, 'confirm', a);
    const r = await ctx.as(a).put('/api/me/password', { password: 'first-password', proof: { wallet: proof } });
    expect(r.body.signIn.hasPassword).toBe(true);
    expect((await walletPost(ctx, '/api/auth/login', { username: 'wallet_setter', password: 'first-password' })).status).toBe(200);
  });
});

describe('email changes', () => {
  it('sets, refuses a taken one, and removes, each with proof', async () => {
    await passwordAccount('mail_owner', 'taken@example.com');
    const a = await passwordAccount('mail_changer');
    const proof = { password: 'old-password-1' };
    expect((await ctx.as(a).put('/api/me/email', { email: 'New@Example.com', proof })).body.signIn.email).toBe('new@example.com');
    expect((await ctx.as(a).put('/api/me/email', { email: 'TAKEN@example.com', proof })).body.code).toBe('EMAIL_TAKEN');
    expect((await ctx.as(a).put('/api/me/email', { email: 'x@example.com', proof: { password: 'nope-nope' } })).body.code).toBe('PROOF_FAILED');
    expect((await ctx.as(a).put('/api/me/email', { email: null, proof })).body.signIn.email).toBeNull();
    // 5 an hour per user: that was 4; the 5th is allowed, the 6th is not.
    expect((await ctx.as(a).put('/api/me/email', { email: 'five@example.com', proof })).status).toBe(200);
    expect((await ctx.as(a).put('/api/me/email', { email: 'six@example.com', proof })).status).toBe(429);
  });
});

describe('reset with a wallet', () => {
  it('a linked wallet sets a new password, ends every session and signs in', async () => {
    const w = testWallet();
    const a = await walletAccount(ctx, w, 'forgetful');
    const proof = await signInProof(ctx, w, 'reset');
    const r = await walletPost(ctx, '/api/auth/password/reset-with-wallet', { proof, password: 'brand-new-pass' });
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('forgetful');
    expect(await me(a)).toBeNull();
    expect((await walletPost(ctx, '/api/auth/login', { username: 'forgetful', password: 'brand-new-pass' })).status).toBe(200);
  });

  it('a wallet linked to nobody, or a login nonce, can’t reset', async () => {
    expect((await walletPost(ctx, '/api/auth/password/reset-with-wallet', { proof: await signInProof(ctx, testWallet(), 'reset'), password: 'brand-new-pass' })).body.code).toBe('NO_WALLET_ACCOUNT');
    const w = testWallet();
    await walletAccount(ctx, w, 'nonce_mixer');
    expect((await walletPost(ctx, '/api/auth/password/reset-with-wallet', { proof: await signInProof(ctx, w, 'login'), password: 'brand-new-pass' })).body.code).toBe('CHALLENGE_EXPIRED');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-account-proof.test.ts`
Expected: FAIL, with 404s from the three new routes.

- [ ] **Step 3: Write `requireProof`**

Create `apps/server/src/services/account-proof.ts`:

```ts
import { and, eq, isNotNull } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { z } from 'zod';
import type { AccountProof } from '@shillex/shared';
import type { AppDeps } from '../deps.ts';
import { userWallets, type UserRow } from '../db/schema.ts';
import { errors } from '../lib/errors.ts';
import { WalletProofBody, verifyProof } from './wallet-auth.ts';

export const AccountProofBody = z.union([z.object({ password: z.string().min(1).max(128) }), z.object({ wallet: WalletProofBody })]);

/**
 * Proof the account holder is here (spec §5 Settings): the current password when the account has one; otherwise a fresh
 * `confirm` signature, bound to this user, by one of the account's verified wallets.
 */
export async function requireProof(deps: Pick<AppDeps, 'db' | 'config' | 'now'>, user: UserRow, proof: AccountProof): Promise<void> {
  if (user.passwordHash) {
    if (!('password' in proof) || !(await verify(user.passwordHash, proof.password))) throw errors.forbidden('PROOF_FAILED', 'That password is wrong');
    return;
  }
  if (!('wallet' in proof)) throw errors.forbidden('PROOF_FAILED', 'Confirm with one of your wallets');
  const { address } = await verifyProof(deps, proof.wallet, 'confirm', user.id);
  const [w] = await deps.db.select({ a: userWallets.address }).from(userWallets)
    .where(and(eq(userWallets.address, address), eq(userWallets.userId, user.id), isNotNull(userWallets.verifiedAt))).limit(1);
  if (!w) throw errors.forbidden('PROOF_FAILED', 'Sign with a wallet linked to this account');
}
```

- [ ] **Step 4: Add the password and email routes**

In `apps/server/src/routes/me.ts`:
- add `import { hash } from '@node-rs/argon2';`;
- add `import { AccountProofBody, requireProof } from '../services/account-proof.ts';`;
- add `import { Email, emailOwner, emailTaken, endOtherSessions } from '../services/accounts.ts';`;
- add `import { isUniqueViolation } from '../lib/pg-errors.ts';`.

Then add:

```ts
  const perUser = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 hour', keyGenerator: (r: FastifyRequest) => r.user?.id ?? r.ip } } });

  app.put('/me/password', perUser(10), async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ password: z.string().min(8).max(128), proof: AccountProofBody }), req.body);
    await requireProof(app.deps, me, body.proof);
    await db.update(users).set({ passwordHash: await hash(body.password) }).where(eq(users.id, me.id));
    await endOtherSessions(app, req, me.id);
    return settings(await fresh(me.id));
  });

  app.put('/me/email', perUser(5), async (req) => {
    const me = requireUser(req);
    const body = parse(z.object({ email: Email.nullable(), proof: AccountProofBody }), req.body);
    await requireProof(app.deps, me, body.proof);
    if (body.email) {
      const owner = await emailOwner(db, body.email);
      if (owner && owner !== me.id) throw emailTaken();
    }
    try { await db.update(users).set({ email: body.email }).where(eq(users.id, me.id)); }
    catch (e) { if (isUniqueViolation(e)) throw emailTaken(); throw e; }
    return settings(await fresh(me.id));
  });
```

(`FastifyRequest` comes from `import type { FastifyInstance, FastifyRequest } from 'fastify';`. Removing the email needs no last-method guard; see Deviation 5.)

- [ ] **Step 5: Add the reset route**

In `apps/server/src/routes/wallet-auth.ts`:
- add `import { hash } from '@node-rs/argon2';`;
- extend the accounts import with `endOtherSessions`.

Inside the plugin, add:

```ts
  app.post('/auth/password/reset-with-wallet', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ proof: WalletProofBody, password: z.string().min(8).max(128) }), req.body);
    const { address } = await verifyProof(deps, body.proof, 'reset', null);
    const owner = await verifiedWalletOwner(db, address);
    if (!owner) throw errors.badRequest('NO_WALLET_ACCOUNT', 'No Shillex account has this wallet linked');
    await db.update(users).set({ passwordHash: await hash(body.password) }).where(eq(users.id, owner.id));
    await endOtherSessions(app, req, owner.id); // signed out here, so every session of the account ends
    await touchLogin(db, address, now());
    await startSession(app, reply, owner.id);
    const [fresh] = await db.select().from(users).where(eq(users.id, owner.id));
    return { user: await meView(db, fresh!) };
  });
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-account-proof.test.ts test/login-wallet-accounts.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/server/src/services/account-proof.ts apps/server/src/routes/me.ts apps/server/src/routes/wallet-auth.ts apps/server/test/login-account-proof.test.ts
git commit -m "feat(auth): change the password or email with proof (password, or a wallet signature), reset a password with a linked wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Signed wallets on profiles

**Files:**
- Modify: `packages/shared/src/types.ts` (`UserProfile`)
- Modify: `packages/shared/src/constants.ts` (drop `holdingsNote`)
- Modify: `apps/server/src/services/wallets.ts` (add `profileWallets`)
- Modify: `apps/server/src/routes/users.ts`
- Modify: `apps/web/src/features/profile/ProfilePage.tsx`, `apps/web/src/features/profile/profile.module.css`
- Modify: `apps/web/test/ProfilePage.test.tsx`
- Test: `apps/server/test/login-profile.test.ts`

**Interfaces:**
- Consumes: `ProfileWallet` (Task 1).
- Produces: `UserProfile.wallets: ProfileWallet[]` (the `wallet` field is gone); `profileWallets(db, userId): Promise<ProfileWallet[]>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/test/login-profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestApp } from './helpers.ts';
import { users, userWallets } from '../src/db/schema.ts';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';
const C = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

describe('profile wallets', () => {
  it('shows only signed wallets their owner chose to show, and never the email', async () => {
    const ctx = await makeTestApp();
    try {
      const a = await ctx.createUser('shows_wallets');
      const viewer = await ctx.createUser('viewer');
      await ctx.db.update(users).set({ email: 'secret@example.com' }).where(eq(users.id, a.id));
      const at = ctx.clock.now();
      await ctx.db.insert(userWallets).values([
        { address: A, userId: a.id, walletName: 'Phantom', verifiedAt: at, showOnProfile: true, createdAt: at },
        { address: B, userId: a.id, walletName: null, verifiedAt: at, showOnProfile: false, createdAt: at },
        { address: C, userId: a.id, walletName: null, verifiedAt: null, showOnProfile: true, createdAt: at }, // typed before sign-in existed
      ]);
      const r = await ctx.as(viewer).get('/api/users/shows_wallets');
      expect(r.body.profile.wallets).toEqual([{ address: A, walletName: 'Phantom', verifiedAt: at.toISOString() }]);
      expect(r.body.profile).not.toHaveProperty('wallet');
      expect(JSON.stringify(r.body)).not.toContain('secret@example.com');
    } finally { await ctx.close(); }
  });
});
```

In `apps/web/test/ProfilePage.test.tsx`:
- change the fixture's `wallet: null` to `wallets: []`;
- add `within` to the `@testing-library/react` import;
- replace the test `shows a shared wallet with the not-verified note` with:

```tsx
  it('shows signed wallets as chips that say when they were signed', async () => {
    route({ ...profile, wallets: [{ address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', walletName: 'Phantom', verifiedAt: '2026-10-01T00:00:00.000Z' }] });
    renderWithApp(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alpha_jane' });
    const chips = await screen.findByRole('list', { name: 'Wallets' });
    expect(within(chips).getByText('DezX…263')).toBeInTheDocument();
    expect(within(chips).getByTitle(/^Signed by this wallet on /)).toBeInTheDocument();
    expect(screen.queryByText(/not implemented/)).toBeNull();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/server && npx vitest run test/login-profile.test.ts`
Run: `cd apps/web && npx vitest run test/ProfilePage.test.tsx`
Expected: FAIL on both. The server still sends `wallet` from `wallet_links`, and the web has no `Wallets` list.

- [ ] **Step 3: Change the type, the server and the copy**

In `packages/shared/src/types.ts`, extend the auth import to `import type { ProfileWallet, SignInView } from './auth.ts';` and change the `UserProfile` field:

```ts
  /** Signed wallets the owner chose to show (LOGIN). Typed, unverified addresses never appear. */
  wallets: ProfileWallet[];
```

In `packages/shared/src/constants.ts`, delete the `holdingsNote` line from `COPY`.

Append to `apps/server/src/services/wallets.ts` (add `type ProfileWallet` to the `@shillex/shared` import):

```ts
/** A profile's public wallets: verified, and shown by their owner's choice (off by default). */
export async function profileWallets(db: Db, userId: string): Promise<ProfileWallet[]> {
  const rows = await db.select().from(userWallets)
    .where(and(eq(userWallets.userId, userId), eq(userWallets.showOnProfile, true), isNotNull(userWallets.verifiedAt)))
    .orderBy(asc(userWallets.createdAt), asc(userWallets.address));
  return rows.map((w) => ({ address: w.address, walletName: w.walletName, verifiedAt: w.verifiedAt!.toISOString() }));
}
```

In `apps/server/src/routes/users.ts`:
- remove `walletLinks` from the schema import, and add `import { profileWallets } from '../services/wallets.ts';`;
- in `GET /users/:username`, replace the `db.select().from(walletLinks)…` entry of the `Promise.all` with `profileWallets(db, u.id)`;
- rename its destructured name from `wallet` to `wallets`, delete `const w = wallet[0];`;
- set `wallets,` in the profile object in place of the old `wallet:` line.

- [ ] **Step 4: Show the chips**

In `apps/web/src/features/profile/ProfilePage.tsx`:
- change the lucide import: drop `Wallet`, add `BadgeCheck`;
- replace the `{p.wallet && (…)}` block with:

```tsx
        {p.wallets.length > 0 && (
          <ul className={s.walletChips} aria-label="Wallets">
            {p.wallets.map((w) => (
              <li key={w.address} className={s.walletChip} title={`Signed by this wallet on ${new Date(w.verifiedAt).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}`}>
                <span aria-hidden="true">◎</span>
                <span className="mono">{abbreviateMint(w.address, 4, 3)}</span>
                <BadgeCheck size={13} className={s.walletTick} aria-label="Verified" />
                <IconButton label="Copy wallet address" onClick={() => copyAddress(w.address)}><Copy size={12} /></IconButton>
              </li>
            ))}
          </ul>
        )}
```

In `apps/web/src/features/profile/profile.module.css`, replace the four `.wallet*` rules (`.wallet`, `.walletHead`, `.walletAddr`, `.walletNote`) with:

```css
.walletChips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.walletChip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px; border: 1px solid var(--token-line); border-radius: var(--radius-pill); background: var(--token-soft); font-size: var(--fs-sm); }
.walletTick { color: var(--token); }
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/server && npx vitest run test/login-profile.test.ts test/users.test.ts`
Run: `cd apps/web && npx vitest run test/ProfilePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors. A leftover `p.wallet` or `COPY.holdingsNote` anywhere fails here; fix it before committing.

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts apps/server/src/services/wallets.ts apps/server/src/routes/users.ts apps/server/test/login-profile.test.ts apps/web/src/features/profile/ProfilePage.tsx apps/web/src/features/profile/profile.module.css apps/web/test/ProfilePage.test.tsx
git commit -m "feat(auth): profiles show signed wallets their owner chose to show, never typed addresses or emails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Wallets in the browser: detection and signing

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`
- Create: `apps/web/src/features/auth/wallet/featured.ts`, `registry.ts`, `sign.ts`, `mobile.ts`
- Create: `apps/web/test/fakeWallet.ts`
- Test: `apps/web/test/walletRegistry.test.ts`, `apps/web/test/walletSign.test.ts`, `apps/web/test/walletMobile.test.ts`

**Interfaces:**
- Consumes: `POST /api/auth/wallet/challenge` (Task 3); shared `WalletChallenge`, `WalletProof`, `WalletPurpose`.
- Produces:
  - `FEATURED: readonly { name: 'Phantom' | 'Solflare' | 'Backpack'; install: string; colour: string }[]`
  - `canSignIn(w: Wallet): boolean`, `usableWallets(): Wallet[]`, `useWalletList(): Wallet[]`, `lastWallet(): string | null`, `rememberWallet(name): void`
  - `interface PickerEntry { name: string; wallet: Wallet | null; install: string | null; colour: string | null }`
  - `arrange(list, last): { recent: PickerEntry | null; featured: PickerEntry[]; others: PickerEntry[] }`
  - `walletProof(wallet: Wallet, purpose: WalletPurpose): Promise<WalletProof>`
  - `isMobile(ua?)`, `isAndroidChrome(ua?)`, `phantomBrowse(url, origin)`, `solflareBrowse(url, origin)`, `registerMobileWalletAdapter(): Promise<void> | null`
  - Test util: `fakeWallet(o)`, `FAKE_ADDRESS`, `CHALLENGE`, `CHALLENGE_WITH_MESSAGE`

- [ ] **Step 1: Install the libraries and keep them out of the eager bundle**

Run: `npm install --save-exact -w @shillex/web @wallet-standard/app@1.1.1 @wallet-standard/base@1.1.1 @wallet-standard/features@1.1.1 @solana/wallet-standard-features@1.5.0 @solana-mobile/wallet-standard-mobile@0.6.0`
Expected: the five appear in `apps/web/package.json` `dependencies` with exact versions.

In `apps/web/vite.config.ts`, add a `wallet` group **before** `vendor` in `codeSplitting.groups`:

```ts
            // Wallet sign-in code loads only when the picker opens (spec §4); never inside the eager vendor chunk.
            { name: 'wallet', test: /node_modules[\/](@wallet-standard|@solana-mobile|@solana[\/]wallet-standard-[a-z]+|qrcode)[\/]/, priority: 4 },
```

Add to the config object, next to `plugins`:

```ts
  // Pre-bundle the lazily imported wallet packages at startup, so the dev server never reloads the page mid-session (e2e).
  optimizeDeps: { include: ['@wallet-standard/app', '@wallet-standard/features', '@solana/wallet-standard-features'] },
```

- [ ] **Step 2: Write the fake wallet and the failing tests**

Create `apps/web/test/fakeWallet.ts`:

```ts
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';

export const FAKE_ADDRESS = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const ICON = 'data:image/svg+xml;base64,PHN2Zy8+' as const;
export const CHALLENGE = {
  nonce: 'nonce-1234567890',
  input: { domain: 'localhost:5173', uri: 'http://localhost:5173', statement: 'Sign in to Shillex.', version: '1', chainId: 'mainnet', nonce: 'nonce-1234567890', issuedAt: '2026-10-13T12:00:00.000Z', expirationTime: '2026-10-13T12:05:00.000Z' },
  message: null as string | null,
};
export const CHALLENGE_WITH_MESSAGE = { ...CHALLENGE, input: { ...CHALLENGE.input, address: FAKE_ADDRESS }, message: `localhost:5173 wants you to sign in with your Solana account:\n${FAKE_ADDRESS}\n\nSign in to Shillex.` };

/** Registers a Wallet Standard wallet that signs at once. Call `unregister` in afterEach. */
export function fakeWallet(o: { name?: string; signIn?: boolean; chains?: `${string}:${string}`[] } = {}) {
  const calls = { signIn: [] as unknown[], signMessage: [] as Uint8Array[], connect: 0 };
  const account: WalletAccount = { address: FAKE_ADDRESS, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [] };
  const features: Record<string, unknown> = {
    'standard:connect': { version: '1.0.0', connect: async () => { calls.connect++; return { accounts: [account] }; } },
    'standard:events': { version: '1.0.0', on: () => () => undefined },
    'solana:signMessage': { version: '1.0.0', signMessage: async (...inputs: { message: Uint8Array }[]) => inputs.map((i) => { calls.signMessage.push(i.message); return { signedMessage: i.message, signature: new Uint8Array(64).fill(7) }; }) },
  };
  if (o.signIn !== false) {
    features['solana:signIn'] = { version: '1.0.0', signIn: async (...inputs: object[]) => inputs.map((i) => { calls.signIn.push(i); return { account, signedMessage: new TextEncoder().encode('signed text'), signature: new Uint8Array(64).fill(9) }; }) };
  }
  const wallet = { version: '1.0.0', name: o.name ?? 'Phantom', icon: ICON, chains: o.chains ?? ['solana:mainnet', 'solana:devnet'], accounts: [], features } as unknown as Wallet;
  return { wallet, calls, unregister: getWallets().register(wallet) };
}
```

Create `apps/web/test/walletRegistry.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { arrange, canSignIn, lastWallet, rememberWallet, useWalletList } from '../src/features/auth/wallet/registry';
import { fakeWallet } from './fakeWallet';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });
const add = (o: Parameters<typeof fakeWallet>[0]) => { const f = fakeWallet(o); offs.push(f.unregister); return f; };

describe('wallet registry', () => {
  it('keeps mainnet wallets that can sign in, in one step or by message', () => {
    expect(canSignIn(add({ name: 'Phantom' }).wallet)).toBe(true);
    expect(canSignIn(add({ name: 'Plain', signIn: false }).wallet)).toBe(true);
    expect(canSignIn(add({ name: 'Devnet only', chains: ['solana:devnet'] }).wallet)).toBe(false);
  });

  it('lists wallets that register after the page loaded', () => {
    const { result } = renderHook(() => useWalletList());
    expect(result.current).toEqual([]);
    act(() => { add({ name: 'Late Wallet' }); });
    expect(result.current.map((w) => w.name)).toEqual(['Late Wallet']);
  });

  it('shows the three featured wallets, installed or not, then the rest; the last one used comes first', () => {
    const phantom = add({ name: 'Phantom' }).wallet, glow = add({ name: 'Glow' }).wallet;
    const a = arrange([phantom, glow], null);
    expect(a.recent).toBeNull();
    expect(a.featured.map((e) => [e.name, Boolean(e.wallet)])).toEqual([['Phantom', true], ['Solflare', false], ['Backpack', false]]);
    expect(a.others.map((e) => e.name)).toEqual(['Glow']);
    const b = arrange([phantom, glow], 'Glow');
    expect(b.recent?.name).toBe('Glow');
    expect(b.others).toEqual([]);
    expect(arrange([phantom], 'Solflare').recent).toBeNull(); // not installed: nothing to put first
  });

  it('remembers the last wallet, and storage that throws is harmless', () => {
    rememberWallet('Solflare');
    expect(lastWallet()).toBe('Solflare');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(lastWallet()).toBeNull();
    expect(() => rememberWallet('Phantom')).not.toThrow();
  });
});
```

Create `apps/web/test/walletSign.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { walletProof } from '../src/features/auth/wallet/sign';
import { mockFetch } from './utils';
import { CHALLENGE, CHALLENGE_WITH_MESSAGE, FAKE_ADDRESS, fakeWallet } from './fakeWallet';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });

describe('walletProof', () => {
  it('signIn wallets: a challenge with no address, one prompt, the wallet’s own text comes back', async () => {
    const f = fakeWallet({ name: 'Phantom' }); offs.push(f.unregister);
    const sent: unknown[] = [];
    mockFetch({ '/api/auth/wallet/challenge': (init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return CHALLENGE; } });
    const p = await walletProof(f.wallet, 'login');
    expect(sent).toEqual([{ purpose: 'login' }]);
    expect(f.calls.signIn).toEqual([CHALLENGE.input]);
    expect(f.calls.connect).toBe(0);
    expect(p).toMatchObject({ nonce: CHALLENGE.nonce, mode: 'signIn', address: FAKE_ADDRESS, walletName: 'Phantom' });
    expect(atob(p.signedMessage)).toBe('signed text');
    expect(atob(p.signature)).toHaveLength(64);
  });

  it('message-only wallets: connect, a challenge for that address, then sign exactly its text', async () => {
    const f = fakeWallet({ name: 'Plain', signIn: false }); offs.push(f.unregister);
    const sent: unknown[] = [];
    mockFetch({ '/api/auth/wallet/challenge': (init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return CHALLENGE_WITH_MESSAGE; } });
    const p = await walletProof(f.wallet, 'link');
    expect(sent).toEqual([{ purpose: 'link', address: FAKE_ADDRESS }]);
    expect(new TextDecoder().decode(f.calls.signMessage[0])).toBe(CHALLENGE_WITH_MESSAGE.message);
    expect(p).toMatchObject({ mode: 'message', address: FAKE_ADDRESS, walletName: 'Plain' });
    expect(atob(p.signedMessage)).toBe(CHALLENGE_WITH_MESSAGE.message);
  });
});
```

Create `apps/web/test/walletMobile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAndroidChrome, isMobile, phantomBrowse, solflareBrowse } from '../src/features/auth/wallet/mobile';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const WEBVIEW = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36';

describe('wallets on phones', () => {
  it('tells phones from desktops, and Android Chrome from in-app browsers', () => {
    expect(isMobile(IPHONE)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(isAndroidChrome(ANDROID)).toBe(true);
    expect(isAndroidChrome(IPHONE)).toBe(false);
    expect(isAndroidChrome(WEBVIEW)).toBe(false);
  });

  it('builds each wallet’s browse link with encoded parameters', () => {
    expect(phantomBrowse('https://shillex.app/login?next=/coins', 'https://shillex.app'))
      .toBe('https://phantom.app/ul/browse/https%3A%2F%2Fshillex.app%2Flogin%3Fnext%3D%2Fcoins?ref=https%3A%2F%2Fshillex.app');
    expect(solflareBrowse('https://shillex.app/login', 'https://shillex.app'))
      .toBe('https://solflare.com/ul/v1/browse/https%3A%2F%2Fshillex.app%2Flogin?ref=https%3A%2F%2Fshillex.app');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/walletRegistry.test.ts test/walletSign.test.ts test/walletMobile.test.ts`
Expected: FAIL, because the modules under `src/features/auth/wallet/` don't exist yet.

- [ ] **Step 4: Write the modules**

Create `apps/web/src/features/auth/wallet/featured.ts`:

```ts
/**
 * The three wallets the picker always shows, installed or not (spec §4). No wallet code here: the sign-in button
 * imports this without pulling the wallet libraries into the eager bundle.
 */
export const FEATURED = [
  { name: 'Phantom', install: 'https://phantom.com/download', colour: '#AB9FF2' },
  { name: 'Solflare', install: 'https://solflare.com/download', colour: '#FC7227' },
  { name: 'Backpack', install: 'https://backpack.app/downloads', colour: '#E33E3F' },
] as const;
```

Create `apps/web/src/features/auth/wallet/registry.ts`:

```ts
import { useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { StandardConnect } from '@wallet-standard/features';
import { SolanaSignIn, SolanaSignMessage } from '@solana/wallet-standard-features';
import { FEATURED } from './featured';

/** A wallet the picker can use: on Solana mainnet, with one-step sign-in, or with connect plus message signing. */
export function canSignIn(w: Wallet): boolean {
  if (!w.chains.includes('solana:mainnet')) return false;
  return SolanaSignIn in w.features || (SolanaSignMessage in w.features && StandardConnect in w.features);
}
export const usableWallets = (): Wallet[] => getWallets().get().filter(canSignIn);

/** Every usable wallet, updated as wallets register late (extensions often load after the page). */
export function useWalletList(): Wallet[] {
  const [list, setList] = useState<Wallet[]>(usableWallets);
  useEffect(() => {
    const api = getWallets();
    const update = () => setList(usableWallets());
    const offs = [api.on('register', update), api.on('unregister', update)];
    update();
    return () => offs.forEach((off) => off());
  }, []);
  return list;
}

const LAST = 'sx:last-wallet';
export function lastWallet(): string | null {
  try { return localStorage.getItem(LAST); } catch { return null; }
}
export function rememberWallet(name: string): void {
  try { localStorage.setItem(LAST, name); } catch { /* storage off: the order just isn't remembered */ }
}

export interface PickerEntry { name: string; wallet: Wallet | null; install: string | null; colour: string | null }
/** Featured wallets first (installed or not), then every other wallet. The last one used, when installed, goes on top on its own. */
export function arrange(list: Wallet[], last: string | null): { recent: PickerEntry | null; featured: PickerEntry[]; others: PickerEntry[] } {
  const byName = new Map(list.map((w) => [w.name, w]));
  const isFeatured = (n: string) => FEATURED.some((f) => f.name === n);
  const featured: PickerEntry[] = FEATURED.map((f) => ({ name: f.name, wallet: byName.get(f.name) ?? null, install: f.install, colour: f.colour }));
  const others: PickerEntry[] = list.filter((w) => !isFeatured(w.name)).map((w) => ({ name: w.name, wallet: w, install: null, colour: null }));
  const recent = [...featured, ...others].find((e) => e.name === last && e.wallet) ?? null;
  return { recent, featured: featured.filter((e) => e !== recent), others: others.filter((e) => e !== recent) };
}
```

Create `apps/web/src/features/auth/wallet/sign.ts`:

```ts
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import { SolanaSignIn, SolanaSignMessage, type SolanaSignInFeature, type SolanaSignMessageFeature } from '@solana/wallet-standard-features';
import type { WalletChallenge, WalletProof, WalletPurpose } from '@shillex/shared';
import { post } from '../../../lib/api';

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));

/**
 * Signs a fresh server challenge with `wallet` (spec §3.2): one `solana:signIn` prompt when the wallet has it; otherwise
 * connect, ask for a challenge naming that address, and sign its exact text with `solana:signMessage`.
 */
export async function walletProof(wallet: Wallet, purpose: WalletPurpose): Promise<WalletProof> {
  if (SolanaSignIn in wallet.features) {
    const ch = await post<WalletChallenge>('/auth/wallet/challenge', { purpose });
    const { signIn } = (wallet.features as unknown as SolanaSignInFeature)[SolanaSignIn];
    const [out] = await signIn(ch.input);
    if (!out) throw new Error('The wallet returned no signature');
    return { nonce: ch.nonce, mode: 'signIn', address: out.account.address, signedMessage: b64(out.signedMessage), signature: b64(out.signature), walletName: wallet.name };
  }
  const { connect } = (wallet.features as unknown as StandardConnectFeature)[StandardConnect];
  const { accounts } = await connect();
  const account: WalletAccount | undefined = accounts.find((a) => a.chains.includes('solana:mainnet')) ?? accounts[0];
  if (!account) throw new Error('The wallet shared no account');
  const ch = await post<WalletChallenge>('/auth/wallet/challenge', { purpose, address: account.address });
  const { signMessage } = (wallet.features as unknown as SolanaSignMessageFeature)[SolanaSignMessage];
  const [out] = await signMessage({ account, message: new TextEncoder().encode(ch.message ?? '') });
  if (!out) throw new Error('The wallet returned no signature');
  return { nonce: ch.nonce, mode: 'message', address: account.address, signedMessage: b64(out.signedMessage), signature: b64(out.signature), walletName: wallet.name };
}
```

Create `apps/web/src/features/auth/wallet/mobile.ts`:

```ts
const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export const isMobile = (agent = ua()) => /Android|iPhone|iPad|iPod/i.test(agent);
/** Android Chrome itself (not an in-app webview): the only place Mobile Wallet Adapter works. */
export const isAndroidChrome = (agent = ua()) => /Android/i.test(agent) && /Chrome\/\d/.test(agent) && !/\bwv\b/.test(agent);

/** Opens `url` inside Phantom's in-app browser, where the wallet is injected and detected as usual. */
export const phantomBrowse = (url: string, origin: string) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`;
/** Solflare's Browse deeplink, in the format docs.solflare.com gives. */
export const solflareBrowse = (url: string, origin: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`;

let mwa: Promise<void> | null = null;
/** On Android Chrome, registers Mobile Wallet Adapter once, so the phone's installed wallets appear in the picker. */
export function registerMobileWalletAdapter(): Promise<void> | null {
  if (mwa || !isAndroidChrome()) return mwa;
  mwa = import('@solana-mobile/wallet-standard-mobile').then((m) => m.registerMwa({
    appIdentity: { name: 'Shillex', uri: window.location.origin, icon: '/favicon.svg' },
    authorizationCache: m.createDefaultAuthorizationCache(),
    chains: ['solana:mainnet'],
    chainSelector: m.createDefaultChainSelector(),
    onWalletNotFound: m.createDefaultWalletNotFoundHandler(),
  })).catch((e: unknown) => { console.warn('[wallet] Mobile Wallet Adapter unavailable', e); });
  return mwa;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run test/walletRegistry.test.ts test/walletSign.test.ts test/walletMobile.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors. If `registerMwa`'s `appIdentity.icon` type asks for a relative path, `/favicon.svg` already is one.

```bash
git add apps/web/package.json package-lock.json apps/web/vite.config.ts apps/web/src/features/auth/wallet apps/web/test/fakeWallet.ts apps/web/test/walletRegistry.test.ts apps/web/test/walletSign.test.ts apps/web/test/walletMobile.test.ts
git commit -m "feat(auth): find any Wallet Standard wallet and sign a challenge in one prompt or by message; phones get browse links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The wallet picker and button

**Files:**
- Create: `apps/web/src/features/auth/wallet/WalletGlyph.tsx`, `WalletPicker.tsx`, `wallet.module.css`
- Create: `apps/web/src/features/auth/WalletButton.tsx`
- Test: `apps/web/test/WalletPicker.test.tsx`

**Interfaces:**
- Consumes: Task 10's modules; `Dialog`, `Button`, `Spinner`; `ApiError`.
- Produces:
  - `default export WalletPicker({ open, onClose, purpose, onProof })`. `onProof(proof): Promise<void>` throws to keep the dialog open with the error.
  - `WalletButton({ purpose, onProof, label?, variant?, size?, disabled?, className? })`, which lazy-loads the picker.
  - `WalletGlyph({ name, icon, colour, small? })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/WalletPicker.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import WalletPicker from '../src/features/auth/wallet/WalletPicker';
import { ApiError } from '../src/lib/api';
import { mockFetch, renderWithApp } from './utils';
import { CHALLENGE, fakeWallet } from './fakeWallet';

const offs: (() => void)[] = [];
afterEach(() => { offs.splice(0).forEach((off) => off()); });
const add = (o: Parameters<typeof fakeWallet>[0]) => { const f = fakeWallet(o); offs.push(f.unregister); return f; };
function picker(onProof = vi.fn(async () => undefined), onClose = vi.fn()) {
  renderWithApp(<WalletPicker open onClose={onClose} purpose="login" onProof={onProof} />);
  return { onProof, onClose };
}

describe('WalletPicker', () => {
  it('shows installed featured wallets, install links for the rest, and other wallets below', async () => {
    add({ name: 'Phantom' }); add({ name: 'Glow' }); add({ name: 'Devnet', chains: ['solana:devnet'] });
    picker();
    expect(await screen.findByRole('button', { name: /Phantom/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install Solflare' })).toHaveAttribute('href', 'https://solflare.com/download');
    expect(screen.getByRole('link', { name: 'Install Backpack' })).toHaveAttribute('href', 'https://backpack.app/downloads');
    expect(screen.getByRole('heading', { name: 'Other wallets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Glow/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Devnet/ })).toBeNull();
  });

  it('picking a wallet signs, hands the proof over, remembers the wallet and closes', async () => {
    add({ name: 'Phantom' });
    mockFetch({ '/api/auth/wallet/challenge': CHALLENGE });
    const { onProof, onClose } = picker();
    fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onProof).toHaveBeenCalledWith(expect.objectContaining({ mode: 'signIn', walletName: 'Phantom' }));
    expect(localStorage.getItem('sx:last-wallet')).toBe('Phantom');
  });

  it('stays open with the server’s reason when the proof is refused', async () => {
    add({ name: 'Phantom' });
    mockFetch({ '/api/auth/wallet/challenge': CHALLENGE });
    const { onClose } = picker(vi.fn(async () => { throw new ApiError(409, 'WALLET_IN_USE', 'This wallet is linked to another Shillex account.'); }));
    fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This wallet is linked to another Shillex account.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a phone with no wallet gets links that open Shillex inside Phantom or Solflare', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    picker();
    expect(await screen.findByRole('link', { name: 'Open in Phantom' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/phantom\.app\/ul\/browse\//));
    expect(screen.getByRole('link', { name: 'Open in Solflare' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/solflare\.com\/ul\/v1\/browse\//));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/WalletPicker.test.tsx`
Expected: FAIL, with `WalletPicker` not found.

- [ ] **Step 3: Write the components**

Create `apps/web/src/features/auth/wallet/wallet.module.css`:

```css
/* The three featured wallets as small overlapping marks inside the sign-in button. */
.trio { display: inline-flex; margin-right: 2px; }
.trio > * + * { margin-left: -6px; }
.glyph { display: inline-grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 8px; color: var(--bg); font: 800 13px / 1 var(--font-brand); object-fit: cover; }
.small { width: 18px; height: 18px; border-radius: 6px; font-size: 10px; box-shadow: 0 0 0 2px var(--panel); }

.picker { width: min(420px, calc(100vw - 32px)); }
.list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--raised); color: var(--text); font-size: var(--fs-md); text-align: left; }
button.row { cursor: pointer; transition: border-color .15s, background .15s; }
button.row:hover:not(:disabled) { border-color: var(--accent-line); background: var(--hover); }
button.row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rowName { flex: 1; font-weight: 600; }
.rowNote { color: var(--muted); font-size: var(--fs-xs); }
.install { color: var(--accent-hover); font-size: var(--fs-sm); font-weight: 600; }
.group { margin: 16px 0 8px; color: var(--muted); font-size: var(--fs-xs); font-weight: 650; letter-spacing: .04em; text-transform: uppercase; }
.mobile { display: grid; gap: 8px; margin-top: 14px; }
.deep { display: block; padding: 11px 12px; border: 1px solid var(--accent-line); border-radius: var(--radius-sm); color: var(--text); font-weight: 600; text-align: center; }
.note { margin: 14px 0 0; color: var(--muted); font-size: var(--fs-sm); }
.error { margin-top: 12px; padding: 9px 12px; border-radius: var(--radius-sm); background: var(--down-soft); color: var(--down); font-size: var(--fs-sm); }
@media (prefers-reduced-motion: reduce) { button.row { transition: none; } }
```

Create `apps/web/src/features/auth/wallet/WalletGlyph.tsx`:

```tsx
import { cx } from '../../../lib/cx';
import s from './wallet.module.css';

/** A wallet's own registered icon when installed; otherwise a monogram in its brand colour. Decorative: the name is always beside it. */
export function WalletGlyph({ name, icon, colour, small }: { name: string; icon: string | null; colour: string | null; small?: boolean }) {
  return icon
    ? <img className={cx(s.glyph, small && s.small)} src={icon} alt="" width={small ? 18 : 28} height={small ? 18 : 28} />
    : <span className={cx(s.glyph, small && s.small)} style={{ background: colour ?? 'var(--line-strong)' }} aria-hidden="true">{name.slice(0, 1)}</span>;
}
```

Create `apps/web/src/features/auth/wallet/WalletPicker.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Wallet } from '@wallet-standard/base';
import type { WalletProof, WalletPurpose } from '@shillex/shared';
import { ApiError } from '../../../lib/api';
import { Dialog } from '../../../components/ui/Dialog';
import { Spinner } from '../../../components/ui/Spinner';
import { arrange, lastWallet, rememberWallet, useWalletList, type PickerEntry } from './registry';
import { walletProof } from './sign';
import { isMobile, phantomBrowse, registerMobileWalletAdapter, solflareBrowse } from './mobile';
import { WalletGlyph } from './WalletGlyph';
import s from './wallet.module.css';

const TITLES: Record<WalletPurpose, string> = { login: 'Continue with a wallet', reset: 'Sign with your wallet', link: 'Add a wallet', confirm: 'Confirm with a wallet' };

export interface WalletPickerProps { open: boolean; onClose: () => void; purpose: WalletPurpose; onProof: (proof: WalletProof) => Promise<void> }

/** The wallet sheet (spec §4). Loaded lazily by WalletButton, so none of this ships with the feed. */
export default function WalletPicker({ open, onClose, purpose, onProof }: WalletPickerProps) {
  const wallets = useWalletList();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void registerMobileWalletAdapter(); }, []);
  const { recent, featured, others } = arrange(wallets, lastWallet());

  async function pick(w: Wallet) {
    setBusy(w.name); setError(null);
    try {
      const proof = await walletProof(w, purpose);
      rememberWallet(w.name);
      await onProof(proof);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The wallet didn’t sign. Try again, or pick another wallet.');
    } finally { setBusy(null); }
  }

  const row = (e: PickerEntry) => e.wallet ? (
    <li key={e.name}>
      <button type="button" className={s.row} onClick={() => void pick(e.wallet!)} disabled={busy !== null} aria-busy={busy === e.name || undefined}>
        <WalletGlyph name={e.name} icon={e.wallet.icon} colour={e.colour} />
        <span className={s.rowName}>{e.name}</span>
        {busy === e.name ? <Spinner /> : e === recent && <span className={s.rowNote}>Last used</span>}
      </button>
    </li>
  ) : (
    <li key={e.name} className={s.row}>
      <WalletGlyph name={e.name} icon={null} colour={e.colour} />
      <span className={s.rowName}>{e.name}</span>
      <a className={s.install} href={e.install!} target="_blank" rel="noopener noreferrer" aria-label={`Install ${e.name}`}>Install</a>
    </li>
  );

  return (
    <Dialog open={open} onClose={onClose} title={TITLES[purpose]} className={s.picker}>
      <ul className={s.list} aria-label="Wallets">{[...(recent ? [recent] : []), ...featured].map(row)}</ul>
      {others.length > 0 && <>
        <h3 className={s.group}>Other wallets</h3>
        <ul className={s.list} aria-label="Other wallets">{others.map(row)}</ul>
      </>}
      {wallets.length === 0 && isMobile() && (
        <div className={s.mobile}>
          <p className={s.note}>No wallet in this browser. Open Shillex inside your wallet app:</p>
          <a className={s.deep} href={phantomBrowse(window.location.href, window.location.origin)}>Open in Phantom</a>
          <a className={s.deep} href={solflareBrowse(window.location.href, window.location.origin)}>Open in Solflare</a>
        </div>
      )}
      {error && <div className={s.error} role="alert">{error}</div>}
      <p className={s.note}>Signing proves you own the wallet. It costs nothing and moves no funds.</p>
    </Dialog>
  );
}
```

Create `apps/web/src/features/auth/WalletButton.tsx`:

```tsx
import { lazy, Suspense, useState } from 'react';
import type { WalletProof, WalletPurpose } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import { FEATURED } from './wallet/featured';
import { WalletGlyph } from './wallet/WalletGlyph';
import s from './wallet/wallet.module.css';

// The wallet libraries load only when someone opens the picker, so the feed bundle doesn't grow (spec §4).
const WalletPicker = lazy(() => import('./wallet/WalletPicker'));

export function WalletButton({ purpose, onProof, label = 'Continue with a wallet', variant = 'primary', size = 'md', disabled, className }: {
  purpose: WalletPurpose; onProof: (proof: WalletProof) => Promise<void>; label?: string;
  variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {size === 'md' && <span className={s.trio} aria-hidden="true">{FEATURED.map((f) => <WalletGlyph key={f.name} name={f.name} icon={null} colour={f.colour} small />)}</span>}
        {label}
      </Button>
      {open && <Suspense fallback={null}><WalletPicker open onClose={() => setOpen(false)} purpose={purpose} onProof={onProof} /></Suspense>}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run test/WalletPicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/web/src/features/auth/wallet/WalletGlyph.tsx apps/web/src/features/auth/wallet/WalletPicker.tsx apps/web/src/features/auth/wallet/wallet.module.css apps/web/src/features/auth/WalletButton.tsx apps/web/test/WalletPicker.test.tsx
git commit -m "feat(auth): wallet picker — Phantom, Solflare and Backpack featured, any other wallet listed, phones open in the wallet app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The login screen

**Files:**
- Modify: `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/auth/auth.module.css`
- Create: `apps/web/src/features/auth/ForgotPassword.tsx`
- Create: `apps/web/src/features/auth/WalletSignupPage.tsx` (only the exported `WalletSignupState` type in this task; Task 13 adds the page)
- Test: `apps/web/test/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `WalletButton` (Task 11); `POST /auth/wallet/verify` (Tasks 3/7), `POST /auth/password/reset-with-wallet` (Task 8).
- Produces:
  - `interface WalletSignupState { token: string; address: string; walletName: string | null; next: string }`, carried in router state to `/signup/wallet`.
  - `ForgotPassword({ onSignedIn })`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/test/LoginPage.test.tsx`:
- extend the imports with `import { fireEvent } from '@testing-library/react';`, `import { Routes, Route, useLocation } from 'react-router';` and `import { me } from './utils';`;
- add `import { CHALLENGE, FAKE_ADDRESS, fakeWallet } from './fakeWallet';`;
- add these cases inside the `describe`:

```tsx
  it('offers a wallet first, then a username-or-email form', async () => {
    mockFetch({});
    renderWithApp(<LoginPage />, { route: '/login' });
    expect(await screen.findByRole('button', { name: 'Continue with a wallet' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
  });

  it('an unknown wallet goes on to pick a username', async () => {
    const f = fakeWallet({ name: 'Phantom' });
    try {
      mockFetch({ '/api/auth/wallet/challenge': CHALLENGE, '/api/auth/wallet/verify': { status: 'new', signupToken: 'tok', address: FAKE_ADDRESS, walletName: 'Phantom' } });
      function Step() { return <p>step for {(useLocation().state as { token: string }).token}</p>; }
      renderWithApp(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/signup/wallet" element={<Step />} /></Routes>, { route: '/login' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue with a wallet' }));
      fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
      expect(await screen.findByText('step for tok')).toBeInTheDocument();
    } finally { f.unregister(); }
  });

  it('a known wallet signs straight in', async () => {
    const f = fakeWallet({ name: 'Phantom' });
    try {
      mockFetch({ '/api/auth/wallet/challenge': CHALLENGE, '/api/auth/wallet/verify': { status: 'signedIn', user: me } });
      renderWithApp(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<p>home</p>} /></Routes>, { route: '/login' });
      fireEvent.click(await screen.findByRole('button', { name: 'Continue with a wallet' }));
      fireEvent.click(await screen.findByRole('button', { name: /Phantom/ }));
      expect(await screen.findByText('home')).toBeInTheDocument();
    } finally { f.unregister(); }
  });

  it('“Forgot password?” explains the wallet reset', async () => {
    mockFetch({});
    renderWithApp(<LoginPage />, { route: '/login' });
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByText(/Shillex sends no email/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign with your wallet' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/LoginPage.test.tsx`
Expected: the new cases FAIL (no wallet button, no "Username or email" label); the three existing cases pass.

- [ ] **Step 3: Write the state type and the reset panel**

Create `apps/web/src/features/auth/WalletSignupPage.tsx`, holding only the type for now:

```tsx
/** Router state from a wallet sign-in that found no account: the one-use token and the wallet it proved. */
export interface WalletSignupState { token: string; address: string; walletName: string | null; next: string }
```

Create `apps/web/src/features/auth/ForgotPassword.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import type { MeView, WalletProof } from '@shillex/shared';
import { ApiError, errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { WalletButton } from './WalletButton';
import s from './auth.module.css';

/** Spec §5: Shillex sends no email, so a forgotten password is reset by signing with a wallet linked to the account. */
export function ForgotPassword({ onSignedIn }: { onSignedIn: (user: MeView) => void }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<WalletProof | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <p className={s.forgot}><button type="button" className={s.linkButton} onClick={() => setOpen(true)}>Forgot password?</button></p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!proof) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: MeView }>('/auth/password/reset-with-wallet', { proof, password });
      onSignedIn(r.user);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && ['CHALLENGE_EXPIRED', 'NO_WALLET_ACCOUNT', 'SIGN_IN_INVALID'].includes(err.code)) setProof(null);
    } finally { setBusy(false); }
  }

  return (
    <section className={s.forgotPanel} aria-labelledby="forgot-title">
      <h2 id="forgot-title" className={s.forgotTitle}>Reset your password</h2>
      <p className={s.forgotText}>Shillex sends no email, so a password is reset with a wallet linked to your account. No wallet linked? There is no self-service reset: link one in Settings while you can still sign in.</p>
      {error && <div className={s.error} role="alert">{error}</div>}
      {!proof
        ? <WalletButton purpose="reset" label="Sign with your wallet" variant="secondary" onProof={async (p) => setProof(p)} />
        : <form className={s.form} onSubmit={submit}>
            <label className={s.field}>New password<input className={s.input} type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <Button type="submit" variant="primary" className={s.submit} loading={busy}>Set password and sign in</Button>
          </form>}
    </section>
  );
}
```

Append to `apps/web/src/features/auth/auth.module.css`:

```css
/* Wallet first, password second (spec §6). */
.walletButton { width: 100%; height: 44px; font-size: var(--fs-md); }
.forgot { margin: 10px 0 0; text-align: right; font-size: var(--fs-sm); }
.linkButton { padding: 0; border: 0; background: none; color: var(--accent-hover); font: inherit; font-weight: 600; cursor: pointer; }
.linkButton:hover { text-decoration: underline; text-underline-offset: 3px; }
.linkButton:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.forgotPanel { display: grid; gap: 12px; margin-top: 16px; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--bg) 55%, transparent); }
.forgotTitle { margin: 0; font-size: var(--fs-md); font-weight: 650; }
.forgotText { margin: 0; color: var(--muted); font-size: var(--fs-sm); }
```

- [ ] **Step 4: Rework the login page**

In `apps/web/src/features/auth/LoginPage.tsx`:
- add the imports `import type { WalletProof, WalletVerifyResult } from '@shillex/shared';`, `import { WalletButton } from './WalletButton';`, `import { ForgotPassword } from './ForgotPassword';` and `import type { WalletSignupState } from './WalletSignupPage';` (keep `MeView` in the existing type import);
- inside the component, before `return`, add:

```tsx
  const finish = (user: MeView) => { qc.setQueryData(['me'], user); nav(next, { replace: true }); };
  async function withWallet(proof: WalletProof) {
    const r = await post<WalletVerifyResult>('/auth/wallet/verify', { ...proof, purpose: 'login' });
    if (r.status === 'signedIn') finish(r.user);
    else if (r.status === 'new') nav('/signup/wallet', { state: { token: r.signupToken, address: r.address, walletName: r.walletName, next } satisfies WalletSignupState });
  }
```

- In `go()`, replace the two lines after the request with `finish(r.user);`.
- Replace the JSX from the tagline down to (not including) `<motion.p … className={s.watch}>` with:

```tsx
        <motion.p variants={fadeUp} className={s.tagline}>Fifty agents, one market.<span className={s.taglineSub}>They post, trade, feud and rug each other on Solana devnet. Watch it happen, or join in.</span></motion.p>
        <motion.div variants={fadeUp}><WalletButton purpose="login" onProof={withWallet} className={s.walletButton} /></motion.div>
        <motion.div variants={fadeUp} className={s.divider}>or</motion.div>
        <motion.form variants={fadeUp} className={s.form} onSubmit={(e) => go('login', e)}>
          <label className={s.field}>Username or email<input className={s.input} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className={s.field}>Password<input className={s.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" className={s.submit} loading={busy === 'login'} disabled={busy !== null}>Sign in</Button>
        </motion.form>
        <motion.div variants={fadeUp}><ForgotPassword onSignedIn={finish} /></motion.div>
```

The password "Sign in" button drops `variant="primary"`: the wallet is the primary action (spec §6).

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run test/LoginPage.test.tsx`
Expected: PASS (all seven cases).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/web/src/features/auth/LoginPage.tsx apps/web/src/features/auth/ForgotPassword.tsx apps/web/src/features/auth/WalletSignupPage.tsx apps/web/src/features/auth/auth.module.css apps/web/test/LoginPage.test.tsx
git commit -m "feat(auth): login leads with a wallet, takes a username or email, and resets a forgotten password with a wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Signup with tabs, and "Pick a username" after a new wallet

**Files:**
- Modify: `apps/web/src/features/auth/SignupPage.tsx`
- Modify: `apps/web/src/features/auth/WalletSignupPage.tsx` (the page)
- Modify: `apps/web/src/routes.tsx`
- Modify: `apps/web/test/utils.tsx` (optional router `state`)
- Test: `apps/web/test/SignupPage.test.tsx`, `apps/web/test/WalletSignupPage.test.tsx`

**Interfaces:**
- Consumes: `WalletButton`, `WalletSignupState`; `POST /auth/signup` with `email` (Task 5), `POST /auth/wallet/signup` (Task 4).
- Produces: route `/signup/wallet` → `WalletSignupPage`; `renderWithApp(ui, { route, path, seed, state })`.

- [ ] **Step 1: Let tests carry router state**

In `apps/web/test/utils.tsx`, change `renderWithApp`'s options and router:

```tsx
export function renderWithApp(ui: ReactNode, { route = '/', path = '*', seed, state }: { route?: string; path?: string; seed?: (qc: QueryClient) => void; state?: unknown } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['me'], me);
  seed?.(qc);
  const router = createMemoryRouter([{ path, element: ui }], { initialEntries: [state === undefined ? route : { pathname: route, state }] });
  return { qc, ...render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>) };
}
```

- [ ] **Step 2: Write the failing tests**

Add to `apps/web/test/SignupPage.test.tsx`:
- extend the imports with `waitFor`, plus `mockFetch, me` from `./utils`;
- add:

```tsx
  it('the Email tab signs up with an email too; the wallet button is there', async () => {
    let body: unknown = null;
    mockFetch({ '/api/auth/signup': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { user: me }; } });
    renderWithApp(<SignupPage />, { route: '/signup' });
    expect(screen.getByRole('button', { name: 'Continue with a wallet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Email' }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'Ape@Example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ape_one' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ape' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(body).toEqual({ username: 'ape_one', displayName: 'Ape', password: 'long-enough-1', email: 'Ape@Example.com' }));
  });
```

Create `apps/web/test/WalletSignupPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { mockFetch, renderWithApp, me } from './utils';
import { WalletSignupPage } from '../src/features/auth/WalletSignupPage';
import { FAKE_ADDRESS } from './fakeWallet';

const state = { token: 'tok-1234567890-abcdefghij', address: FAKE_ADDRESS, walletName: 'Phantom', next: '/' };
const app = (s?: object) => renderWithApp(
  <Routes><Route path="/signup/wallet" element={<WalletSignupPage />} /><Route path="/" element={<p>home</p>} /><Route path="/signup" element={<p>signup</p>} /></Routes>,
  { route: '/signup/wallet', state: s },
);

describe('WalletSignupPage', () => {
  it('creates the account with the signed wallet and a chosen username', async () => {
    let body: unknown = null;
    mockFetch({ '/api/auth/wallet/signup': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { user: me }; } });
    app(state);
    expect(screen.getByRole('heading', { name: 'Pick a username' })).toBeInTheDocument();
    expect(screen.getByText('Phantom')).toBeInTheDocument();
    expect(screen.getByText('DezX…B263')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'wallet_ape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(body).toEqual({ signupToken: state.token, username: 'wallet_ape' });
  });

  it('without a signed wallet it goes back to signup', async () => {
    app();
    expect(await screen.findByText('signup')).toBeInTheDocument();
  });

  it('an expired sign-in says so', async () => {
    mockFetch({ '/api/auth/wallet/signup': new Response(JSON.stringify({ code: 'SIGNUP_EXPIRED', message: 'That wallet sign-in expired. Sign with your wallet again.' }), { status: 400 }) });
    app(state);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'late_ape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('expired');
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/SignupPage.test.tsx test/WalletSignupPage.test.tsx`
Expected: FAIL. There is no Email tab, no wallet button, and no `WalletSignupPage` export.

- [ ] **Step 4: Write the wallet signup page**

Replace `apps/web/src/features/auth/WalletSignupPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { BadgeCheck } from 'lucide-react';
import { abbreviateMint, type MeView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { safeNext } from '../../lib/safe-next';
import { fadeUp, stagger } from '../../lib/motion';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import s from './auth.module.css';

/** Router state from a wallet sign-in that found no account: the one-use token and the wallet it proved. */
export interface WalletSignupState { token: string; address: string; walletName: string | null; next: string }

/** Spec §3.4 / §6: after a new wallet signs, the person picks a username. The wallet shows as a chip. */
export function WalletSignupPage() {
  const state = useLocation().state as WalletSignupState | null;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state?.token) return <Navigate to="/signup" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: MeView }>('/auth/wallet/signup', { signupToken: state!.token, username, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      qc.setQueryData(['me'], r.user);
      nav(safeNext(state!.next), { replace: true });
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className={s.page}>
      <motion.main className={s.card} variants={stagger(0.05, 0.2)} initial="hidden" animate="show">
        <h1 className={s.title}><Wordmark size={34} /></h1>
        <motion.h2 variants={fadeUp} className={s.tagline}>Pick a username</motion.h2>
        <motion.div variants={fadeUp} className={s.walletChip}>
          <BadgeCheck size={15} aria-hidden="true" /><span>{state.walletName ?? 'Wallet'}</span><span className="mono">{abbreviateMint(state.address, 4, 4)}</span>
        </motion.div>
        <motion.form variants={fadeUp} className={s.form} onSubmit={submit}>
          <label className={s.field}>Username<input className={s.input} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className={s.field}>Display name (optional)<input className={s.input} maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" variant="primary" className={s.submit} loading={busy}>Create account</Button>
        </motion.form>
      </motion.main>
    </div>
  );
}
```

Append to `auth.module.css`:

```css
.walletChip { display: inline-flex; align-items: center; gap: 8px; margin: -12px 0 18px; padding: 6px 12px; border: 1px solid var(--token-line); border-radius: var(--radius-pill); background: var(--token-soft); color: var(--text); font-size: var(--fs-sm); }
.walletChip svg { color: var(--token); }
```

In `apps/web/src/routes.tsx`, import the page and add the route after `/signup`:

```tsx
import { WalletSignupPage } from './features/auth/WalletSignupPage';
```

```tsx
  { path: '/signup/wallet', element: <WalletSignupPage /> },
```

- [ ] **Step 5: Add tabs and the wallet button to signup**

In `apps/web/src/features/auth/SignupPage.tsx`:
- add the imports `import type { WalletProof, WalletVerifyResult } from '@shillex/shared';`, `import { Tabs } from '../../components/ui/Tabs';`, `import { WalletButton } from './WalletButton';` and `import type { WalletSignupState } from './WalletSignupPage';`;
- change the form state to `useState({ username: '', displayName: '', password: '', email: '' })`, and add `const [tab, setTab] = useState<'username' | 'email'>('username');`;
- in `submit`, send `const { email, ...rest } = form; const r = await post<{ user: MeView }>('/auth/signup', tab === 'email' ? { ...rest, email } : rest);`;
- add the wallet handler:

```tsx
  async function withWallet(proof: WalletProof) {
    const r = await post<WalletVerifyResult>('/auth/wallet/verify', { ...proof, purpose: 'login' });
    if (r.status === 'signedIn') { qc.setQueryData(['me'], r.user); nav(next, { replace: true }); }
    else if (r.status === 'new') nav('/signup/wallet', { state: { token: r.signupToken, address: r.address, walletName: r.walletName, next } satisfies WalletSignupState });
  }
```

Replace the JSX between the tagline and `{/* switch */}` (the `motion.form`) with:

```tsx
        <motion.div variants={fadeUp}><WalletButton purpose="login" onProof={withWallet} className={s.walletButton} /></motion.div>
        <motion.div variants={fadeUp} className={s.divider}>or</motion.div>
        <motion.div variants={fadeUp}>
          {/* idPrefix "su-tab": the plain "su" prefix would give the Username tab the id of the username input below. */}
          <Tabs label="Sign up with" idPrefix="su-tab" value={tab} onChange={(id) => setTab(id as 'username' | 'email')} tabs={[{ id: 'username', label: 'Username' }, { id: 'email', label: 'Email' }]} />
          {/* One form, never remounted (state and fields persist across tabs). Its own label, not the tab's: a panel labelled
              "Username" would also match getByLabel('Username') in the e2e signUp fixture. */}
          <div id="su-tab-panel" role="tabpanel" aria-label="Sign-up form">
            <form className={s.form} onSubmit={submit}>
              {tab === 'email' && <label className={s.field}>Email<input className={s.input} type="email" autoComplete="email" maxLength={254} value={form.email} onChange={set('email')} required /></label>}
              <div className={s.field}><label htmlFor="su-username">Username</label><input id="su-username" className={s.input} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" aria-describedby="su-username-hint" onBlur={leave('username')} value={form.username} onChange={set('username')} required />
                <Hint id="su-username-hint" value={form.username} ok={USERNAME_RE.test(form.username)} touched={touched.username}>3–20 letters, numbers or _</Hint></div>
              <label className={s.field}>Display name<input className={s.input} maxLength={40} value={form.displayName} onChange={set('displayName')} required /></label>
              <div className={s.field}><label htmlFor="su-password">Password</label><input id="su-password" className={s.input} type="password" autoComplete="new-password" minLength={8} aria-describedby="su-password-hint" onBlur={leave('password')} value={form.password} onChange={set('password')} required />
                <Hint id="su-password-hint" value={form.password} ok={form.password.length >= 8} touched={touched.password}>At least 8 characters</Hint></div>
              {error && <div className={s.error} role="alert">{error}</div>}
              <Button type="submit" variant="primary" className={s.submit} loading={busy}>Create account</Button>
            </form>
          </div>
        </motion.div>
```

Keep the existing tagline text: "Join the trenches." with sub-line "Wallets are optional and never shown unless you choose."

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run test/SignupPage.test.tsx test/WalletSignupPage.test.tsx test/LoginPage.test.tsx`
Expected: PASS. The original SignupPage hint test still passes, because the Username tab is the default.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/web/src/features/auth/SignupPage.tsx apps/web/src/features/auth/WalletSignupPage.tsx apps/web/src/features/auth/auth.module.css apps/web/src/routes.tsx apps/web/test/utils.tsx apps/web/test/SignupPage.test.tsx apps/web/test/WalletSignupPage.test.tsx
git commit -m "feat(auth): sign up with a wallet, a username or an email; a new wallet picks its username next

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Settings → Sign-in methods

**Files:**
- Create: `apps/web/src/features/profile/SignInSection.tsx`
- Modify: `apps/web/src/features/profile/SettingsPage.tsx`, `apps/web/src/features/profile/profile.module.css`
- Test: `apps/web/test/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `SignInView`, `WalletView`, `AccountProof`; `PUT /me/password`, `PUT /me/email`, `PATCH|DELETE /me/wallets/:address`, `POST /auth/wallet/verify {purpose: 'link'}`; `WalletButton`.
- Produces: `SignInSection({ data: SettingsView; commit: (view: SettingsView, ok: string) => void })`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/test/SettingsPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { abbreviateMint } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { SettingsPage } from '../src/features/profile/SettingsPage';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';
const signIn = { hasPassword: false, email: null, payoutEnabled: false, wallets: [
  { address: A, walletName: 'Phantom', verified: true, verifiedAt: '2026-10-01T00:00:00.000Z', showOnProfile: false, isPayout: false, lastLoginAt: null },
  { address: B, walletName: null, verified: false, verifiedAt: null, showOnProfile: true, isPayout: false, lastLoginAt: null },
] };
const settings = { profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, signIn, notificationPrefs: [{ type: 'follow', enabled: true }, { type: 'reaction', enabled: true }], mutedWords: [] };
const base = { '/api/me/settings': settings, '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] } };

describe('SettingsPage', () => {
  it('lists linked wallets: signed ones with a tick, typed ones with Verify', async () => {
    mockFetch(base);
    renderWithApp(<SettingsPage />);
    const list = await screen.findByRole('list', { name: 'Linked wallets' });
    expect(within(list).getByText('Verified')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a wallet' })).toBeInTheDocument();
  });

  it('show-on-profile and remove call the wallet routes', async () => {
    const calls: { method?: string; body?: unknown }[] = [];
    mockFetch({ ...base, [`/api/me/wallets/${A}`]: (init?: RequestInit) => { calls.push({ method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return settings; } });
    renderWithApp(<SettingsPage />);
    fireEvent.click((await screen.findAllByRole('checkbox', { name: 'Show on profile' }))[0]!);
    await waitFor(() => expect(calls[0]).toEqual({ method: 'PATCH', body: { showOnProfile: true } }));
    fireEvent.click(screen.getByRole('button', { name: `Remove wallet ${abbreviateMint(A, 4, 4)}` }));
    await waitFor(() => expect(calls[1]).toEqual({ method: 'DELETE', body: undefined }));
  });

  it('an account with a password changes it with the current one', async () => {
    let body: unknown = null;
    mockFetch({ ...base, '/api/me/settings': { ...settings, signIn: { ...signIn, hasPassword: true } }, '/api/me/password': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return settings; } });
    renderWithApp(<SettingsPage />);
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(body).toEqual({ password: 'new-password-1', proof: { password: 'old-password' } }));
  });

  it('an account without a password confirms changes with a wallet', async () => {
    mockFetch(base);
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('button', { name: 'Set password (confirm with a wallet)' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByText(/Email sign-in needs a password/)).toBeInTheDocument();
  });

  it('lists notification preferences as toggles', async () => {
    mockFetch(base);
    renderWithApp(<SettingsPage />);
    expect(await screen.findByRole('checkbox', { name: 'New followers' })).toBeChecked();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && npx vitest run test/SettingsPage.test.tsx`
Expected: FAIL. The wallet list and the password controls are missing; the notification test passes.

- [ ] **Step 3: Write the section**

Create `apps/web/src/features/profile/SignInSection.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { BadgeCheck, Trash2 } from 'lucide-react';
import { abbreviateMint, AUTH_LIMITS, type AccountProof, type SettingsView, type SignInView, type WalletProof, type WalletVerifyResult, type WalletView } from '@shillex/shared';
import { del, errorMessage, patch, post, put } from '../../lib/api';
import { Button, IconButton } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { WalletButton } from '../auth/WalletButton';
import s from './profile.module.css';

type Commit = (view: SettingsView, ok: string) => void;

/** Spec §6: password, email and wallets. Changes need the current password, or (no password) a wallet signature. */
export function SignInSection({ data, commit }: { data: SettingsView; commit: Commit }) {
  const si = data.signIn;
  return (
    <section className={s.section} aria-labelledby="set-signin">
      <h2 id="set-signin" className={s.sectionTitle}>Sign-in methods</h2>
      <p className={s.sectionHelp}>Keep at least one way in: a password or a wallet. Your username always works with your password.</p>
      <div className={s.form}>
        <PasswordForm si={si} commit={commit} />
        <EmailForm si={si} commit={commit} />
        <Wallets si={si} commit={commit} />
      </div>
    </section>
  );
}

function PasswordForm({ si, commit }: { si: SignInView; commit: Commit }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (proof: AccountProof) => {
    const v = await put<SettingsView>('/me/password', { password: next, proof });
    setCurrent(''); setNext('');
    commit(v, si.hasPassword ? 'Password changed. Other devices were signed out.' : 'Password set');
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await run({ password: current }); } catch (err) { toast(errorMessage(err), { tone: 'error' }); } finally { setBusy(false); }
  }
  return (
    <form className={s.form} aria-labelledby="set-password" onSubmit={submit}>
      <h3 id="set-password" className={s.subTitle}>Password</h3>
      {si.hasPassword && <label className={s.field}>Current password<input className={s.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>}
      <label className={s.field}>{si.hasPassword ? 'New password' : 'Password'}<input className={s.input} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
      <div className={s.formActions}>
        {si.hasPassword
          ? <Button type="submit" variant="primary" loading={busy} disabled={next.length < 8}>Change password</Button>
          : <WalletButton purpose="confirm" size="sm" label="Set password (confirm with a wallet)" disabled={next.length < 8} onProof={(p) => run({ wallet: p })} />}
      </div>
    </form>
  );
}

function EmailForm({ si, commit }: { si: SignInView; commit: Commit }) {
  const [email, setEmail] = useState(si.email ?? '');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const run = (value: string | null) => async (proof: AccountProof) => {
    const v = await put<SettingsView>('/me/email', { email: value, proof });
    setCurrent('');
    commit(v, value ? 'Email saved' : 'Email removed');
  };
  async function viaPassword(value: string | null, which: 'save' | 'remove') {
    setBusy(which);
    try { await run(value)({ password: current }); } catch (err) { toast(errorMessage(err), { tone: 'error' }); } finally { setBusy(null); }
  }
  const trimmed = email.trim();
  return (
    <form className={s.form} aria-labelledby="set-email" onSubmit={(e) => { e.preventDefault(); void viaPassword(trimmed, 'save'); }}>
      <h3 id="set-email" className={s.subTitle}>Email</h3>
      <p className={s.muted} style={{ margin: 0 }}>Sign in with it instead of your username. Shillex never emails you and never shows it to anyone.</p>
      {!si.hasPassword && <p className={s.muted} style={{ margin: 0 }}>Email sign-in needs a password: set one above.</p>}
      <label className={s.field}>Email<input className={s.input} type="email" autoComplete="email" maxLength={AUTH_LIMITS.emailMax} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {si.hasPassword && <label className={s.field}>Password (to confirm)<input className={s.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>}
      <div className={s.formActions}>
        {si.hasPassword ? <>
          <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!trimmed || trimmed.toLowerCase() === si.email || !current}>Save email</Button>
          {si.email && <Button variant="ghost" loading={busy === 'remove'} disabled={!current} onClick={() => void viaPassword(null, 'remove')}>Remove email</Button>}
        </> : <>
          <WalletButton purpose="confirm" size="sm" label="Save email (confirm with a wallet)" disabled={!trimmed} onProof={run(trimmed)} />
          {si.email && <WalletButton purpose="confirm" size="sm" variant="ghost" label="Remove email (confirm with a wallet)" onProof={run(null)} />}
        </>}
      </div>
    </form>
  );
}

function Wallets({ si, commit }: { si: SignInView; commit: Commit }) {
  const link = async (proof: WalletProof) => {
    const r = await post<WalletVerifyResult>('/auth/wallet/verify', { ...proof, purpose: 'link' });
    if (r.status === 'linked') commit(r.settings, 'Wallet linked');
  };
  return (
    <div className={s.form}>
      <h3 className={s.subTitle}>Wallets</h3>
      {si.wallets.length === 0
        ? <p className={s.muted} style={{ margin: 0 }}>No wallets linked.</p>
        : <ul className={s.walletList} aria-label="Linked wallets">{si.wallets.map((w) => <WalletRow key={w.address} w={w} si={si} commit={commit} onVerify={link} />)}</ul>}
      {si.wallets.length < AUTH_LIMITS.walletsPerAccount && <div><WalletButton purpose="link" variant="secondary" label="Add a wallet" onProof={link} /></div>}
    </div>
  );
}

function WalletRow({ w, si, commit, onVerify }: { w: WalletView; si: SignInView; commit: Commit; onVerify: (p: WalletProof) => Promise<void> }) {
  const short = abbreviateMint(w.address, 4, 4);
  const act = async (fn: () => Promise<SettingsView>, ok: string) => {
    try { commit(await fn(), ok); } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return (
    <li className={s.walletRow}>
      <div className={s.walletRowHead}>
        <span className={s.walletRowName}>{w.walletName ?? 'Wallet'}</span>
        <span className="mono">{short}</span>
        {w.verified
          ? <span className={s.walletVerified}><BadgeCheck size={14} aria-hidden="true" />Verified</span>
          : <WalletButton purpose="link" size="sm" variant="ghost" label="Verify" onProof={onVerify} />}
        <IconButton label={`Remove wallet ${short}`} onClick={() => void act(() => del<SettingsView>(`/me/wallets/${w.address}`), 'Wallet removed')}><Trash2 size={14} /></IconButton>
      </div>
      <label className={s.toggle}>
        <input type="checkbox" className={s.switch} checked={w.showOnProfile} disabled={!w.verified}
          onChange={(e) => void act(() => patch<SettingsView>(`/me/wallets/${w.address}`, { showOnProfile: e.target.checked }), e.target.checked ? 'Shown on your profile' : 'Hidden from your profile')} />
        <span className={s.toggleText}>Show on profile</span>
      </label>
      {si.payoutEnabled && w.verified && (
        <label className={s.toggle}>
          <input type="radio" name="payout-wallet" checked={w.isPayout} onChange={() => void act(() => patch<SettingsView>(`/me/wallets/${w.address}`, { isPayout: true }), 'Payout wallet set')} />
          <span className={s.toggleText}>Payout wallet</span>
        </label>
      )}
    </li>
  );
}
```

Append to `apps/web/src/features/profile/profile.module.css`:

```css
.walletList { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.walletRow { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.walletRowHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.walletRowName { font-weight: 650; }
.walletVerified { display: inline-flex; align-items: center; gap: 4px; color: var(--token); font-size: var(--fs-sm); font-weight: 600; }
.walletRowHead > :last-child { margin-left: auto; }
```

- [ ] **Step 4: Mount it**

In `apps/web/src/features/profile/SettingsPage.tsx`:
- import `SignInSection` from `./SignInSection`;
- inside `SettingsPage`, after `save`, add:

```tsx
  const commit = (view: SettingsView, ok: string) => {
    qc.setQueryData(['settings'], view);
    toast(ok, { tone: 'success' });
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['profile'] });
  };
```

- render `<SignInSection data={q.data} commit={commit} />` right after `<ProfileSection … />`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/web && npx vitest run test/SettingsPage.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add apps/web/src/features/profile/SignInSection.tsx apps/web/src/features/profile/SettingsPage.tsx apps/web/src/features/profile/profile.module.css apps/web/test/SettingsPage.test.tsx
git commit -m "feat(auth): Settings → Sign-in methods — password, email and wallets, each change confirmed by password or wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: End to end (headless), bundle check, docs

**Files:**
- Create: `e2e/fake-wallet.ts`, `e2e/wallet-login.spec.ts`
- Modify: `README.md` ("What's real and what's demo" table and "Using it")

**Interfaces:**
- Consumes: everything above.
- Produces: `installFakeWallet(page, { id, name, mode }): Promise<{ address: string }>`.

- [ ] **Step 1: Write the fake wallet (signs in Node)**

Create `e2e/fake-wallet.ts`:

```ts
import { generateKeyPairSync, sign } from 'node:crypto';
import bs58 from 'bs58';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import type { Page } from '@playwright/test';

const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#7DE3FF"/></svg>').toString('base64')}`;

/**
 * Registers a Wallet Standard wallet in the page, backed by a real Ed25519 key that signs in Node (exposeFunction), so the
 * server checks genuine signatures. `signIn`: one-step sign-in; `message`: connect + signMessage.
 */
export async function installFakeWallet(page: Page, o: { id: string; name: string; mode: 'signIn' | 'message' }): Promise<{ address: string }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = bs58.encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  await page.exposeFunction(`__sxSign_${o.id}`, (input: Record<string, string> | null, message64: string | null) => {
    const bytes = input
      ? Buffer.from(createSignInMessageText({ ...input, address } as Parameters<typeof createSignInMessageText>[0]))
      : Buffer.from(message64!, 'base64');
    return { signed: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64') };
  });
  await page.addInitScript(({ id, name, address, icon, mode }) => {
    const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const toB64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));
    const signer = () => (window as unknown as Record<string, (i: unknown, m: string | null) => Promise<{ signed: string; signature: string }>>)[`__sxSign_${id}`]!;
    const account = { address, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [] as string[] };
    const features: Record<string, unknown> = {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => undefined },
    };
    if (mode === 'signIn') {
      features['solana:signIn'] = { version: '1.0.0', signIn: async (...inputs: Record<string, string>[]) => Promise.all(inputs.map(async (i) => {
        const r = await signer()(i, null);
        return { account, signedMessage: fromB64(r.signed), signature: fromB64(r.signature) };
      })) };
    } else {
      features['solana:signMessage'] = { version: '1.0.0', signMessage: async (...inputs: { message: Uint8Array }[]) => Promise.all(inputs.map(async (i) => {
        const r = await signer()(null, toB64(i.message));
        return { signedMessage: fromB64(r.signed), signature: fromB64(r.signature) };
      })) };
    }
    const wallet = { version: '1.0.0', name, icon, chains: ['solana:mainnet'], accounts: [], features };
    const register = (api: { register: (w: unknown) => void }) => api.register(wallet);
    window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
    const ev = new Event('wallet-standard:register-wallet');
    Object.defineProperty(ev, 'detail', { value: register });
    window.dispatchEvent(ev);
  }, { id: o.id, name: o.name, address, icon: ICON, mode: o.mode });
  return { address };
}
```

- [ ] **Step 2: Write the e2e spec**

Create `e2e/wallet-login.spec.ts`:

```ts
import { test, expect } from './fixtures';
import { installFakeWallet } from './fake-wallet';

const shell = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Main' }).or(page.getByRole('navigation', { name: 'Tabs' }));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

test('wallet signup, logout, wallet login, a second wallet in settings, and the last-method guard', async ({ page }) => {
  const one = await installFakeWallet(page, { id: 'one', name: 'Shillex Test Wallet', mode: 'signIn' });
  const two = await installFakeWallet(page, { id: 'two', name: 'Second Test Wallet', mode: 'message' });

  await page.goto('/signup');
  await page.getByRole('button', { name: 'Continue with a wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Shillex Test Wallet/ }).click();
  await expect(page.getByRole('heading', { name: 'Pick a username' })).toBeVisible();
  await page.getByLabel('Username').fill('wallet_rider');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(shell(page)).toBeVisible();

  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continue with a wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Shillex Test Wallet/ }).click();
  await expect(shell(page)).toBeVisible();

  await page.goto('/settings');
  const list = page.getByRole('list', { name: 'Linked wallets' });
  await expect(list.getByText(short(one.address))).toBeVisible();
  await page.getByRole('button', { name: 'Add a wallet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Second Test Wallet/ }).click();
  await expect(list.getByText(short(two.address))).toBeVisible();

  await page.getByRole('button', { name: `Remove wallet ${short(two.address)}` }).click();
  await expect(list.getByText(short(two.address))).toHaveCount(0);
  await page.getByRole('button', { name: `Remove wallet ${short(one.address)}` }).click();
  await expect(page.getByText(/last way to sign in/)).toBeVisible();
  await expect(list.getByText(short(one.address))).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e suites headless**

Run: `E2E_WEB_PORT=5292 E2E_API_PORT=3292 npm run e2e`
Expected: every desktop and mobile test passes, `wallet-login.spec.ts` included. The `a11y` spec checks `/settings`, so the new section must pass axe as well. If a port is taken, check what owns it and don't kill it (another project's server); choose the next free pair.

Run: `E2E_AGENTS_WEB_PORT=5292 E2E_AGENTS_API_PORT=3292 npm run e2e:agents`
Expected: PASS. That suite signs up through the same pages.

- [ ] **Step 4: Check the wallet code stays out of the eager bundle**

Run: `npm run build -w @shillex/web`
Then: `grep -l "wallet-standard:app-ready" apps/web/dist/assets/*.js`
Expected: only `wallet-*.js` (and/or the `WalletPicker-*.js` chunk) is listed, never `index-*.js` or `vendor-*.js`. If `vendor-*.js` appears, widen the `wallet` group regex in `vite.config.ts` (Task 10) to cover the package it names, and rebuild.

- [ ] **Step 5: Update the README**

In `README.md`'s "What's real and what's demo" table:
- add to the **Real** row: "sign-in with a Solana wallet (Sign In With Solana: Phantom, Solflare, Backpack and any Wallet Standard wallet), with a username and password, or with an email and password (the email is never verified or mailed)";
- in **Not implemented**, replace "Wallet connection and holdings verification (wallet display is opt-in and labeled not verified)" with "Holdings verification; email verification and email password reset (a password is reset with a linked wallet)".

Under "Using it", add:

```markdown
- **Signing in:** "Continue with a wallet" signs a one-time message (no transaction, no fees). Up to five wallets per account; Settings → Sign-in methods links, verifies and removes them, and a signed wallet shows on your profile only if you turn that on. Shillex never sends email: forgot your password? Sign with a linked wallet on the login page to set a new one.
```

- [ ] **Step 6: Full verification**

Run: `npm run typecheck`
Run: `npm test`
Expected: everything passes, for shared, server and web. Report the counts.

- [ ] **Step 7: Commit**

```bash
git add e2e/fake-wallet.ts e2e/wallet-login.spec.ts README.md
git commit -m "test(auth): headless end-to-end wallet signup, login, linking and the last-method guard with a Node-signed wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Hand the owner the by-hand checks (spec §10)**

These need real wallets, so list them in the final report for the owner; do not run them:
- Phantom, Solflare and Backpack extensions in Chrome against the production CSP (`connect-src 'self' ws: wss:`, `img-src … data:`):
  - each one appears in the picker;
  - each signs in;
  - Solflare and Backpack fall back to message signing if they lack `solana:signIn`.
- Phantom's and Solflare's in-app browsers on a phone, reached through "Open in Phantom/Solflare".
- Android Chrome with Mobile Wallet Adapter (an installed wallet appears as "Mobile Wallet Adapter").

---

## Controller notes (merge)

- **Migrations:** at merge, drop this branch's generated `0007_login_tables` (sql + snapshot + journal entry), regenerate it from the merged `schema.ts`, then carry `*_login_data.sql` over unchanged, numbered right after it. `test/login-migration.test.ts` finds the copy by its `_login_data.sql` suffix.
- **Dropping `wallet_links` (Deviation 4):** after every stream has merged, delete the deprecated `walletLinks` export from `schema.ts` and run `npm run db:generate -w @shillex/server`, which emits `DROP TABLE "wallet_links"`. The LOGIN data copy must already have run before it. The table is unread since Task 6, so dropping it is safe whenever the copy ran first.
- **MAINNET hooks:**
  - MAINNET replaces the bodies of `payoutEnabled(config)` and `payoutHeld(db, userId)` in `services/wallets.ts`.
  - It adds the 72-hour payout-change hold inside `setWalletPrefs` (the `isPayout` branch).
  - It reads `payoutWallet(db, userId)`.
  - The mainnet spec's `wallet_links.verified` wording becomes "the owner's verified `user_wallets` row with `is_payout`".
- **RAISE:** any signed-in human may raise an agent whatever their sign-in method; RAISE's 3-day account-age rule is the brake on cheap wallet accounts.
