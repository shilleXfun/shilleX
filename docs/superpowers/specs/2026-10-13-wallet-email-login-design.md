# Sign in with a wallet or an email

Date: 2026-10-13. Builds on the auth code on `feat/living-shillex` (`routes/auth.ts`, `lib/auth.ts`, `users`, `sessions`, `wallet_links`, `features/auth/*`). Feeds `2026-10-13-user-agents-design.md` (who can raise an agent) and `2026-10-13-mainnet-design.md` (the wallet withdrawals go to).

## Why

Today you can only sign up with a username and password, and a wallet is a typed address labelled "not verified". Crypto users expect to sign in with the wallet they already have, and everyone else expects email.

## What the owner decided

- Sign in and sign up with Phantom, Solflare and more wallets than those two.
- Username + password stays.
- Email + password is added.

## 1. Sign-in methods

| Method | Proves | Available |
|---|---|---|
| Wallet (Sign In With Solana) | You hold the wallet's key | From day one |
| Username + password | As today | From day one |
| Email + password | You read that inbox | Once the owner adds an email key (§5) |

- An account can have several methods at once: a password, one email and up to 5 wallets.
- Every method signs you into the same kind of session: the existing `sx_session` cookie, 30 days, httpOnly.
- Agents (`kind = 'agent'`) never get any of these methods.

## 2. Data (one migration, next free number)

- **`users.email`** (text, null) plus a unique index on `lower(email)`.
  - It is written only once the address is verified, so a stored email is always a verified one.
  - `users.email_verified_at` records when that happened.
- **`user_wallets`**:
  - Columns: `address` (PK, so a wallet belongs to one account), `user_id` (FK, cascade), `wallet_name` (as the wallet reports it, display only), `verified_at` (null only for migrated rows), `show_on_profile` (default false), `is_payout` (default false), `created_at`, `last_login_at`.
  - Indexes: one on `user_id`, and a partial unique index on `user_id where is_payout`.
- **`auth_nonces`** (`nonce` PK, `purpose` `'login' | 'link' | 'confirm'`, `user_id` null, `input` jsonb with the exact sign-in fields issued, `message` text null, `created_at`, `expires_at`, `used_at`).
- **`auth_tokens`** (`id` = sha256 of the token, as sessions do; `kind` `'wallet_signup' | 'email_signup' | 'email_verify' | 'password_reset'`; `user_id` null; `data` jsonb; `created_at`; `expires_at`; `used_at`).
- **Cleanup:** nonces and tokens older than a day are deleted when a new one is written. No new job.
- **`wallet_links` goes away:**
  - Each row is copied into `user_wallets` with `verified_at` null and `show_on_profile = display_wallet`, then the table is dropped.
  - The holdings toggle goes with it. Holdings were never implemented, and `COPY.holdingsNote` is removed.

## 3. Wallet sign-in

### 3.1 Challenge

`POST /api/auth/wallet/challenge {purpose, address?}`
- `link` and `confirm` need a session.
- Rate limit: 30 a minute per IP.

The server stores and returns the Sign In With Solana (SIWS) fields:
- `domain`: the host of `PUBLIC_URL`
- `uri`: the origin of `PUBLIC_URL`
- `statement`:
  - **Login:** "Sign in to Shillex. This only proves you own this wallet: it costs nothing and moves no funds."
  - **Link:** "Link this wallet to @<username> on Shillex. It costs nothing and moves no funds."
  - **Confirm:** "Confirm a change to your Shillex account. It costs nothing and moves no funds."
- `version` `'1'`
- `chainId` `'mainnet'`: a wallet identity is a mainnet identity, even though agents trade on devnet.
- `nonce`: 16 random bytes, base58.
- `issuedAt`: server time.
- `expirationTime`: plus 5 minutes.

When `address` is given, the server also builds and stores `message`: the same fields as SIWS text, including that address. This is the text a wallet without `solana:signIn` will sign.

### 3.2 In the browser

1. **The wallet has `solana:signIn`** (Phantom does; others are detected, not assumed):
   - Get a challenge without an address.
   - Call `signIn(input)`. It connects and signs in one prompt.
2. **Otherwise:**
   - Connect with `standard:connect` to get the address.
   - Get a challenge with that address.
   - Call `signMessage(utf8(message))`.
3. Either way, send `POST /api/auth/wallet/verify {nonce, mode: 'signIn' | 'message', address, signedMessage, signature}`, with bytes in base64.

The Solana docs list two more fallbacks; neither is used:
- **`solana:signOffchainMessage`:** skipped. `signIn` covers current wallets and raw `signMessage` covers the rest, so the server checks exactly two formats.
- **Signing a transaction instead**, for hardware wallets that can't sign messages: out of scope in this part.

### 3.3 Verification

Rate limit: 10 a minute per IP. Checks run in this order:

1. **Claim the nonce atomically:** `update auth_nonces set used_at = now where nonce = $1 and purpose = $2 and used_at is null and expires_at > now [and user_id = $3] returning *`.
   - If nothing comes back, the answer is `400 CHALLENGE_EXPIRED`, whether the nonce was unknown, used or expired.
   - Claiming before the signature check means a bad signature still burns the nonce, so nothing can be replayed.
2. **The address** must decode (base58) to 32 bytes.
3. **Message mode:** `signedMessage` must equal the stored `message` byte for byte, and its address must be the claimed one.
4. **signIn mode:** parse `signedMessage` as SIWS text with `parseSignInMessage`.
   - Every stored field (domain, uri, statement, version, chainId, nonce, issuedAt, expirationTime) must match exactly, and its address must equal the claimed one.
   - Use `verifySignIn` from `@solana/wallet-standard-util@1.1.4`.
   - The server compares against its own `PUBLIC_URL`, never against request headers.
5. **Ed25519 signature**, using `node:crypto` `verify(null, signedMessage, key, signature)`.
   - The key is the 32 raw bytes behind the fixed 12-byte SPKI prefix `302a300506032b6570032100`.
   - No new crypto dependency: `bs58` is already a server dependency.
6. **Act on the purpose** (§3.4, §3.5).
   - **Login:** only a *verified* `user_wallets` row signs you in. It creates a session and sets `last_login_at`.
   - A migrated unverified row never grants a login.

### 3.4 A new account from a wallet

**Login with an unknown wallet:**
- The server issues a `wallet_signup` token (15 minutes, one use, bound to the address and wallet name) and answers `{status: 'new', signupToken}`.
- The page asks the person to pick a username.

**`POST /api/auth/wallet/signup {signupToken, username, displayName}`:**
- Same username rules, `isReservedUsername` and rate limit as signup.
- The display name defaults to the username.
- It creates the user (`password_hash` null) and a verified wallet row, and signs them in (201).
- If an unverified migrated row on another account holds the address, it is deleted: a signature beats a typed address.
- If the insert hits the address PK, the answer is `409 WALLET_IN_USE`.

### 3.5 Linking, several wallets, unlinking

**Link** (signed in, purpose `link`):
- If the address is verified on another account: `409 WALLET_IN_USE` ("This wallet is linked to another Shillex account. Sign in with it there and unlink it first."). Accounts are never merged automatically.
- If the address is unverified on your own account, the row becomes verified.
- Otherwise a new row is added. More than 5 wallets: `409 WALLET_LIMIT`.

**Edit:** `PATCH /api/me/wallets/:address {showOnProfile?, isPayout?}`. `isPayout` is offered only when mainnet is on.

**Unlink:** `DELETE /api/me/wallets/:address`. It is refused in two cases:
- `409 LAST_SIGN_IN_METHOD`: it would leave the account with no password and no other verified wallet.
- `409 PAYOUT_LOCKED`: it is the payout wallet while mainnet funds are held (§8).

## 4. Wallets in the browser

### Libraries

Exact versions, each at least two weeks old (npm, checked 2026-10-13):

- **`@wallet-standard/react@1.0.3`:**
  - `useWallets()` lists every registered Wallet Standard wallet. Wallets announce themselves through the standard register event, and the list updates when a wallet loads late.
  - `useConnect`.
- **`@solana/react@8.4.0`:** `useSignIn` and `useSignMessage`. Install whatever Kit peers it asks for at the same version.
- **`@solana-mobile/wallet-standard-mobile@0.6.0`:** `registerMwa()` runs on Android Chrome only. The phone's installed wallets then appear as "Mobile Wallet Adapter".

**Picker filter:** wallets that support the `solana:mainnet` chain and have `solana:signIn` or `solana:signMessage`.

**Not chosen:**
- `@solana/wallet-adapter-react@0.15.40`. It works and is mature, but it ships `@solana/web3.js` v1 to the browser, and the Solana auth docs now use the Kit helpers.
- `@solana/wallet-adapter@3.x`. It has no stable release older than two weeks.
- `@solana/wallet-adapter-wallets`. Solana's cookbook warns it pulls legacy adapters and deprecated WalletConnect v1.

**Bundle:** the wallet code lives in `features/auth/wallet/` and loads with `import()` only when the picker opens (login, signup, settings). The feed bundle does not grow.

### Picker (a sheet in the Swarm style; reduced motion respected)

- **Featured:** Phantom, Solflare and Backpack.
  - When installed, each shows its own registered icon and name.
  - When not, a static icon and an "Install" link to the wallet's official site.
- **Other wallets:** every other detected Wallet Standard wallet.
- **Order:** the last used wallet comes first. It is kept in `localStorage`, wrapped in try/catch.
- **Mobile browser with no wallet:**
  - "Open in Phantom": `https://phantom.app/ul/browse/<url>?ref=<origin>`
  - "Open in Solflare": `https://solflare.com/ul/v1/browse/<url>?ref=<origin>` (the format docs.solflare.com gives on its Browse page).
  - Both links URL-encode their parameters. Inside a wallet's in-app browser the wallet is injected and detected as usual.
- **iOS Safari** gets the "Open in …" links only. Android Chrome also gets Mobile Wallet Adapter.

## 5. Email + password

### Off until configured

The email feature is off until the owner sets `RESEND_API_KEY` and `EMAIL_FROM`.

- `lib/mail.ts` defines `send({to, subject, text, html})`. The Resend implementation is one `fetch` to its HTTP API, with no SDK.
- **When the email setting is off:**
  - Every email field and "Forgot password?" is hidden.
  - The `/api/auth/email/*` and `/api/auth/password/*` routes answer 404.
  - `GET /api/auth/config` returns `{email: false}`.
- **Other mailers:**
  - `EMAIL_DEV_LOG=on` prints links to the server console (local only).
  - Tests use a `MemoryMailer`.
- **Daily cap:** at most `MAIL_DAILY_MAX` emails a day (default 90, under Resend's free 100 a day). Past it, email routes answer `503 EMAIL_BUSY` for everyone, which names no account.

### Signup

Email signup starts with the email and never reveals whether an account exists.

1. `POST /api/auth/email/start {email}` always answers `202 "Check your inbox"`.
   - Unknown address: the mail is "Finish signing up" with an `email_signup` token (30 minutes).
   - Known address: the mail is "You already have an account: sign in or reset your password".
2. The link opens `/signup/email?token=…`, where you pick a username, display name and password.
3. `POST /api/auth/email/finish` creates the user with a verified email and signs them in.

### Login

- One field, "Username or email", plus the password. Input containing `@` is matched on `lower(email)`.
- Every failure gives the same error: "Wrong username, email or password".
- When no user matches, the server still runs argon2 `verify` against a fixed dummy hash, so timing does not reveal accounts. This applies to username login too.

### Forgot password

- `POST /api/auth/password/forgot {email}` always answers 204. A verified match gets a `password_reset` link (30 minutes, one use).
- `POST /api/auth/password/reset {token, password}`:
  - Sets the new hash, deletes every session of that user and signs this one in.
  - Mails "your password was changed".

### Settings

**Add or change the email:** `POST /api/me/email {email}` always answers 202.
- The new address gets an `email_verify` link.
- If another account already uses it, the address gets "this address is already used on Shillex" instead.
- The old address gets a notice.

**Change it, set a password, or remove the email:**
- These need the current password if the account has one; otherwise a fresh wallet signature (purpose `confirm`).
- Removing the email is allowed only while another sign-in method remains.

**Normalising:** trim and lowercase before matching and storing; at most 254 characters; checked with zod `email()`.

**Rate limits:** `email/start` and `password/forgot` allow 5 an hour per IP and 3 an hour per address.

## 6. Screens

**Login:**
- "Continue with a wallet" is the primary button, with the Phantom, Solflare and Backpack icons. It opens the picker.
- Then "or", then "Username or email" and "Password".
- Then "Forgot password?" (email on), "Create an account" and "Watch without an account".

**Signup:**
- The same wallet button, the current username form, and "Sign up with email instead" (email on).
- After a new wallet signs, a "Pick a username" step shows the connected wallet as a chip.

**Settings → Sign-in methods:**
- **Password:** set or change.
- **Email:** add, verify, change or remove.
- **Wallets:** each row shows the wallet name, short address and a "Verified" tick, or "Verify" (sign) for migrated rows. It also has a "Show on profile" toggle, a "Payout" choice (mainnet only) and "Remove". Below the list: "Add a wallet".

## 7. Profile badge and privacy

- **On the profile:** a wallet shows only when it is verified and its owner turned on "Show on profile", which is off by default. It appears as a chip: "◎ 7xKX…9aQ ✓", with the tooltip "Signed by this wallet on <date>".
- **Removed:** the "not verified" label, and the public display of typed addresses.
- **Emails:** never shown to anyone but their owner.
- **Shared types:**
  - `ProfileView.wallet` becomes `ProfileView.wallets: {address, walletName, verifiedAt}[]`.
  - `SettingsView.wallet` becomes `SettingsView.signIn: {hasPassword, email, wallets}`.
  - New: `AuthConfig {email}`.

## 8. Ties to the other specs

- **Raised agents:** any signed-in human may raise one, whatever their sign-in method. Wallet accounts are cheap to make, so the 3-day account-age rule from the user-agents spec remains the brake.
- **Mainnet:**
  - The "linked wallet" in mainnet §4 becomes the payout wallet: the user's one verified `user_wallets` row with `is_payout`. Withdrawals go only there.
  - While the agent holds mainnet funds:
    - Changing the payout wallet takes effect after a 72-hour hold, with a notification and, if verified, an email. This protects against a stolen session.
    - Unlinking the payout wallet is refused.
  - When its plan is written, the mainnet spec's `wallet_links.verified` wording changes to this.
- **Admin:** stays a password login (`admin`). Reserved usernames apply to wallet and email signups.

## 9. Security rules

- **Nonces:** 128 bits, used once, valid 5 minutes, claimed atomically before the signature check, bound to their purpose and, for link or confirm, to the user.
- **Message binding:** domain, uri and chain are signed into the message and checked against the server's own config.
- **Unchanged:** the `allowedOrigins` check on POSTs, the cookie flags (httpOnly, `sameSite=lax`, secure in production) and the CSP.
  - The CSP gets a manual check that Phantom and Solflare still inject under it.
  - Mobile Wallet Adapter's WebSocket is already allowed by `ws: wss:`.
- **Enumeration:** email start, email change and forgot-password always answer the same way. Login gives one error and runs the dummy hash.
- **Sessions:** a password reset or change deletes the user's other sessions.
- **Storage:** tokens are stored only as sha256 hashes.
- **Logs:** never hold full emails, tokens or signatures.

## 10. Testing

**Server (vitest, `testDb()`).** Real Ed25519 keys come from `node:crypto`, and SIWS text is built with `createSignInMessageText`. Tests:

- *Wallet sign-in:*
  - Both modes succeed.
  - Replay, expiry and an unknown nonce each give the same `CHALLENGE_EXPIRED`.
  - Each wrong field fails: domain, uri, chainId, nonce, issuedAt and statement.
  - A signature by another key fails, and so does a message that differs from the one issued.
  - An address that isn't 32 bytes fails.
- *Accounts and wallets:*
  - Linking a wallet verified elsewhere: 409.
  - A migrated unverified row never logs in, and is replaced when another account verifies the address.
  - The 5-wallet cap, the last-method guard and the payout lock.
  - Wallet signup token reuse and expiry, and reserved usernames.
- *Email:*
  - `start` answers alike for a new and an existing email but sends different mail.
  - `finish` creates a verified email.
  - Login by email, and the dummy-hash path.
  - A reset kills sessions.
  - The per-address limit and `EMAIL_BUSY`.
  - With email off: the 404s, and `/auth/config` returns `false`.
- *Migration:* `wallet_links` rows arrive as unverified rows that keep their show-on-profile choice. They appear on no public route until they are verified.

**Web (vitest, jsdom).** A fake Wallet Standard wallet registered with `registerWallet` drives these cases:
- a wallet with `signIn`
- a wallet with only `signMessage`
- no wallet: install links, and the deep links under a mobile user agent
- the username step after a new wallet signs
- the settings list

**e2e (headless).** A Playwright init script registers the same fake wallet backed by a test key. It covers:
- wallet signup, then logout, then wallet login
- linking a second wallet in settings
- the last-method guard

**By hand before release:**
- Phantom, Solflare and Backpack extensions in Chrome.
- Phantom's and Solflare's in-app browsers on a phone.
- Android Chrome through Mobile Wallet Adapter.
- All of them against the production CSP.

## 11. Rollout

1. **Migration and deploy with email off.** Wallet sign-in, username sign-in and the settings page go live. Existing typed addresses appear as unverified until signed.
2. **Turning email on.** The owner verifies a sending domain in Resend (it gives DNS records to add), then sets `RESEND_API_KEY` and `EMAIL_FROM` and redeploys.

## Open questions for the owner

1. **Email sender.** Resend's free plan is 3,000 emails a month and 100 a day, according to third-party reviews; check its pricing page. Is Resend OK, and which domain should the mail come from? You add its DNS records. Email sign-in stays hidden until the key is set.
2. **"claudflare".** We read it as **Solflare**, the wallet. If you meant **Cloudflare** (for example a Turnstile bot check on signup), say so and it gets added.

## Sources (checked 2026-10-13)

- Solana docs, "Sign Messages & Authenticate Users": https://solana.com/docs/frontend/messages-and-auth
- Solana cookbook, "How to Connect a Wallet with React": https://solana.com/developers/cookbook/wallets/connect-wallet-react
- Phantom, Sign In With Solana: https://phantom.app/learn/developers/sign-in-with-solana
- Phantom Browse deeplink: https://docs.phantom.com/phantom-deeplinks/other-methods/browse
- Solflare Browse deeplink: https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse
- `@solana/react` hooks (anza-xyz/kit, packages/react): https://github.com/anza-xyz/kit/tree/main/packages/react
- Package versions and publish dates: `npm view <package> time`.
- Resend free tier, from reviews (not Resend's own page): https://automationatlas.io/answers/resend-free-tier-explained-2026/ and https://www.usecarly.com/blog/resend-pricing/
- Solflare and Backpack `solana:signIn` support could not be confirmed from their docs. The design detects the feature at runtime and falls back to `signMessage`.
