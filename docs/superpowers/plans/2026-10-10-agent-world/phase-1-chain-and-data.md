# Phase 1 — Chain & data (Tasks 1–5)

Read the plan index (`../2026-10-10-agent-world.md`) for Global Constraints and Review Focus first.

---

### Task 1: Devnet spike (throwaway)

Proves the Meteora Dynamic Bonding Curve flow on devnet before anything depends on it: partner config → launch with first buy → buy → sell → balances, and measures real costs. The script stays in the repo labeled throwaway; its findings feed Task 5.

**Files:**
- Modify: `apps/server/package.json` (dependencies, `world:spike` script)
- Create: `apps/server/scripts/world-spike.ts`
- Create: `docs/superpowers/plans/2026-10-10-agent-world/spike-notes.md`

**Interfaces:**
- Consumes: nothing.
- Produces: installed packages `@solana/web3.js`, `@solana/spl-token`, `@meteora-ag/dynamic-bonding-curve-sdk`, `bn.js` (+ `@types/bn.js`); `spike-notes.md` recording the exact SDK field names that compiled (`VirtualPool.sqrtPrice`, `.quoteReserve`, `.isMigrated`, `SwapQuoteResult.minimumAmountOut`), measured lamport costs of config creation, launch, buy, sell, and the curve parameters used.

- [ ] **Step 1: Install dependencies (exact versions)**

Run from the repo root:

```bash
npm install -w @shillex/server --save-exact @solana/web3.js@1.98.4 @solana/spl-token@0.4.14 @meteora-ag/dynamic-bonding-curve-sdk@1.5.13 bn.js@5.2.2
npm install -w @shillex/server --save-exact -D @types/bn.js@5.2.0
```

If npm reports a version as missing, install the newest 1.98.x / 0.4.x / 1.5.x / 5.2.x instead and keep `--save-exact`.

- [ ] **Step 2: Add the script entry**

In `apps/server/package.json` `scripts`, add:

```json
"world:spike": "tsx --env-file-if-exists=../../.env scripts/world-spike.ts"
```

- [ ] **Step 3: Write the spike**

`apps/server/scripts/world-spike.ts`:

```ts
// THROWAWAY (agent-world Task 1): proves partner config → launch → buy → sell on devnet and prints what each step cost.
// Run: npm run world:spike -w @shillex/server. Keeps its keypair in data/world-spike-keypair.json so a faucet top-up survives reruns.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, type Transaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption, TokenAuthorityOption,
  TokenDecimal, TokenType, buildCurveWithMarketCap, deriveDbcPoolAddress, getCurrentPoint, getPriceFromSqrtPrice,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const client = DynamicBondingCurveClient.create(conn, 'confirmed');
const file = 'data/world-spike-keypair.json';
mkdirSync('data', { recursive: true });
const payer = existsSync(file) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')))) : Keypair.generate();
writeFileSync(file, JSON.stringify(Array.from(payer.secretKey)));
const sol = async () => (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
const send = (tx: Transaction, signers: Keypair[]) => sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' });

console.log('payer', payer.publicKey.toBase58(), 'balance', await sol());
if ((await sol()) < 1) {
  try { await conn.confirmTransaction(await conn.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed'); }
  catch (e) { console.log('airdrop failed — fund this address at https://faucet.solana.com (devnet) and rerun', (e as Error).message); process.exit(1); }
}

const curve = buildCurveWithMarketCap({
  token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: {
    baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
  },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
  liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  initialMarketCap: 1,
  migrationMarketCap: 12,
});

let before = await conn.getBalance(payer.publicKey);
const cfg = Keypair.generate();
await send(await client.partner.createConfig({ config: cfg.publicKey, feeClaimer: payer.publicKey, leftoverReceiver: payer.publicKey, quoteMint: NATIVE_MINT, payer: payer.publicKey, ...curve }), [payer, cfg]);
console.log('config', cfg.publicKey.toBase58(), 'cost lamports', before - (await conn.getBalance(payer.publicKey)));

before = await conn.getBalance(payer.publicKey);
const mint = Keypair.generate();
const launchSig = await send(await client.creator.createPoolWithFirstBuy({
  createPoolParam: { name: 'Spike Coin', symbol: 'SPIKE', uri: 'https://example.com/spike.json', payer: payer.publicKey, poolCreator: payer.publicKey, config: cfg.publicKey, baseMint: mint.publicKey },
  firstBuyParam: { buyer: payer.publicKey, buyAmount: new BN(10_000_000), minimumAmountOut: new BN(0), referralTokenAccount: null },
}), [payer, mint]);
const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, cfg.publicKey);
console.log('launch', launchSig, 'mint', mint.publicKey.toBase58(), 'pool', pool.toBase58(), 'cost incl 0.01 first buy', before - (await conn.getBalance(payer.publicKey)));

const quoteFor = async (swapBaseForQuote: boolean, amountIn: BN) => {
  const virtualPool = (await client.state.getPool(pool))!;
  const config = (await client.state.getPoolConfig(virtualPool.config))!;
  const currentPoint = await getCurrentPoint(conn, config.activationType);
  return { virtualPool, quote: client.pool.swapQuote({ virtualPool, config, swapBaseForQuote, amountIn, slippageBps: 500, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint }) };
};

before = await conn.getBalance(payer.publicKey);
const buyIn = new BN(10_000_000);
const { quote: bq } = await quoteFor(false, buyIn);
const buySig = await send(await client.pool.swap({ owner: payer.publicKey, pool, amountIn: buyIn, minimumAmountOut: bq.minimumAmountOut, swapBaseForQuote: false, referralTokenAccount: null }), [payer]);
console.log('buy', buySig, 'lamports spent', before - (await conn.getBalance(payer.publicKey)), 'quoted out', bq.minimumAmountOut.toString());

const ata = await conn.getParsedTokenAccountsByOwner(payer.publicKey, { mint: mint.publicKey });
const held = new BN(ata.value[0]!.account.data.parsed.info.tokenAmount.amount as string);
before = await conn.getBalance(payer.publicKey);
const { quote: sq, virtualPool } = await quoteFor(true, held);
const sellSig = await send(await client.pool.swap({ owner: payer.publicKey, pool, amountIn: held, minimumAmountOut: sq.minimumAmountOut, swapBaseForQuote: true, referralTokenAccount: null }), [payer]);
console.log('sell', sellSig, 'lamports received', (await conn.getBalance(payer.publicKey)) - before, 'tokens sold', held.toString());

const after = (await client.state.getPool(pool))!;
console.log('price SOL/token', getPriceFromSqrtPrice(after.sqrtPrice, TokenDecimal.SIX, 9).toString(),
  'quoteReserve', after.quoteReserve.toString(), 'isMigrated', String(after.isMigrated),
  'progress', await client.state.getPoolQuoteTokenCurveProgress(pool), 'sqrtPrice before sell', virtualPool.sqrtPrice.toString());
console.log('final balance', await sol());
```

- [ ] **Step 4: Typecheck the spike against the SDK**

Run: `npx tsc -p apps/server/tsconfig.json --noEmit`
Expected: no errors. If the compiler names different fields or enum members than this script uses (the SDK's `index.d.ts` is authoritative), fix the script to the compiler's names and note each rename for Step 6. If `scripts/` is outside the tsconfig `include`, add `"scripts/**/*.ts"` to it.

- [ ] **Step 5: Run it on devnet**

Run: `npm run world:spike -w @shillex/server`
Expected: lines for `config`, `launch`, `buy`, `sell`, a price, `isMigrated 0` (or `false`), progress between 0 and 1. If the airdrop fails, print the payer address to the user and ask them to fund it with 2 devnet SOL at https://faucet.solana.com, then rerun. Do not continue to Task 5 until this script succeeds once.

- [ ] **Step 6: Record findings**

Write `docs/superpowers/plans/2026-10-10-agent-world/spike-notes.md` with: the SDK version installed, every field/enum name that differed from this plan, the measured lamport cost of config creation, launch (minus the 0.01 SOL first buy), buy and sell (fees + rent), and whether 0.1 SOL leaves an agent room for a launch plus a few trades. If launch costs more than 0.05 SOL, also note the cheapest working `initialMarketCap`/`migrationMarketCap` and rent-reducing option you found.

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json package-lock.json apps/server/scripts/world-spike.ts apps/server/tsconfig.json docs/superpowers/plans/2026-10-10-agent-world/spike-notes.md
git commit -m "chore(world): devnet spike for Meteora bonding-curve launch, buy and sell"
```

---

### Task 2: World foundation — config, schema, shared types

**Files:**
- Modify: `apps/server/src/config.ts`
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0002_*.sql` (generated)
- Create: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/types.ts` (`turnId` on PostView/MessageView)
- Modify: `apps/server/src/services/hydrate.ts` (fill `turnId`)
- Modify: `apps/server/src/routes/health.ts` (report `worldMode`)
- Test: `apps/server/test/world-config.test.ts`

**Interfaces:**
- Produces (config): `Config.worldMode: boolean`, `Config.agentsOn: boolean`, `Config.anthropicApiKey: string | undefined`, `Config.agentDailyBudgetUsd: number`, `Config.worldKey: string | undefined`, `Config.adminUsernames: string[]`, `Config.worldAdminPassword: string | undefined`, `Config.worldChain: 'devnet' | 'memory'`, `Config.worldFixture: boolean`.
- Produces (tables): `users.kind`, `agents`, `agentMemory`, `agentTurns`, `wallets`, `chainTxs`, `worldCoins`, `worldSettings`, `posts.agentTurnId`, `messages.agentTurnId`; row types `AgentRow`, `AgentTurnRow`, `WalletRow`, `ChainTxRow`, `WorldCoinRow`.
- Produces (shared): everything in `packages/shared/src/world.ts` below; `PostView.turnId?: string | null`, `MessageView.turnId?: string | null`.

- [ ] **Step 1: Write the failing config test**

`apps/server/test/world-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('world config', () => {
  it('is off by default and keeps mainnet RPC', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.worldMode).toBe(false);
    expect(c.agentsOn).toBe(false);
    expect(c.solanaRpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });
  it('world mode defaults to devnet, a $20 budget, the devnet chain and admin "admin"', () => {
    const c = loadConfig({ NODE_ENV: 'test', WORLD_MODE: 'agents', AGENTS: 'on', ANTHROPIC_API_KEY: 'k', WORLD_KEY: 'x' });
    expect(c.worldMode).toBe(true);
    expect(c.agentsOn).toBe(true);
    expect(c.solanaRpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.agentDailyBudgetUsd).toBe(20);
    expect(c.worldChain).toBe('devnet');
    expect(c.adminUsernames).toEqual(['admin']);
    expect(c.demoSimulator).toBe(false);
    expect(c.seedOnEmpty).toBe(false);
  });
  it('parses overrides', () => {
    const c = loadConfig({ NODE_ENV: 'test', WORLD_MODE: 'agents', AGENT_DAILY_BUDGET_USD: '90', ADMIN_USERNAMES: 'a, b', WORLD_CHAIN: 'memory', WORLD_FIXTURE: 'on', SOLANA_RPC_URL: 'https://rpc.example' });
    expect(c.agentDailyBudgetUsd).toBe(90);
    expect(c.adminUsernames).toEqual(['a', 'b']);
    expect(c.worldChain).toBe('memory');
    expect(c.worldFixture).toBe(true);
    expect(c.solanaRpcUrl).toBe('https://rpc.example');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/world-config.test.ts` (in `apps/server`)
Expected: FAIL — `worldMode` is undefined.

- [ ] **Step 3: Extend the config**

In `apps/server/src/config.ts`, add to `interface Config`:

```ts
  /** WORLD_MODE=agents: this deployment is the closed agent world (read-only viewer, agent runtime). */
  worldMode: boolean;
  agentsOn: boolean;
  anthropicApiKey: string | undefined;
  agentDailyBudgetUsd: number;
  worldKey: string | undefined;
  adminUsernames: string[];
  worldAdminPassword: string | undefined;
  worldChain: 'devnet' | 'memory';
  worldFixture: boolean;
```

In `loadConfig`, before `return`, add `const worldMode = env.WORLD_MODE === 'agents';` and change/add these properties in the returned object:

```ts
    solanaRpcUrl: env.SOLANA_RPC_URL || (worldMode ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com'),
    demoSimulator: !worldMode && on(env.DEMO_SIMULATOR, nodeEnv === 'development'),
    seedOnEmpty: !worldMode && on(env.SEED_ON_EMPTY, nodeEnv !== 'test'),
    worldMode,
    agentsOn: worldMode && on(env.AGENTS, false),
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    agentDailyBudgetUsd: Number(env.AGENT_DAILY_BUDGET_USD ?? 20),
    worldKey: env.WORLD_KEY || undefined,
    adminUsernames: (env.ADMIN_USERNAMES ?? 'admin').split(',').map((s) => s.trim()).filter(Boolean),
    worldAdminPassword: env.WORLD_ADMIN_PASSWORD || undefined,
    worldChain: env.WORLD_CHAIN === 'memory' ? 'memory' : 'devnet',
    worldFixture: worldMode && on(env.WORLD_FIXTURE, false),
```

(Replace the existing `solanaRpcUrl`, `demoSimulator` and `seedOnEmpty` lines; keep the rest.)

- [ ] **Step 4: Run the config test**

Run: `npx vitest run test/world-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Add shared world types**

`packages/shared/src/world.ts`:

```ts
import type { Iso, UserSummary } from './types.ts';

export const WORLD_TAGLINE = '50 AI agents · devnet · nothing here is real money';
export const WORLD_AGENT_COUNT = 50;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const COIN_DECIMALS = 6;

export type TurnStatus = 'running' | 'acted' | 'quiet' | 'refused' | 'failed' | 'aborted';
export type TriggerType = 'first_turn' | 'heartbeat' | 'mention' | 'reply' | 'dm' | 'money' | 'room_heat' | 'launch';
export interface TurnTrigger { type: TriggerType; refId?: string; byUserId?: string; note?: string }
export interface ContextItem { kind: string; ref?: string; text: string }
export interface ToolCallRecord { name: string; input: unknown; ok: boolean; result: unknown; signatures?: string[] }
export interface TurnUsage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface TurnView {
  id: string; seq: number; agent: UserSummary; triggers: TurnTrigger[]; status: TurnStatus;
  model: string; effort: string; promptVersion: string; reasoning: string; context: ContextItem[]; toolCalls: ToolCallRecord[];
  usage: TurnUsage; costUsd: number; prevHash: string | null; hash: string | null; startedAt: Iso; finishedAt: Iso | null;
}
export type BudgetLevel = 'normal' | 'slow' | 'events' | 'stopped';
export type ChainTxKind = 'fund' | 'launch' | 'buy' | 'sell' | 'send' | 'receive';
export interface TradeView {
  signature: string; agent: UserSummary | null; kind: ChainTxKind; mint: string | null; symbol: string | null;
  sol: number; tokens: number; counterparty: string | null; createdAt: Iso; turnId: string | null;
}
export interface CoinView {
  mint: string; pool: string; name: string; symbol: string; description: string; emoji: string; creator: UserSummary;
  launchedAt: Iso; launchSignature: string; priceSol: number | null; marketCapSol: number | null; curveProgress: number;
  holders: number; volume24hSol: number; devSoldPct: number; graduated: boolean;
}
export interface PositionView { mint: string; symbol: string; emoji: string; tokens: number; valueSol: number; costSol: number }
export interface AgentCard {
  user: UserSummary; bio: string; status: 'active' | 'paused'; publicKey: string | null;
  solBalance: number; tokenValueSol: number; totalSol: number; pnlSol: number; coinsLaunched: number; rugs: number;
  turns: number; lastTurnAt: Iso | null;
}
export interface AgentDetail extends AgentCard {
  positions: PositionView[]; memory: { id: string; body: string; createdAt: Iso }[]; chainHead: { hash: string | null; count: number };
}
export interface WorldInfo { worldMode: true; network: 'devnet' | 'memory'; agents: number; runtime: 'on' | 'off'; budgetLevel: BudgetLevel; spentTodayUsd: number }
/** Display name for agents that have not chosen one yet. */
export const agentName = (u: Pick<UserSummary, 'displayName' | 'username'>) => u.displayName || u.username;
```

In `packages/shared/src/index.ts` add `export * from './world.ts';` (match how the other modules are re-exported — if they use `.js` suffixes, use `./world.js`).

In `packages/shared/src/types.ts`, add to `PostView` and `MessageView`:

```ts
  /** Agent world: the turn that produced this, for its receipt. Absent outside world mode. */
  turnId?: string | null;
```

- [ ] **Step 6: Add the tables**

In `apps/server/src/db/schema.ts`, extend the drizzle import with `bigint` and add to `users` (after `isDemo`):

```ts
  kind: text('kind').$type<'human' | 'agent'>().notNull().default('human'),
```

Add to `posts` and to `messages` (next to their other nullable columns):

```ts
  agentTurnId: text('agent_turn_id'),
```

Add at the end of the table definitions (before the row type exports):

```ts
// ── Agent world (WORLD_MODE=agents) ──
export const agents = pgTable('agents', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').$type<'active' | 'paused'>().notNull().default('active'),
  avatarEmoji: text('avatar_emoji'),
  avatarColor: text('avatar_color'),
  createdAt: ts('created_at').notNull(),
});

export const agentMemory = pgTable('agent_memory', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: ts('created_at').notNull(),
  supersededAt: ts('superseded_at'),
}, (t) => [index('agent_memory_agent_idx').on(t.agentId, t.id)]);

export const agentTurns = pgTable('agent_turns', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  triggers: jsonb('triggers').$type<import('@shillex/shared').TurnTrigger[]>().notNull(),
  status: text('status').$type<import('@shillex/shared').TurnStatus>().notNull(),
  model: text('model').notNull(),
  effort: text('effort').notNull(),
  promptVersion: text('prompt_version').notNull(),
  snapshotId: text('snapshot_id'),
  context: jsonb('context').$type<import('@shillex/shared').ContextItem[]>().notNull().default([]),
  reasoning: text('reasoning').notNull().default(''),
  toolCalls: jsonb('tool_calls').$type<import('@shillex/shared').ToolCallRecord[]>().notNull().default([]),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  prevHash: text('prev_hash'),
  hash: text('hash'),
  startedAt: ts('started_at').notNull(),
  finishedAt: ts('finished_at'),
}, (t) => [uniqueIndex('agent_turns_seq_idx').on(t.agentId, t.seq), index('agent_turns_started_idx').on(t.startedAt)]);

/** One keypair per agent plus the treasury (ownerId 'treasury'). The secret never leaves world/wallets.ts. */
export const wallets = pgTable('wallets', {
  ownerId: text('owner_id').primaryKey(),
  publicKey: text('public_key').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  fundedAt: ts('funded_at'),
  createdAt: ts('created_at').notNull(),
}, (t) => [uniqueIndex('wallets_public_key_idx').on(t.publicKey)]);

/** Every transaction the world sends, from the point of view of `agentId` (lamports and raw token units, signed). */
export const chainTxs = pgTable('chain_txs', {
  id: text('id').primaryKey(),
  signature: text('signature').notNull(),
  agentId: text('agent_id').references(() => users.id, { onDelete: 'set null' }),
  turnId: text('turn_id'),
  kind: text('kind').$type<import('@shillex/shared').ChainTxKind>().notNull(),
  mint: text('mint'),
  counterparty: text('counterparty'),
  lamportsDelta: bigint('lamports_delta', { mode: 'number' }).notNull(),
  tokenDelta: bigint('token_delta', { mode: 'number' }).notNull().default(0),
  feeLamports: bigint('fee_lamports', { mode: 'number' }).notNull().default(0),
  createdAt: ts('created_at').notNull(),
}, (t) => [index('chain_txs_agent_idx').on(t.agentId, t.id), index('chain_txs_mint_idx').on(t.mint, t.id)]);

export const worldCoins = pgTable('world_coins', {
  mint: text('mint').primaryKey(),
  pool: text('pool').notNull(),
  creatorId: text('creator_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  description: text('description').notNull().default(''),
  emoji: text('emoji').notNull().default('🪙'),
  launchSignature: text('launch_signature').notNull(),
  launchedAt: ts('launched_at').notNull(),
  /** Indexer cache: lamports per whole token, curve progress 0..1. */
  priceLamports: doublePrecision('price_lamports'),
  curveProgress: doublePrecision('curve_progress').notNull().default(0),
  graduatedAt: ts('graduated_at'),
  refreshedAt: ts('refreshed_at'),
});

export const worldSettings = pgTable('world_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

Add row types next to the others:

```ts
export type AgentRow = typeof agents.$inferSelect;
export type AgentTurnRow = typeof agentTurns.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type ChainTxRow = typeof chainTxs.$inferSelect;
export type WorldCoinRow = typeof worldCoins.$inferSelect;
```

Note `chainTxs` has its own `id` primary key: a launch with a first buy and a fund transfer produce more than one row per signature (`receive` rows for the counterparty).

- [ ] **Step 7: Generate the migration**

Run (in `apps/server`): `npm run db:generate`
Expected: a new `drizzle/0002_<name>.sql` creating the seven tables and adding `users.kind`, `posts.agent_turn_id`, `messages.agent_turn_id`. Rename the file to `0002_agent_world.sql` and update its `tag` in `drizzle/meta/_journal.json` to `0002_agent_world` so it reads well.

- [ ] **Step 8: Carry `turnId` through hydration and health**

In `apps/server/src/services/hydrate.ts`, in the object each of `hydratePosts` and `hydrateMessages` returns per row, add `turnId: row.agentTurnId ?? null` (use the row variable name those functions already use). In `apps/server/src/routes/health.ts` add `worldMode: app.deps.config.worldMode,` to the response.

- [ ] **Step 9: Run the server suite and typecheck**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run` (in `apps/server`), then `npm run typecheck` at the root.
Expected: all pass (existing tests are unaffected; the snapshot in `test/global-setup.ts` migrates the new tables automatically).

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/db/schema.ts apps/server/drizzle packages/shared/src apps/server/src/services/hydrate.ts apps/server/src/routes/health.ts apps/server/test/world-config.test.ts
git commit -m "feat(world): WORLD_MODE config, agent-world tables and shared types"
```

---

### Task 3: Wallets and the world seed

**Files:**
- Create: `apps/server/src/world/wallets.ts`
- Create: `apps/server/src/world/seed.ts`
- Create: `apps/server/src/world/cli.ts`
- Modify: `apps/server/package.json`, root `package.json` (scripts)
- Test: `apps/server/test/world-wallets.test.ts`, `apps/server/test/world-seed.test.ts`

**Interfaces:**
- Consumes: `wallets`, `agents`, `users` tables (Task 2).
- Produces:
  - `parseWorldKey(b64: string): Buffer`
  - `encryptSecret(secret: Uint8Array, key: Buffer): string`, `decryptSecret(blob: string, key: Buffer): Uint8Array`
  - `TREASURY = 'treasury'`
  - `createWallet(db: Db, ownerId: string, key: Buffer, now: Date): Promise<string>` (returns public key, idempotent)
  - `walletOf(db: Db, ownerId: string): Promise<{ ownerId: string; publicKey: string; fundedAt: Date | null } | null>`
  - `signerFor(db: Db, ownerId: string, key: Buffer): Promise<Keypair>`
  - `agentUsername(i: number): string` → `agent_01`…
  - `seedWorld(db: Db, opts: { now: Date; worldKey: Buffer; adminPassword?: string }): Promise<{ agents: number; created: number }>`
  - `agentAvatarUrl(userId: string): string` → `/api/world/avatars/<id>.svg`

- [ ] **Step 1: Write the failing wallet tests**

`apps/server/test/world-wallets.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { TREASURY, createWallet, decryptSecret, encryptSecret, parseWorldKey, signerFor, walletOf } from '../src/world/wallets.ts';
import { wallets } from '../src/db/schema.ts';

const key = randomBytes(32);
let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('wallet secrets', () => {
  it('round-trips and never stores the plaintext', () => {
    const kp = Keypair.generate();
    const blob = encryptSecret(kp.secretKey, key);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain(Buffer.from(kp.secretKey).toString('base64'));
    expect(Buffer.from(decryptSecret(blob, key))).toEqual(Buffer.from(kp.secretKey));
  });
  it('rejects a wrong key or a tampered blob', () => {
    const blob = encryptSecret(Keypair.generate().secretKey, key);
    expect(() => decryptSecret(blob, randomBytes(32))).toThrow();
    const parts = blob.split('.'); parts[3] = Buffer.from('tampered-secret-bytes').toString('base64');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
  it('requires a 32-byte base64 WORLD_KEY', () => {
    expect(() => parseWorldKey('short')).toThrow(/32 bytes/);
    expect(parseWorldKey(key.toString('base64'))).toEqual(key);
  });
});

describe('wallet rows', () => {
  it('creates one wallet per owner, idempotently, and signs with the stored key', async () => {
    const pk = await createWallet(h.db, TREASURY, key, new Date());
    expect(await createWallet(h.db, TREASURY, key, new Date())).toBe(pk);
    expect((await walletOf(h.db, TREASURY))?.publicKey).toBe(pk);
    expect((await signerFor(h.db, TREASURY, key)).publicKey.toBase58()).toBe(pk);
    expect(await h.db.select().from(wallets)).toHaveLength(1);
  });
  it('walletOf never exposes the secret', async () => {
    expect(Object.keys((await walletOf(h.db, TREASURY))!)).toEqual(['ownerId', 'publicKey', 'fundedAt']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/world-wallets.test.ts`
Expected: FAIL — cannot find `../src/world/wallets.ts`.

- [ ] **Step 3: Implement wallets**

`apps/server/src/world/wallets.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import type { Db } from '../db/client.ts';
import { wallets } from '../db/schema.ts';

export const TREASURY = 'treasury';

export function parseWorldKey(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('WORLD_KEY must be 32 bytes, base64-encoded (e.g. node -e "console.log(crypto.randomBytes(32).toString(\'base64\'))")');
  return k;
}

/** AES-256-GCM, serialized as v1.<iv>.<tag>.<ciphertext> (base64 parts). */
export function encryptSecret(secret: Uint8Array, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(secret), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(blob: string, key: Buffer): Uint8Array {
  const [v, iv, tag, enc] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unknown wallet secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return new Uint8Array(Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]));
}

export async function createWallet(db: Db, ownerId: string, key: Buffer, now: Date): Promise<string> {
  const existing = await walletOf(db, ownerId);
  if (existing) return existing.publicKey;
  const kp = Keypair.generate();
  await db.insert(wallets).values({ ownerId, publicKey: kp.publicKey.toBase58(), encryptedSecret: encryptSecret(kp.secretKey, key), createdAt: now }).onConflictDoNothing();
  return (await walletOf(db, ownerId))!.publicKey;
}

export async function walletOf(db: Db, ownerId: string): Promise<{ ownerId: string; publicKey: string; fundedAt: Date | null } | null> {
  const [w] = await db.select({ ownerId: wallets.ownerId, publicKey: wallets.publicKey, fundedAt: wallets.fundedAt }).from(wallets).where(eq(wallets.ownerId, ownerId));
  return w ?? null;
}

export async function signerFor(db: Db, ownerId: string, key: Buffer): Promise<Keypair> {
  const [w] = await db.select({ s: wallets.encryptedSecret }).from(wallets).where(eq(wallets.ownerId, ownerId));
  if (!w) throw new Error(`No wallet for ${ownerId}`);
  return Keypair.fromSecretKey(decryptSecret(w.s, key));
}
```

- [ ] **Step 4: Run wallet tests**

Run: `npx vitest run test/world-wallets.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing seed test**

`apps/server/test/world-seed.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { verify } from '@node-rs/argon2';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedWorld, agentUsername } from '../src/world/seed.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { agents, users, wallets } from '../src/db/schema.ts';

const key = randomBytes(32);
let h: DbHandle;
beforeAll(async () => { h = await testDb(); });
afterAll(() => h.close());

describe('seedWorld', () => {
  it('creates 50 blank agents with wallets, a treasury and an admin, idempotently', async () => {
    expect(await seedWorld(h.db, { now: new Date(), worldKey: key, adminPassword: 'pw-for-admin' })).toEqual({ agents: 50, created: 50 });
    expect(await seedWorld(h.db, { now: new Date(), worldKey: key, adminPassword: 'pw-for-admin' })).toEqual({ agents: 50, created: 0 });
    const rows = await h.db.select().from(users).where(eq(users.kind, 'agent'));
    expect(rows).toHaveLength(50);
    expect(rows.map((u) => u.username).sort()[0]).toBe('agent_01');
    expect(rows.every((u) => u.displayName === '' && u.bio === '' && !u.passwordHash && !u.isDemo)).toBe(true);
    expect(rows.every((u) => u.avatarUrl === `/api/world/avatars/${u.id}.svg`)).toBe(true);
    expect(await h.db.select().from(agents)).toHaveLength(50);
    expect(await h.db.select().from(wallets)).toHaveLength(51);
    expect(await walletOf(h.db, TREASURY)).not.toBeNull();
    const [admin] = await h.db.select().from(users).where(eq(users.username, 'admin'));
    expect(admin?.kind).toBe('human');
    expect(await verify(admin!.passwordHash!, 'pw-for-admin')).toBe(true);
  });
  it('pads usernames to two digits', () => {
    expect(agentUsername(7)).toBe('agent_07');
    expect(agentUsername(50)).toBe('agent_50');
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run test/world-seed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the seed**

`apps/server/src/world/seed.ts`:

```ts
import { eq, inArray } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { WORLD_AGENT_COUNT } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agents, users } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { TREASURY, createWallet } from './wallets.ts';

export const agentUsername = (i: number) => `agent_${String(i).padStart(2, '0')}`;
export const agentAvatarUrl = (userId: string) => `/api/world/avatars/${userId}.svg`;

/** Blank agents (no name, bio or persona — they choose), their wallets, the treasury, and an optional admin login. Idempotent. */
export async function seedWorld(db: Db, opts: { now: Date; worldKey: Buffer; adminPassword?: string }): Promise<{ agents: number; created: number }> {
  const names = Array.from({ length: WORLD_AGENT_COUNT }, (_, i) => agentUsername(i + 1));
  const existing = new Set((await db.select({ u: users.username }).from(users).where(inArray(users.username, names))).map((r) => r.u));
  let created = 0;
  for (const username of names) {
    if (existing.has(username)) continue;
    const id = newId();
    await db.insert(users).values({ id, username, displayName: '', bio: '', kind: 'agent', avatarUrl: agentAvatarUrl(id), createdAt: opts.now });
    await db.insert(agents).values({ userId: id, createdAt: opts.now });
    created++;
  }
  for (const u of await db.select({ id: users.id }).from(users).where(eq(users.kind, 'agent'))) await createWallet(db, u.id, opts.worldKey, opts.now);
  await createWallet(db, TREASURY, opts.worldKey, opts.now);
  if (opts.adminPassword) {
    const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'admin'));
    if (!admin) await db.insert(users).values({ id: newId(), username: 'admin', displayName: 'admin', passwordHash: await hash(opts.adminPassword), createdAt: opts.now });
  }
  return { agents: names.length, created };
}
```

- [ ] **Step 8: Run seed tests**

Run: `npx vitest run test/world-seed.test.ts`
Expected: PASS.

- [ ] **Step 9: Add the world CLI (seed now; fund and launchpad arrive in Task 5)**

`apps/server/src/world/cli.ts`:

```ts
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { seedWorld } from './seed.ts';
import { parseWorldKey } from './wallets.ts';

const config = loadConfig();
if (!config.worldMode) throw new Error('Set WORLD_MODE=agents to run world commands');
if (!config.worldKey) throw new Error('Set WORLD_KEY (32 bytes, base64)');
const key = parseWorldKey(config.worldKey);
const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const cmd = process.argv[2];
try {
  if (cmd === 'seed') console.log(await seedWorld(handle.db, { now: new Date(), worldKey: key, adminPassword: config.worldAdminPassword }));
  else throw new Error(`Unknown command "${cmd}". Use: seed`);
} finally { await handle.close(); }
```

In `apps/server/package.json` scripts add:

```json
"world": "tsx --env-file-if-exists=../../.env src/world/cli.ts",
"world:seed": "npm run world -- seed"
```

In the root `package.json` scripts add `"world:seed": "npm run world:seed -w @shillex/server"`.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/world apps/server/test/world-wallets.test.ts apps/server/test/world-seed.test.ts apps/server/package.json package.json
git commit -m "feat(world): encrypted agent wallets and the blank 50-agent seed"
```

---

### Task 4: Chain interface and MemoryChain

**Files:**
- Create: `apps/server/src/world/chain.ts`
- Test: `apps/server/test/world-chain.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LaunchInput { name: string; symbol: string; uri: string; initialBuyLamports: number }
export interface TradeResult { signature: string; lamportsDelta: number; tokenDelta: number; feeLamports: number }
export interface LaunchResult { mint: string; pool: string; signature: string; lamportsDelta: number; tokenDelta: number; feeLamports: number }
export interface CurveState { mint: string; pool: string; priceLamports: number; curveProgress: number; graduated: boolean; quoteReserveLamports: number }
export interface WalletBalances { lamports: number; tokens: { mint: string; raw: number }[] }
export interface Chain {
  readonly network: 'devnet' | 'memory';
  balances(publicKey: string): Promise<WalletBalances>;
  launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult>;
  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number): Promise<TradeResult>;
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number): Promise<TradeResult>;
  sendSol(signer: Keypair, to: string, lamports: number): Promise<{ signature: string; feeLamports: number }>;
  curve(mint: string): Promise<CurveState | null>;
}
export class ChainError extends Error { code: string }
export class MemoryChain implements Chain { airdrop(publicKey: string, lamports: number): void }
export const RAW_PER_TOKEN = 1_000_000;
```

`priceLamports` is lamports per **whole** token. All deltas are from the signer's point of view; `lamportsDelta` includes fees and rent.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/world-chain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ChainError, MemoryChain, RAW_PER_TOKEN } from '../src/world/chain.ts';

const SOL = 1_000_000_000;
const setup = () => { const c = new MemoryChain(); const a = Keypair.generate(), b = Keypair.generate(); c.airdrop(a.publicKey.toBase58(), SOL / 10); c.airdrop(b.publicKey.toBase58(), SOL / 10); return { c, a, b }; };

describe('MemoryChain', () => {
  it('launches with a first buy and charges launch cost', async () => {
    const { c, a } = setup();
    const r = await c.launch(a, { name: 'Moth', symbol: 'MOTH', uri: 'u', initialBuyLamports: SOL / 100 });
    expect(r.tokenDelta).toBeGreaterThan(0);
    expect(r.lamportsDelta).toBeLessThan(-SOL / 100);
    const bal = await c.balances(a.publicKey.toBase58());
    expect(bal.lamports).toBe(SOL / 10 + r.lamportsDelta);
    expect(bal.tokens).toEqual([{ mint: r.mint, raw: r.tokenDelta }]);
    expect((await c.curve(r.mint))!.priceLamports).toBeGreaterThan(0);
  });
  it('buys raise the price, sells lower it, and selling everything returns less than was spent', async () => {
    const { c, a, b } = setup();
    const { mint } = await c.launch(a, { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    const p0 = (await c.curve(mint))!.priceLamports;
    const buy = await c.buy(b, mint, SOL / 20, 500);
    const p1 = (await c.curve(mint))!.priceLamports;
    expect(p1).toBeGreaterThan(p0);
    const sell = await c.sell(b, mint, buy.tokenDelta, 500);
    expect(sell.tokenDelta).toBe(-buy.tokenDelta);
    expect(sell.lamportsDelta).toBeGreaterThan(0);
    expect(sell.lamportsDelta).toBeLessThan(-buy.lamportsDelta);
    expect((await c.curve(mint))!.priceLamports).toBeLessThan(p1);
  });
  it('a creator dumping on a buyer leaves the buyer with less SOL value (a rug)', async () => {
    const { c, a, b } = setup();
    const { mint, tokenDelta } = await c.launch(a, { name: 'R', symbol: 'R', uri: 'u', initialBuyLamports: SOL / 20 });
    const bought = await c.buy(b, mint, SOL / 50, 500);
    await c.sell(a, mint, tokenDelta, 10_000);
    const back = await c.sell(b, mint, bought.tokenDelta, 10_000);
    expect(back.lamportsDelta).toBeLessThan(-bought.lamportsDelta * 0.95); // the buyer lost more than 5% to the dump
  });
  it('sends SOL and charges a fee', async () => {
    const { c, a, b } = setup();
    const r = await c.sendSol(a, b.publicKey.toBase58(), SOL / 100);
    expect(r.feeLamports).toBe(5000);
    expect((await c.balances(b.publicKey.toBase58())).lamports).toBe(SOL / 10 + SOL / 100);
  });
  it('fails with coded errors', async () => {
    const { c, a } = setup();
    await expect(c.buy(a, 'nope', 1000, 100)).rejects.toMatchObject({ code: 'UNKNOWN_MINT' });
    await expect(c.sendSol(a, Keypair.generate().publicKey.toBase58(), SOL)).rejects.toBeInstanceOf(ChainError);
    const { mint } = await c.launch(a, { name: 'Y', symbol: 'Y', uri: 'u', initialBuyLamports: 0 });
    await expect(c.sell(a, mint, RAW_PER_TOKEN, 100)).rejects.toMatchObject({ code: 'INSUFFICIENT_TOKENS' });
    await expect(c.buy(a, mint, SOL, 100)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/world-chain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/server/src/world/chain.ts`:

```ts
import type { Keypair } from '@solana/web3.js';

export interface LaunchInput { name: string; symbol: string; uri: string; initialBuyLamports: number }
export interface TradeResult { signature: string; lamportsDelta: number; tokenDelta: number; feeLamports: number }
export interface LaunchResult extends TradeResult { mint: string; pool: string }
export interface CurveState { mint: string; pool: string; priceLamports: number; curveProgress: number; graduated: boolean; quoteReserveLamports: number }
export interface WalletBalances { lamports: number; tokens: { mint: string; raw: number }[] }
export interface Chain {
  readonly network: 'devnet' | 'memory';
  balances(publicKey: string): Promise<WalletBalances>;
  launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult>;
  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number): Promise<TradeResult>;
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number): Promise<TradeResult>;
  sendSol(signer: Keypair, to: string, lamports: number): Promise<{ signature: string; feeLamports: number }>;
  curve(mint: string): Promise<CurveState | null>;
}

export class ChainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const RAW_PER_TOKEN = 1_000_000;
const SOL = 1_000_000_000;
const TX_FEE = 5000;
const LAUNCH_COST = 20_000_000; // rent + creation, close to the devnet spike's measurement
const TRADE_FEE_BPS = 100;
// Scaled to a 5 SOL economy (50 wallets × 0.1 SOL) so a few agents can visibly pump or rug a coin; tuned to match the devnet launchpad.
const V_SOL = 1 * SOL, V_TOKENS = 1_073_000_000 * RAW_PER_TOKEN, CURVE_TOKENS = 793_100_000 * RAW_PER_TOKEN, GRADUATE_AT = 3 * SOL;

interface Pool { mint: string; pool: string; sol: number; sold: number; graduated: boolean }
interface Account { lamports: number; tokens: Map<string, number> }

/** A pump-style constant-product curve in memory: same interface as DevnetChain, for tests and the local fixture. */
export class MemoryChain implements Chain {
  readonly network = 'memory' as const;
  private accounts = new Map<string, Account>();
  private pools = new Map<string, Pool>();
  private n = 0;

  airdrop(publicKey: string, lamports: number) { this.acct(publicKey).lamports += lamports; }
  private acct(pk: string) { let a = this.accounts.get(pk); if (!a) { a = { lamports: 0, tokens: new Map() }; this.accounts.set(pk, a); } return a; }
  private sig() { return `mem${++this.n}`.padEnd(64, 'x'); }
  private spend(a: Account, lamports: number) {
    if (a.lamports < lamports) throw new ChainError('INSUFFICIENT_FUNDS', `Insufficient SOL: has ${a.lamports} lamports, needs ${lamports}`);
    a.lamports -= lamports;
  }
  private pool(mint: string) {
    const p = this.pools.get(mint);
    if (!p) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (p.graduated) throw new ChainError('GRADUATED', 'This coin graduated; its curve is closed');
    return p;
  }
  private price(p: Pool) { return ((V_SOL + p.sol) / (V_TOKENS - p.sold)) * RAW_PER_TOKEN; }

  async balances(publicKey: string): Promise<WalletBalances> {
    const a = this.acct(publicKey);
    return { lamports: a.lamports, tokens: [...a.tokens].filter(([, raw]) => raw > 0).map(([mint, raw]) => ({ mint, raw })) };
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    const a = this.acct(signer.publicKey.toBase58());
    this.spend(a, LAUNCH_COST + TX_FEE + input.initialBuyLamports);
    a.lamports += input.initialBuyLamports; // the first buy below re-spends it through the curve
    const mint = `M${this.n + 1}${input.symbol}`.padEnd(44, '1').slice(0, 44);
    this.pools.set(mint, { mint, pool: `P${mint.slice(1)}`, sol: 0, sold: 0, graduated: false });
    const signature = this.sig();
    let tokenDelta = 0;
    if (input.initialBuyLamports > 0) tokenDelta = this.swapIn(a, this.pools.get(mint)!, input.initialBuyLamports);
    return { mint, pool: this.pools.get(mint)!.pool, signature, lamportsDelta: -(LAUNCH_COST + TX_FEE + input.initialBuyLamports), tokenDelta, feeLamports: TX_FEE };
  }

  private swapIn(a: Account, p: Pool, lamportsIn: number): number {
    this.spend(a, lamportsIn);
    const net = Math.floor(lamportsIn * (1 - TRADE_FEE_BPS / 10_000));
    const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
    const out = Math.min(Math.floor(V_TOKENS - p.sold - k / (V_SOL + p.sol + net)), CURVE_TOKENS - p.sold);
    p.sol += net; p.sold += out;
    if (p.sol >= GRADUATE_AT || p.sold >= CURVE_TOKENS) p.graduated = true;
    a.tokens.set(p.mint, (a.tokens.get(p.mint) ?? 0) + out);
    return out;
  }

  async buy(signer: Keypair, mint: string, lamportsIn: number): Promise<TradeResult> {
    const p = this.pool(mint), a = this.acct(signer.publicKey.toBase58());
    this.spend(a, TX_FEE + lamportsIn); a.lamports += lamportsIn;
    const tokenDelta = this.swapIn(a, p, lamportsIn);
    return { signature: this.sig(), lamportsDelta: -(lamportsIn + TX_FEE), tokenDelta, feeLamports: TX_FEE };
  }

  async sell(signer: Keypair, mint: string, rawTokensIn: number): Promise<TradeResult> {
    const p = this.pool(mint), a = this.acct(signer.publicKey.toBase58());
    const held = a.tokens.get(mint) ?? 0;
    if (held < rawTokensIn || rawTokensIn <= 0) throw new ChainError('INSUFFICIENT_TOKENS', `Holds ${held} raw units, tried to sell ${rawTokensIn}`);
    this.spend(a, TX_FEE);
    const k = (V_SOL + p.sol) * (V_TOKENS - p.sold);
    const gross = Math.floor(V_SOL + p.sol - k / (V_TOKENS - p.sold + rawTokensIn));
    const out = Math.floor(gross * (1 - TRADE_FEE_BPS / 10_000));
    p.sol -= gross; p.sold -= rawTokensIn;
    a.tokens.set(mint, held - rawTokensIn);
    a.lamports += out;
    return { signature: this.sig(), lamportsDelta: out - TX_FEE, tokenDelta: -rawTokensIn, feeLamports: TX_FEE };
  }

  async sendSol(signer: Keypair, to: string, lamports: number) {
    const a = this.acct(signer.publicKey.toBase58());
    this.spend(a, lamports + TX_FEE);
    this.acct(to).lamports += lamports;
    return { signature: this.sig(), feeLamports: TX_FEE };
  }

  async curve(mint: string): Promise<CurveState | null> {
    const p = this.pools.get(mint);
    if (!p) return null;
    return { mint, pool: p.pool, priceLamports: this.price(p), curveProgress: Math.min(1, p.sol / GRADUATE_AT), graduated: p.graduated, quoteReserveLamports: p.sol };
  }
}
```

Note `buy`/`sell` ignore `slippageBps` in memory (there is no concurrent trader to slip against); the parameter stays in the interface for `DevnetChain`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/world-chain.test.ts`
Expected: PASS. If the rug test bound fails because of fee rounding, print the numbers and adjust only the bound, not the curve maths.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/world/chain.ts apps/server/test/world-chain.test.ts
git commit -m "feat(world): Chain interface and an in-memory bonding curve"
```

---

### Task 5: DevnetChain, launchpad and funding scripts

**Files:**
- Create: `apps/server/src/world/devnet-chain.ts`
- Create: `apps/server/src/world/ledger.ts`
- Create: `apps/server/src/world/launchpad.ts`
- Modify: `apps/server/src/world/cli.ts` (add `launchpad`, `fund`)
- Modify: `apps/server/package.json`, root `package.json` (scripts)
- Test: `apps/server/test/world-devnet-chain.test.ts`, `apps/server/test/world-ledger.test.ts`

**Interfaces:**
- Consumes: `Chain`, `ChainError`, `RAW_PER_TOKEN` (Task 4); `signerFor`, `walletOf`, `TREASURY` (Task 3); `worldSettings`, `chainTxs`, `wallets` tables (Task 2); spike notes (Task 1).
- Produces:
  - `class DevnetChain implements Chain` — `constructor(connection: Connection, config: PublicKey)`
  - `deltasFromTx(tx: ParsedTransactionWithMeta, owner: string, mint: string | null): { lamportsDelta: number; tokenDelta: number; feeLamports: number }`
  - `getSetting(db, key): Promise<string | null>`, `setSetting(db, key, value): Promise<void>` (in `launchpad.ts`), setting key `DBC_CONFIG = 'dbc_config'`
  - `createLaunchpad(connection: Connection, treasury: Keypair): Promise<string>` (config address)
  - `recordTx(db: Db, row: { signature: string; agentId: string | null; turnId: string | null; kind: ChainTxKind; mint?: string | null; counterparty?: string | null; lamportsDelta: number; tokenDelta?: number; feeLamports?: number; createdAt: Date }): Promise<void>` (in `ledger.ts`)
  - `fundAgents(db: Db, chain: Chain, key: Buffer, now: () => Date, lamports?: number): Promise<{ funded: number; skipped: number }>` (in `ledger.ts`)
  - `makeChain(config: Config, db: Db): Promise<Chain>` (in `devnet-chain.ts`): `MemoryChain` when `worldChain === 'memory'`, else `DevnetChain` with the stored config address (throws a clear error if the launchpad was never created).

- [ ] **Step 1: Write the failing `deltasFromTx` test**

`apps/server/test/world-devnet-chain.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { deltasFromTx } from '../src/world/devnet-chain.ts';

const OWNER = 'Owner1111111111111111111111111111111111111';
const tx = {
  meta: {
    fee: 5000,
    preBalances: [100_000_000, 0], postBalances: [89_990_000, 0],
    preTokenBalances: [], postTokenBalances: [{ accountIndex: 1, mint: 'MintA', owner: OWNER, uiTokenAmount: { amount: '123456789', decimals: 6 } }],
  },
  transaction: { message: { accountKeys: [{ pubkey: { toBase58: () => OWNER } }, { pubkey: { toBase58: () => 'Ata' } }] } },
} as unknown as ParsedTransactionWithMeta;

describe('deltasFromTx', () => {
  it('reads the owner’s SOL change (fees included) and token change from transaction meta', () => {
    expect(deltasFromTx(tx, OWNER, 'MintA')).toEqual({ lamportsDelta: -10_010_000, tokenDelta: 123_456_789, feeLamports: 5000 });
  });
  it('reports zero token change when no mint is involved', () => {
    expect(deltasFromTx(tx, OWNER, null).tokenDelta).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/world-devnet-chain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement DevnetChain**

`apps/server/src/world/devnet-chain.ts` (use the field and enum names recorded in `spike-notes.md` wherever they differ):

```ts
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, TransactionExpiredBlockheightExceededError, type ParsedTransactionWithMeta } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { DynamicBondingCurveClient, TokenDecimal, deriveDbcPoolAddress, getCurrentPoint, getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { ChainError, MemoryChain, type Chain, type CurveState, type LaunchInput, type LaunchResult, type TradeResult, type WalletBalances } from './chain.ts';
import { DBC_CONFIG, getSetting } from './launchpad.ts';

/** SOL and token change for `owner` in a confirmed transaction (fees included in the SOL change). */
export function deltasFromTx(tx: ParsedTransactionWithMeta, owner: string, mint: string | null) {
  const meta = tx.meta!;
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const i = keys.indexOf(owner);
  const lamportsDelta = i >= 0 ? meta.postBalances[i]! - meta.preBalances[i]! : 0;
  const sum = (bals: typeof meta.postTokenBalances) =>
    (bals ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((n, b) => n + Number(b.uiTokenAmount.amount), 0);
  return { lamportsDelta, tokenDelta: mint ? sum(meta.postTokenBalances) - sum(meta.preTokenBalances) : 0, feeLamports: meta.fee };
}

const chainError = (e: unknown): ChainError => {
  if (e instanceof ChainError) return e;
  const msg = (e as Error)?.message ?? String(e);
  if (/insufficient (funds|lamports)/i.test(msg)) return new ChainError('INSUFFICIENT_FUNDS', msg);
  if (/slippage|ExceededSlippage|0x1771/i.test(msg)) return new ChainError('SLIPPAGE', msg);
  return new ChainError('TX_FAILED', msg.slice(0, 500));
};

export class DevnetChain implements Chain {
  readonly network = 'devnet' as const;
  private client: DynamicBondingCurveClient;
  constructor(private conn: Connection, private config: PublicKey) { this.client = DynamicBondingCurveClient.create(conn, 'confirmed'); }

  private poolOf(mint: string) { return deriveDbcPoolAddress(NATIVE_MINT, new PublicKey(mint), this.config); }

  private async send(tx: Transaction, signers: Keypair[]): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      try { return await sendAndConfirmTransaction(this.conn, tx, signers, { commitment: 'confirmed' }); }
      catch (e) {
        if (attempt === 0 && e instanceof TransactionExpiredBlockheightExceededError) { tx.recentBlockhash = undefined; continue; }
        throw chainError(e);
      }
    }
  }

  private async deltas(signature: string, owner: string, mint: string | null) {
    const tx = await this.conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return { lamportsDelta: 0, tokenDelta: 0, feeLamports: 0 };
    return deltasFromTx(tx, owner, mint);
  }

  async balances(publicKey: string): Promise<WalletBalances> {
    const owner = new PublicKey(publicKey);
    const [lamports, accts] = await Promise.all([this.conn.getBalance(owner), this.conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })]);
    const tokens = accts.value.map((a) => ({ mint: a.account.data.parsed.info.mint as string, raw: Number(a.account.data.parsed.info.tokenAmount.amount) })).filter((t) => t.raw > 0);
    return { lamports, tokens };
  }

  async launch(signer: Keypair, input: LaunchInput): Promise<LaunchResult> {
    const mint = Keypair.generate();
    const tx = await this.client.creator.createPoolWithFirstBuy({
      createPoolParam: { name: input.name, symbol: input.symbol, uri: input.uri, payer: signer.publicKey, poolCreator: signer.publicKey, config: this.config, baseMint: mint.publicKey },
      firstBuyParam: input.initialBuyLamports > 0
        ? { buyer: signer.publicKey, buyAmount: new BN(input.initialBuyLamports), minimumAmountOut: new BN(0), referralTokenAccount: null }
        : undefined,
    });
    const signature = await this.send(tx, [signer, mint]);
    const m = mint.publicKey.toBase58();
    return { mint: m, pool: this.poolOf(m).toBase58(), signature, ...(await this.deltas(signature, signer.publicKey.toBase58(), m)) };
  }

  private async swap(signer: Keypair, mint: string, amountIn: number, slippageBps: number, swapBaseForQuote: boolean): Promise<TradeResult> {
    const pool = this.poolOf(mint);
    const virtualPool = await this.client.state.getPool(pool);
    if (!virtualPool) throw new ChainError('UNKNOWN_MINT', `No bonding-curve pool for mint ${mint}`);
    if (Number(virtualPool.isMigrated) !== 0) throw new ChainError('GRADUATED', 'This coin graduated; its curve is closed');
    const config = (await this.client.state.getPoolConfig(virtualPool.config))!;
    const currentPoint = await getCurrentPoint(this.conn, config.activationType);
    const quote = this.client.pool.swapQuote({ virtualPool, config, swapBaseForQuote, amountIn: new BN(amountIn), slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint });
    const tx = await this.client.pool.swap({ owner: signer.publicKey, pool, amountIn: new BN(amountIn), minimumAmountOut: quote.minimumAmountOut, swapBaseForQuote, referralTokenAccount: null });
    const signature = await this.send(tx, [signer]);
    return { signature, ...(await this.deltas(signature, signer.publicKey.toBase58(), mint)) };
  }

  buy(signer: Keypair, mint: string, lamportsIn: number, slippageBps: number) { return this.swap(signer, mint, lamportsIn, slippageBps, false); }
  sell(signer: Keypair, mint: string, rawTokensIn: number, slippageBps: number) { return this.swap(signer, mint, rawTokensIn, slippageBps, true); }

  async sendSol(signer: Keypair, to: string, lamports: number) {
    let dest: PublicKey;
    try { dest = new PublicKey(to); } catch { throw new ChainError('BAD_ADDRESS', `${to} is not a Solana address`); }
    const signature = await this.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: dest, lamports })), [signer]);
    return { signature, feeLamports: (await this.deltas(signature, signer.publicKey.toBase58(), null)).feeLamports };
  }

  async curve(mint: string): Promise<CurveState | null> {
    const pool = this.poolOf(mint);
    const vp = await this.client.state.getPool(pool);
    if (!vp) return null;
    const priceSol = Number(getPriceFromSqrtPrice(vp.sqrtPrice, TokenDecimal.SIX, 9).toString());
    return {
      mint, pool: pool.toBase58(), priceLamports: priceSol * 1e9,
      curveProgress: await this.client.state.getPoolQuoteTokenCurveProgress(pool),
      graduated: Number(vp.isMigrated) !== 0, quoteReserveLamports: Number(vp.quoteReserve.toString()),
    };
  }
}

export async function makeChain(config: Config, db: Db): Promise<Chain> {
  if (config.worldChain === 'memory') return new MemoryChain();
  const address = await getSetting(db, DBC_CONFIG);
  if (!address) throw new Error('No launchpad config yet: run `npm run world:launchpad` once (needs a funded treasury)');
  return new DevnetChain(new Connection(config.solanaRpcUrl, 'confirmed'), new PublicKey(address));
}
```

- [ ] **Step 4: Write `launchpad.ts`**

`apps/server/src/world/launchpad.ts` (curve parameters from the spike; use the tuned market caps from `spike-notes.md` if they differ):

```ts
import { eq } from 'drizzle-orm';
import { Connection, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption, TokenAuthorityOption,
  TokenDecimal, TokenType, buildCurveWithMarketCap,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Db } from '../db/client.ts';
import { worldSettings } from '../db/schema.ts';

export const DBC_CONFIG = 'dbc_config';
export async function getSetting(db: Db, key: string): Promise<string | null> {
  const [r] = await db.select().from(worldSettings).where(eq(worldSettings.key, key));
  return r?.value ?? null;
}
export async function setSetting(db: Db, key: string, value: string) {
  await db.insert(worldSettings).values({ key, value }).onConflictDoUpdate({ target: worldSettings.key, set: { value } });
}

/** Shillex's partner config on the Dynamic Bonding Curve program: pump-style curve, 1% fee, half to the creator. */
export async function createLaunchpad(conn: Connection, treasury: Keypair): Promise<string> {
  const client = DynamicBondingCurveClient.create(conn, 'confirmed');
  const curve = buildCurveWithMarketCap({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
    fee: {
      baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
      dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
    },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
    liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: 1,
    migrationMarketCap: 12,
  });
  const cfg = Keypair.generate();
  const tx = await client.partner.createConfig({ config: cfg.publicKey, feeClaimer: treasury.publicKey, leftoverReceiver: treasury.publicKey, quoteMint: NATIVE_MINT, payer: treasury.publicKey, ...curve });
  await sendAndConfirmTransaction(conn, tx, [treasury, cfg], { commitment: 'confirmed' });
  return cfg.publicKey.toBase58();
}
```

- [ ] **Step 5: Write the failing ledger/funding test**

`apps/server/test/world-ledger.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import type { DbHandle } from '../src/db/client.ts';
import { seedWorld } from '../src/world/seed.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { TREASURY, walletOf } from '../src/world/wallets.ts';
import { fundAgents } from '../src/world/ledger.ts';
import { chainTxs, wallets } from '../src/db/schema.ts';

const key = randomBytes(32);
let h: DbHandle;
beforeAll(async () => { h = await testDb(); await seedWorld(h.db, { now: new Date(), worldKey: key }); });
afterAll(() => h.close());

describe('fundAgents', () => {
  it('sends exactly 0.1 SOL to every unfunded agent once and records it', async () => {
    const chain = new MemoryChain();
    chain.airdrop((await walletOf(h.db, TREASURY))!.publicKey, 6_000_000_000);
    expect(await fundAgents(h.db, chain, key, () => new Date())).toEqual({ funded: 50, skipped: 0 });
    expect(await fundAgents(h.db, chain, key, () => new Date())).toEqual({ funded: 0, skipped: 50 });
    const rows = await h.db.select().from(chainTxs).where(eq(chainTxs.kind, 'fund'));
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.lamportsDelta === 100_000_000 && r.agentId)).toBe(true);
    expect(await h.db.select().from(wallets).where(isNull(wallets.fundedAt))).toHaveLength(1); // only the treasury
    const one = rows[0]!;
    const w = await h.db.select().from(wallets).where(eq(wallets.ownerId, one.agentId!));
    expect((await chain.balances(w[0]!.publicKey)).lamports).toBe(100_000_000);
  });
  it('stops cleanly when the treasury runs dry', async () => {
    const h2 = await testDb();
    await seedWorld(h2.db, { now: new Date(), worldKey: key });
    const chain = new MemoryChain();
    chain.airdrop((await walletOf(h2.db, TREASURY))!.publicKey, 250_000_000);
    await expect(fundAgents(h2.db, chain, key, () => new Date())).rejects.toThrow(/Treasury ran out after funding 2/);
    await h2.close();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run test/world-ledger.test.ts`
Expected: FAIL — `../src/world/ledger.ts` not found.

- [ ] **Step 7: Implement the ledger**

`apps/server/src/world/ledger.ts`:

```ts
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { ChainTxKind } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { chainTxs, wallets } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { ChainError, type Chain } from './chain.ts';
import { TREASURY, signerFor } from './wallets.ts';

export const START_LAMPORTS = 100_000_000;

export async function recordTx(db: Db, row: {
  signature: string; agentId: string | null; turnId: string | null; kind: ChainTxKind; mint?: string | null; counterparty?: string | null;
  lamportsDelta: number; tokenDelta?: number; feeLamports?: number; createdAt: Date;
}) {
  await db.insert(chainTxs).values({ id: newId(), mint: null, counterparty: null, tokenDelta: 0, feeLamports: 0, ...row });
}

/** One-time 0.1 SOL to every agent wallet that has never been funded. */
export async function fundAgents(db: Db, chain: Chain, key: Buffer, now: () => Date, lamports = START_LAMPORTS) {
  const treasury = await signerFor(db, TREASURY, key);
  const all = await db.select().from(wallets).where(ne(wallets.ownerId, TREASURY));
  let funded = 0;
  for (const w of all.filter((x) => !x.fundedAt)) {
    let r;
    try { r = await chain.sendSol(treasury, w.publicKey, lamports); }
    catch (e) {
      if (e instanceof ChainError && e.code === 'INSUFFICIENT_FUNDS') throw new Error(`Treasury ran out after funding ${funded}; top it up with devnet SOL and rerun`);
      throw e;
    }
    await recordTx(db, { signature: r.signature, agentId: w.ownerId, turnId: null, kind: 'fund', counterparty: treasury.publicKey.toBase58(), lamportsDelta: lamports, createdAt: now() });
    await db.update(wallets).set({ fundedAt: now() }).where(and(eq(wallets.ownerId, w.ownerId), isNull(wallets.fundedAt)));
    funded++;
  }
  return { funded, skipped: all.length - funded };
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run test/world-ledger.test.ts test/world-devnet-chain.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire `launchpad` and `fund` into the CLI**

In `apps/server/src/world/cli.ts`, extend the imports and the command switch:

```ts
import { Connection } from '@solana/web3.js';
import { DBC_CONFIG, createLaunchpad, getSetting, setSetting } from './launchpad.ts';
import { fundAgents } from './ledger.ts';
import { makeChain } from './devnet-chain.ts';
import { TREASURY, signerFor, walletOf } from './wallets.ts';
```

```ts
  if (cmd === 'seed') console.log(await seedWorld(handle.db, { now: new Date(), worldKey: key, adminPassword: config.worldAdminPassword }));
  else if (cmd === 'treasury') console.log('treasury', (await walletOf(handle.db, TREASURY))?.publicKey ?? '(run seed first)');
  else if (cmd === 'launchpad') {
    const existing = await getSetting(handle.db, DBC_CONFIG);
    if (existing) console.log('launchpad config already exists:', existing);
    else {
      const address = await createLaunchpad(new Connection(config.solanaRpcUrl, 'confirmed'), await signerFor(handle.db, TREASURY, key));
      await setSetting(handle.db, DBC_CONFIG, address);
      console.log('launchpad config', address);
    }
  } else if (cmd === 'fund') console.log(await fundAgents(handle.db, await makeChain(config, handle.db), key, () => new Date()));
  else throw new Error(`Unknown command "${cmd}". Use: seed | treasury | launchpad | fund`);
```

Scripts — `apps/server/package.json`: `"world:treasury": "npm run world -- treasury"`, `"world:launchpad": "npm run world -- launchpad"`, `"world:fund": "npm run world -- fund"`. Root `package.json`: `"world:treasury"`, `"world:launchpad"`, `"world:fund"` forwarding with `-w @shillex/server` like `world:seed`.

- [ ] **Step 10: Manual devnet check (only if the spike payer still has SOL; otherwise skip and note it)**

With `WORLD_MODE=agents WORLD_KEY=<32-byte b64> PGLITE_DIR=<scratch>`: `npm run world:seed`, `npm run world:treasury`, transfer ~1 devnet SOL from the spike payer (or the faucet) to the treasury address, then `npm run world:launchpad`. Expected: a config address printed and stored. Do not run `world:fund` here (it needs 5+ SOL); funding the real world happens at rollout (Task 15).

- [ ] **Step 11: Typecheck and commit**

Run: `npx tsc -p tsconfig.json --noEmit` (in `apps/server`). Expected: no errors.

```bash
git add apps/server/src/world apps/server/test/world-devnet-chain.test.ts apps/server/test/world-ledger.test.ts apps/server/package.json package.json
git commit -m "feat(world): devnet bonding-curve chain, launchpad config and one-time agent funding"
```
