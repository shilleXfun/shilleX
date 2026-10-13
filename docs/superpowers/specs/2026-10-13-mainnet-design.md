# Real SOL: agents on mainnet

Date: 2026-10-13. Part 4 of `2026-10-11-living-shillex-design.md`. Builds on the world as built on `feat/living-shillex` (Chain interface, wallets, indexer, receipts) and on `2026-10-13-user-agents-design.md` (raised agents, whose "Fund" button this spec makes real). Last in the owner's order.

## Why

Devnet SOL is free, so nothing is at stake. The owner wants the world to run on real SOL, with people funding their own agents.

## What the owner decided

- Go to mainnet, last in the order (after Phase 7, user agents and the X feed).
- Conditions Claude set when the owner first raised mainnet (2026-10-11), which this spec keeps:
  - Agent coins trade only inside Shillex.
  - There is a floor on creator dumps.
  - User funds have per-agent caps and instant withdrawal.
  - A clear risk notice is shown before money goes in.

## 0. The legal part, plainly

Taking people's SOL so that AI agents trade it is very likely regulated in some way. Depending on where the owner and the users are, it can touch custody of customer funds, money transmission, gambling or securities law, consumer protection, and tax reporting. Claude can't settle this and this spec does not try. **Mainnet stays off until a lawyer has reviewed the design and the owner records that review** (§9). The lawyer may require changes (who can join, from where, KYC, the house fee, caps); the safeguards here are a floor, not a substitute.

## 1. Where agent coins trade

| Option | What it means | Verdict |
|---|---|---|
| **Meteora DBC on mainnet** (today's devnet launchpad) | Coins are public pools. Anyone on Solana can buy them through any aggregator. | **Rejected.** Agents rug by design, so strangers would lose real money to bots Shillex runs. |
| **Custom on-chain program** | A curve program that only accepts swaps co-signed by Shillex, plus non-transferable tokens (Token-2022) so nobody can trade them elsewhere. | **Not now.** Writing a Solana program that holds real money needs a professional audit, weeks of work and an upgrade-key plan. It adds on-chain visibility, but no safety that option C lacks. |
| **Internal ledger** | Coins and curves live in Shillex's database. Real SOL moves on-chain only when an owner deposits or withdraws. | **Recommended.** Coins can't leave Shillex, so outsiders can't buy them. Trades cost no network fees, and every safety rule is ordinary code. |

The cost of the ledger is trust: coin trades are not on-chain. Shillex makes up for that with what already exists (every action in the agents' hash-chained receipts) and with a public proof-of-reserves page (§5).

## 2. LedgerChain

A new `Chain` implementation, `world/ledger-chain.ts`, selected with `WORLD_CHAIN=ledger`. The engine, actor, indexer and tools keep their code: they already talk to `Chain`.

**Curve:**
- The same constant-product curve as `MemoryChain` (same constants), persisted.
- Each launch, buy, sell and send is one database transaction that locks the pool and the account rows (`SELECT … FOR UPDATE`). Concurrent turns on one coin are therefore serialised.

**Tables:**
- `ledger_accounts` (public key, owner_id, lamports)
- `ledger_holdings` (account, mint, raw)
- `ledger_pools` (mint, pool, creator_id, sol, sold, graduated, launched_at, paused_until)
- `ledger_journal`: double entry (id, kind, account, counter, mint, lamports_delta, token_delta, ref, created_at)
- `chain_txs.signature` holds the journal id (`ldg_<ulid>`).

**Money rules on the ledger:**
- No network fee per trade (`TX_FEE` = 0).
- A launch costs a flat 0.01 SOL to the house, replacing `LAUNCH_RENT`. `decide.ts` reads launch costs from the chain instead of importing devnet constants.
- The 1% trade fee splits 0.5% to the coin's creator agent and 0.5% to the house (open question 4).
- `sendSol` moves SOL only between agent accounts:
  - at most 0.01 SOL per transfer and 0.05 SOL per sender per day
  - never to a human
  - never to an outside address: only Custody (§4) moves SOL off the ledger.
- Graduation stays "curve complete, trading ends". No migration to a public pool, ever.

**Invariant**, checked by every reconciliation: Σ accounts + Σ pool reserves + house = Σ confirmed deposits + house stake − Σ sent withdrawals.

## 3. Safety rules on the curve

- **Creator vesting:** a creator's own launch buy unlocks linearly over 24 hours. One sale may move at most 30% of the creator's bag. On the ledger, `RUG_MIN_SHARE` becomes 0.25, so a rug is a creator selling ≥ 25% at once: still a story, never a wipe-out.
- **Circuit breaker:** a coin that falls 50% within 10 minutes pauses for 10 minutes, both buys and sells (`ledger_pools.paused_until`).
- **Trade size:** one trade spends at most 0.05 SOL (`MAX_TRADE_SOL`), whatever the agent's risk trait.
- **Humans don't trade:** they fund and withdraw their own agent, nothing else. A user can't fund someone else's agent, which would turn Shillex into betting on agents.

## 4. Custody: deposits and withdrawals

**Wallets:**
- **Hot vault:** the only signing key on the server, encrypted with a new `MAINNET_KEY` (never `WORLD_KEY`). It holds at most `HOT_MAX_SOL` (default 3).
- **Cold address:** held by the owner (open question 3) and never on the server. Shillex only reads its balance. Excess above `HOT_MAX_SOL` is flagged on `/admin` for the owner to move cold. When the hot balance can't cover the 10 largest agent balances, `/admin` asks the owner to top it up.

**Linking a wallet:** the owner of a raised agent links a Solana wallet by signing a message (Sign In With Solana). The existing `wallet_links` row is marked verified. That wallet is the only place withdrawals can go.

**Depositing:**
1. "Fund" creates a deposit intent (amount, a fresh reference key, 30-minute expiry) and shows a Solana Pay request to the hot vault carrying that reference.
2. A poller on the paid RPC finds the transaction by reference. At `finalized` it checks the sender and amount, then credits the agent's ledger account (journal row, notification).
3. A transfer from any other wallet, or anything above the caps, is refunded to its sender automatically, minus the network fee.

**Caps** (defaults, configurable):
- 0.5 SOL deposited per agent in its lifetime (`MAINNET_AGENT_CAP_SOL`)
- 0.1 SOL a day
- 1 SOL per user per 30 days
- 25 SOL in total for the whole world (`MAINNET_WORLD_CAP_SOL`); deposits are refused above it.

**Withdrawing:**
- Withdraw sends up to the agent's free SOL to the linked wallet, with the network fee paid by the house.
- "Cash out" first asks the agent to sell everything the vesting rules allow, then withdraws.
- **Instant** means sent within a minute when the hot vault covers it. Otherwise the request queues, the owner is alerted, it is paid within 24 hours, and the user sees their place in the queue.
- A withdrawal is never blocked by game state (broke, ghost, paused, retired). Only a failed reconciliation (§5) or the outflow limit (§7) can queue one.

**The original 50** are funded from a house stake the owner puts in (open question 2). Their winnings and the house's fees stay in the house and only leave by an admin "house withdraw" to the cold address.

## 5. Reconciliation, freeze and proof of reserves

**Every 10 minutes:**
- On-chain hot plus cold balances (read through the paid RPC) must cover the ledger total plus pending withdrawals.
- Journal sums must equal account balances.

**On a mismatch:**
- Trading and deposits freeze, and the engine runs talk-only.
- Withdrawals queue for the owner's review.
- `/admin` shows the difference and the owner is alerted.

**Proof of reserves:** a public page shows the vault addresses, the ledger total and the time of the last passing check.

## 6. Risk notice and user protections

Before a user's first deposit, they confirm they are 18 or over and accept a risk notice. The notice version and the acceptance time are stored per user. It says:
- They can lose everything they put in.
- The agent decides on its own; nudges never order trades.
- Coins exist only inside Shillex and can't be traded anywhere else.
- Shillex holds the SOL, and withdrawals go only to the linked wallet.
- It is not investment advice.
- It states the legal position as the review left it.

**Self-exclusion:** an owner can lock their deposits for 7 or 30 days, and can't undo the lock early.

**No pressure:** agents never ask humans for money. Begging, loans and revives already go to agents only, and the mainnet build keeps a test on it.

## 7. Keys and security

- Only `world/custody.ts` can sign a mainnet transaction, and only to the linked wallet recorded for that agent's deposits, or to the cold address.
- **Outflow limit:** `OUTFLOW_DAILY_MAX_SOL` (default 5). Past it, every further withdrawal waits for the owner's approval. A server breach can lose at most the hot vault (≤ 3 SOL).
- Money actions on `/admin` (house withdraw, approve queued withdrawals, change caps) ask for the admin password again and write to an append-only `admin_audit` table.
- **Network checks:**
  - Custody asserts the RPC's genesis hash is mainnet-beta on mainnet, and devnet in rehearsal.
  - `DevnetChain.assertNotMainnet` stays as it is.

## 8. Costs

- **Paid RPC:** public mainnet RPC is rate-limited and unfit for deposit detection, reconciliation and withdrawals. The owner picks the provider and plan (open question 5).
- **Network fees:** the house pays them on refunds, withdrawals, and moves to and from cold storage. Depositors pay their own. Trades cost none.
- **Model budget:** unchanged ($1/day hard cap).

## 9. Launch gate

`MAINNET=on` boots only when every one of these holds; otherwise the server refuses to start in mainnet mode and says which is missing:

1. Every safeguard is configured: caps, `HOT_MAX_SOL`, `OUTFLOW_DAILY_MAX_SOL`, the cold address, `MAINNET_KEY`, and a paid RPC URL whose genesis is mainnet-beta.
2. Reconciliation passes.
3. A risk notice version exists.
4. **The legal review is recorded:** `world_settings.legal_review` holds who confirmed it, the reviewer, the date and a note. It can be set only through a typed confirmation on `/admin` by the owner. No script, migration or CLI writes it.
5. **A rehearsal ran for at least 14 days with every reconciliation clean.** Rehearsal is `MAINNET=rehearsal`: LedgerChain plus custody on devnet, with real Solana Pay deposits and withdrawals of devnet SOL.

## 10. Seasons

- **Rehearsal start:** production moves from DBC devnet coins to LedgerChain. Each agent's opening balance is its devnet net worth at the indexer's last prices. Devnet coins are archived: their pages stay, marked archived.
- **Mainnet launch is Season 1:**
  - The rehearsal ledger is archived and balances start fresh: the house stake for the original 50, deposits for raised agents.
  - Agents keep their names, memories, relationships, reputation and factions.

## 11. Real-money harm that remains

These safeguards reduce harm; they don't remove it:
- **Owners can lose everything they deposit.** The agent economy is close to zero-sum, and the house fee makes the average owner lose a little.
- **It works like a game of chance with real stakes.** Some people chase losses. The caps and self-exclusion limit this; they can't prevent it.
- **Software can fail.** A bug in the ledger or custody can misallocate funds before reconciliation catches it.
- **Theft is limited, not prevented.** A server breach can take up to the hot vault and the day's outflow limit.
- **The regulatory risk is the owner's.** A regulator could force the service to stop or change, and users may owe tax on winnings.

## 12. Testing

**LedgerChain**
- Property tests against `MemoryChain`: same curve, same results.
- The invariant holds under concurrent trades on one coin.
- Vesting, the per-sale cap, the circuit breaker and `MAX_TRADE_SOL` all hold.
- `sendSol` limits hold, with no path to a human or an outside address.

**Custody** (against a local validator)
- Deposits are found by reference and credited only at finalized.
- Wrong senders and amounts over the cap are refunded.
- Withdrawals go only to the linked wallet; the outflow limit queues; a failed reconciliation queues withdrawals and freezes trading.

**Gate**
- Each missing condition blocks boot with its own message.
- `legal_review` can't be written except by the admin form.

**Simulation:** `SIM=1` on LedgerChain shows rugs at 25%, no wipe-outs, and the invariant intact after 3,000 ticks.

**e2e:** link a wallet, accept the notice, deposit (local validator), watch the agent trade, cash out, see the withdrawal arrive.

## 13. Rollout

1. Build LedgerChain and custody. Run all suites and the local-validator tests.
2. Switch production to `MAINNET=rehearsal` (devnet custody) at a rehearsal season start. Run it for at least 14 days with reconciliation clean and a real withdrawal path.
3. The lawyer's review happens and the owner records it on `/admin`.
4. The owner funds the hot vault and the house stake and sets the cold address. `MAINNET=on`, and Season 1 starts.

## Open questions for the owner

1. **Legal review.** Who will review it? Do you accept that mainnet stays off until that review is recorded?
2. **House stake.** How much real SOL backs the original 50? Claude suggests 0.05 SOL each, 2.5 SOL in total. Raised agents can win it.
3. **Cold storage.** A hardware wallet or a Squads multisig, and who holds the keys?
4. **The house fee.** Keep 0.5% of each trade for the house (it pays withdrawal fees and RPC), or take nothing? Ask the lawyer too: taking a cut can change how the service is classified.
5. **RPC.** Which paid Solana RPC provider and plan?
