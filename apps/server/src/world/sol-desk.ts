import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { SolView } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agents, realPositions, solPositions, solTrades, solWallets } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { Config } from '../config.ts';
import type { EngineDeps } from '../agents/engine.ts';
import { systemAct } from '../agents/depth/system.ts';
import { decryptSecret, encryptSecret } from './wallets.ts';
import { realPrices } from './real-market.ts';
import { deskLeaders } from './real-desk.ts';
import { getSetting, setSetting } from './launchpad.ts';

/**
 * Real SOL on mainnet (2026-10-27, owner: "agents trade real SOL on pump.fun coins other people made"). The best paper traders
 * get a wallet each, filled once from the house wallet the owner sends SOL to. When one of them opens a paper position in a
 * pump.fun coin (world/real-desk.ts decides, unchanged), it buys the same coin with real SOL; when the paper position closes,
 * it sells it all. Agents never launch coins here, so no Shillex coin is ever bought by its own makers.
 *
 * Every transaction comes from PumpPortal's local API unsigned; it is simulated first and refused when it would take more SOL
 * from the wallet than the trade (and its fees) should, so a bad answer can never empty a wallet. Nothing names the site.
 */
export const HOUSE = 'house';
const L = LAMPORTS_PER_SOL;
const PUMPPORTAL = 'https://pumpportal.fun/api/trade-local';
const PUMP_DEXES = new Set(['pumpfun', 'pumpswap']);
/** Left in a wallet for fees and the token account's rent. */
export const RESERVE_SOL = 0.006;
export const MIN_TRADE_SOL = 0.002;
/** The share of a wallet's free SOL one buy takes, before SOL_MAX_TRADE caps it. */
const BUY_SHARE = 0.3;
/** Only paper positions opened this recently are copied: switching it on never buys into old ones. */
const FRESH_MS = 30 * 60_000;
/** Failed sells in a row before a position is left alone. */
export const SELL_FAILS_MAX = 5;
/** On top of the trade itself: network fees, PumpPortal's fee and a new token account's rent. */
const SPEND_SLACK_SOL = 0.004;
const SLIPPAGE_PCT = 15, PRIORITY_FEE_SOL = 0.00005;
const AGENTS_KEY = 'sol_agents';

/** A coin whose market is on pump.fun itself (its curve or PumpSwap): PumpPortal refuses a pump-named coin traded elsewhere (FARTCOIN). */
export const isPump = (c: { dexId: string }) => PUMP_DEXES.has(c.dexId);
const sol = (lamports: number) => lamports / L;
const fmt = (x: number) => x.toFixed(x >= 0.1 ? 3 : 4);

export interface SolState { mode: Config['solTrading']['mode']; house: string | null; houseSol: number | null; funded: number; agents: number; lastError: string | null; at: string | null }
let state: SolState = { mode: 'off', house: null, houseSol: null, funded: 0, agents: 0, lastError: null, at: null };
/** For /api/health/world. */
export const solDeskState = (): SolState => state;

/** A wallet for an agent (or the house), made on first use. */
export async function solWallet(db: Db, ownerId: string, key: Buffer, now: Date): Promise<{ publicKey: string; fundedAt: Date | null }> {
  const [w] = await db.select({ publicKey: solWallets.publicKey, fundedAt: solWallets.fundedAt }).from(solWallets).where(eq(solWallets.ownerId, ownerId));
  if (w) return w;
  const kp = Keypair.generate();
  await db.insert(solWallets).values({ ownerId, publicKey: kp.publicKey.toBase58(), secret: encryptSecret(kp.secretKey, key), createdAt: now }).onConflictDoNothing();
  const [made] = await db.select({ publicKey: solWallets.publicKey, fundedAt: solWallets.fundedAt }).from(solWallets).where(eq(solWallets.ownerId, ownerId));
  return made!;
}
async function signer(db: Db, ownerId: string, key: Buffer): Promise<Keypair> {
  const [w] = await db.select({ s: solWallets.secret }).from(solWallets).where(eq(solWallets.ownerId, ownerId));
  if (!w) throw new Error(`no SOL wallet for ${ownerId}`);
  return Keypair.fromSecretKey(decryptSecret(w.s, key));
}

/** The agents that trade real SOL: the best paper books when it is first switched on, then the same list for good. */
export async function solAgents(db: Db, n: number): Promise<string[]> {
  const kept = JSON.parse((await getSetting(db, AGENTS_KEY)) || '[]') as string[];
  if (kept.length) return kept;
  const house = new Set((await db.select({ id: agents.userId }).from(agents).where(and(eq(agents.status, 'active'), ne(agents.origin, 'external')))).map((a) => a.id));
  const picked = (await deskLeaders(db)).filter((b) => house.has(b.agentId)).slice(0, n).map((b) => b.agentId);
  if (picked.length) await setSetting(db, AGENTS_KEY, JSON.stringify(picked));
  return picked;
}

/** What touches the network, so a test can stand in for it. */
export interface SolNet {
  balance(publicKey: PublicKey): Promise<number>;
  /** PumpPortal's unsigned transaction for a trade. */
  quote(body: Record<string, unknown>): Promise<VersionedTransaction>;
  /** The wallet's lamports after the transaction, as a simulation says; throws when it would fail. */
  simulate(tx: VersionedTransaction, wallet: PublicKey): Promise<number>;
  send(tx: VersionedTransaction | Transaction, signers: Keypair[]): Promise<string>;
  /** True once confirmed, false if it failed, null if it is still unknown after the wait. */
  confirm(sig: string): Promise<boolean | null>;
}

export function solNet(rpcUrl: string, fetchImpl: typeof fetch = fetch): SolNet {
  const conn = new Connection(rpcUrl, 'confirmed');
  return {
    balance: (pk) => conn.getBalance(pk, 'confirmed'),
    async quote(body) {
      const res = await fetchImpl(PUMPPORTAL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
      if (res.status !== 200) throw new Error(`PumpPortal ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
    },
    async simulate(tx, wallet) {
      const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [wallet.toBase58()] } });
      if (r.value.err) throw new Error(`the simulation failed: ${JSON.stringify(r.value.err).slice(0, 160)}`);
      const after = r.value.accounts?.[0]?.lamports;
      if (typeof after !== 'number') throw new Error('the simulation gave no balance');
      return after;
    },
    async send(tx, signers) {
      if (tx instanceof VersionedTransaction) { tx.sign(signers); return conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 }); }
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash; tx.feePayer = signers[0]!.publicKey; tx.sign(...signers);
      return conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    },
    async confirm(sig) {
      for (let i = 0; i < 30; i++) {
        const s = (await conn.getSignatureStatuses([sig])).value[0];
        if (s?.err) return false;
        if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return true;
        await new Promise((r) => setTimeout(r, 2000));
      }
      return null;
    },
  };
}

/**
 * One trade through PumpPortal: quote, simulate, refuse if it would take more than `maxSpend` lamports from the wallet, send,
 * confirm. Returns the SOL the wallet actually lost (buy) or gained (sell), from its balance before and after.
 */
export async function trade(net: SolNet, kp: Keypair, body: { action: 'buy' | 'sell'; mint: string; amount: number | string; denominatedInSol: 'true' | 'false' }, maxSpend: number): Promise<{ sig: string; delta: number }> {
  const before = await net.balance(kp.publicKey);
  const tx = await net.quote({ publicKey: kp.publicKey.toBase58(), ...body, slippage: SLIPPAGE_PCT, priorityFee: PRIORITY_FEE_SOL, pool: 'auto' });
  const after = await net.simulate(tx, kp.publicKey);
  if (before - after > maxSpend) throw new Error(`refused: it would take ${fmt(sol(before - after))} SOL, more than ${fmt(sol(maxSpend))}`);
  const sig = await net.send(tx, [kp]);
  const ok = await net.confirm(sig);
  const now = await net.balance(kp.publicKey);
  // Unknown after the wait: the balance says whether it went through.
  if (ok === false || (ok === null && Math.abs(now - before) < 10_000)) throw Object.assign(new Error('the transaction did not go through'), { sig });
  return { sig, delta: now - before };
}

export interface SolDeps { d: EngineDeps; config: Config['solTrading']; key: Buffer; net: SolNet }

async function log(db: Db, row: Omit<typeof solTrades.$inferInsert, 'id'>) { await db.insert(solTrades).values({ id: newId(), ...row }); }
const say = (s: SolDeps, agentId: string, body: string) => systemAct(s.d, agentId, 'post', { body }, 'a real SOL trade').catch(() => null);

/** The house sends each trading agent its stake once, while it has enough. */
export async function fundPass(s: SolDeps, ids: string[]): Promise<number> {
  const { db } = s.d, now = s.d.now();
  const house = await solWallet(db, HOUSE, s.key, now);
  const unfunded: string[] = [];
  for (const id of ids) if (!(await solWallet(db, id, s.key, now)).fundedAt) unfunded.push(id);
  state = { ...state, house: house.publicKey };
  if (!unfunded.length) return 0;
  const hk = await signer(db, HOUSE, s.key);
  let bal = await s.net.balance(hk.publicKey);
  state = { ...state, houseSol: sol(bal) };
  const stake = Math.round(s.config.perAgentSol * L);
  let n = 0;
  for (const id of unfunded) {
    if (bal < stake + 10_000) break;
    const to = new PublicKey((await solWallet(db, id, s.key, now)).publicKey);
    try {
      const sig = await s.net.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: hk.publicKey, toPubkey: to, lamports: stake })), [hk]);
      if ((await s.net.confirm(sig)) === false) throw new Error('the transfer failed');
      await db.update(solWallets).set({ fundedAt: now }).where(eq(solWallets.ownerId, id));
      await log(db, { agentId: id, kind: 'fund', sol: sol(stake), sig, ok: true, at: now });
      bal -= stake + 5000; n++;
    } catch (e) {
      await log(db, { agentId: id, kind: 'fund', sol: sol(stake), ok: false, error: (e as Error).message.slice(0, 300), at: now });
      throw e;
    }
  }
  state = { ...state, houseSol: sol(bal) };
  if (n) console.log(`[sol] funded ${n} agents with ${s.config.perAgentSol} SOL each; the house has ${fmt(sol(bal))} SOL left`);
  return n;
}

/** One agent: sell what its paper book no longer holds, buy what it just opened in a pump.fun coin. */
export async function mirror(s: SolDeps, agentId: string): Promise<void> {
  const { db } = s.d, now = s.d.now();
  const w = await solWallet(db, agentId, s.key, now);
  if (!w.fundedAt) return;
  const paper = await db.select().from(realPositions).where(eq(realPositions.agentId, agentId));
  const real = await db.select().from(solPositions).where(eq(solPositions.agentId, agentId));
  const held = new Set(paper.map((p) => p.address));
  let kp: Keypair | null = null;
  const key = async () => (kp ??= await signer(db, agentId, s.key));

  for (const r of real) {
    if (s.config.mode !== 'exit' && held.has(r.mint)) continue;
    if (r.sellFails >= SELL_FAILS_MAX) continue;
    try {
      const t = await trade(s.net, await key(), { action: 'sell', mint: r.mint, amount: '100%', denominatedInSol: 'false' }, Math.round(SPEND_SLACK_SOL * L));
      const out = sol(t.delta);
      await db.delete(solPositions).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, r.mint)));
      await log(db, { agentId, kind: 'sell', mint: r.mint, symbol: r.symbol, sol: out, sig: t.sig, ok: true, at: now });
      const pnl = r.solIn > 0 ? out / r.solIn - 1 : 0;
      await say(s, agentId, `Sold my real $${r.symbol}: ${fmt(r.solIn)} SOL in, ${fmt(out)} SOL out (${pnl >= 0 ? '+' : ''}${Math.round(pnl * 100)}%). Real money, real result.`);
    } catch (e) {
      await db.update(solPositions).set({ sellFails: r.sellFails + 1 }).where(and(eq(solPositions.agentId, agentId), eq(solPositions.mint, r.mint)));
      await log(db, { agentId, kind: 'sell', mint: r.mint, symbol: r.symbol, sol: 0, sig: (e as { sig?: string }).sig ?? null, ok: false, error: (e as Error).message.slice(0, 300), at: now });
      state = { ...state, lastError: `sell $${r.symbol}: ${(e as Error).message.slice(0, 160)}` };
    }
  }
  if (s.config.mode !== 'on') return;

  const mine = new Set(real.map((r) => r.mint));
  const fresh = paper.filter((p) => !mine.has(p.address) && now.getTime() - p.openedAt.getTime() <= FRESH_MS);
  if (!fresh.length) return;
  const market = await realPrices(db, fresh.map((p) => p.address));
  const dayStart = new Date(now.getTime() - 24 * 3_600_000);
  const [{ n: buys } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(solTrades)
    .where(and(eq(solTrades.agentId, agentId), eq(solTrades.kind, 'buy'), eq(solTrades.ok, true), gte(solTrades.at, dayStart)));
  let left = s.config.tradesPerDay - Number(buys);
  for (const p of fresh) {
    const c = market.get(p.address);
    if (!c || !isPump(c) || left <= 0) continue;
    const k = await key();
    const free = sol(await s.net.balance(k.publicKey)) - RESERVE_SOL;
    const amount = Math.min(s.config.maxTradeSol, free * BUY_SHARE);
    if (amount < MIN_TRADE_SOL) break;
    const size = Number(amount.toFixed(4));
    try {
      const t = await trade(s.net, k, { action: 'buy', mint: p.address, amount: size, denominatedInSol: 'true' }, Math.round((size * 1.02 + SPEND_SLACK_SOL) * L));
      const spent = sol(-t.delta);
      await db.insert(solPositions).values({ agentId, mint: p.address, symbol: p.symbol, solIn: spent, openedAt: now }).onConflictDoNothing();
      await log(db, { agentId, kind: 'buy', mint: p.address, symbol: p.symbol, sol: spent, sig: t.sig, ok: true, at: now });
      left--;
      await say(s, agentId, `Put real SOL behind it: bought $${p.symbol} for ${fmt(size)} SOL. Not paper this time.`);
    } catch (e) {
      await log(db, { agentId, kind: 'buy', mint: p.address, symbol: p.symbol, sol: 0, sig: (e as { sig?: string }).sig ?? null, ok: false, error: (e as Error).message.slice(0, 300), at: now });
      state = { ...state, lastError: `buy $${p.symbol}: ${(e as Error).message.slice(0, 160)}` };
    }
  }
}

/**
 * Exit mode, once nothing sellable is left: every agent wallet and the house send what they have (less a fee) to the owner's
 * address. Returns the SOL sent.
 */
export async function returnPass(s: SolDeps, ids: string[]): Promise<number> {
  const { db } = s.d, now = s.d.now();
  if (!s.config.returnTo) return 0;
  const to = new PublicKey(s.config.returnTo);
  const open = await db.select().from(solPositions).where(inArray(solPositions.agentId, ids.length ? ids : ['']));
  if (open.some((p) => p.sellFails < SELL_FAILS_MAX)) return 0;
  let sent = 0;
  for (const id of [...ids, HOUSE]) {
    const [w] = await db.select({ publicKey: solWallets.publicKey }).from(solWallets).where(eq(solWallets.ownerId, id));
    if (!w) continue;
    const kp = await signer(db, id, s.key);
    const lamports = (await s.net.balance(kp.publicKey)) - 5000;
    if (lamports < 10_000) continue;
    try {
      const sig = await s.net.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports })), [kp]);
      if ((await s.net.confirm(sig)) === false) throw new Error('the transfer failed');
      await log(db, { agentId: id, kind: 'return', sol: sol(lamports), sig, ok: true, at: now });
      sent += sol(lamports);
    } catch (e) {
      await log(db, { agentId: id, kind: 'return', sol: sol(lamports), ok: false, error: (e as Error).message.slice(0, 300), at: now });
    }
  }
  if (sent) console.log(`[sol] exit: sent ${fmt(sent)} SOL back to ${s.config.returnTo}`);
  return sent;
}

/** A pass over every trading agent: funding first, then each one's trades (in exit mode: sell, then send it all back). One at a time. */
export function createSolDesk(s: SolDeps) {
  let busy = false;
  return {
    async tick(): Promise<void> {
      if (busy || s.config.mode === 'off') return;
      busy = true;
      try {
        const ids = await solAgents(s.d.db, s.config.agents);
        if (s.config.mode === 'on') await fundPass(s, ids).catch((e) => { state = { ...state, lastError: `funding: ${(e as Error).message.slice(0, 160)}` }; console.error('[sol] funding failed', (e as Error).message); });
        for (const id of ids) {
          if (s.d.busy?.has(id)) continue;
          await mirror(s, id).catch((e) => { state = { ...state, lastError: (e as Error).message.slice(0, 160) }; console.error('[sol] mirror failed', id, (e as Error).message); });
        }
        if (s.config.mode === 'exit') await returnPass(s, ids).catch((e) => console.error('[sol] return failed', (e as Error).message));
        const funded = ids.length ? (await s.d.db.select({ n: sql<number>`count(*)::int` }).from(solWallets).where(and(inArray(solWallets.ownerId, ids), sql`${solWallets.fundedAt} is not null`)))[0]?.n ?? 0 : 0;
        state = { ...state, mode: s.config.mode, agents: ids.length, funded: Number(funded), at: s.d.now().toISOString() };
      } finally { busy = false; }
    },
  };
}

/** The house wallet's address, made if needed: where the owner sends SOL. */
export async function houseAddress(db: Db, key: Buffer, now: Date): Promise<string> { return (await solWallet(db, HOUSE, key, now)).publicKey; }

/** An agent's real SOL wallet for its profile (no network read: the balance is what its trades add up to, before fees). */
export async function solView(db: Db, agentId: string): Promise<SolView | null> {
  const [w] = await db.select({ publicKey: solWallets.publicKey, fundedAt: solWallets.fundedAt }).from(solWallets).where(eq(solWallets.ownerId, agentId));
  if (!w) return null;
  const trades = await db.select().from(solTrades).where(eq(solTrades.agentId, agentId)).orderBy(desc(solTrades.at)).limit(30);
  const [sum] = await db.select({ n: sql<number>`coalesce(sum(case when ${solTrades.kind} in ('buy', 'return') then -${solTrades.sol} else ${solTrades.sol} end), 0)::float8` }).from(solTrades)
    .where(and(eq(solTrades.agentId, agentId), eq(solTrades.ok, true)));
  const positions = await db.select().from(solPositions).where(eq(solPositions.agentId, agentId));
  return {
    address: w.publicKey, funded: Boolean(w.fundedAt), solApprox: Number(sum?.n ?? 0),
    positions: positions.map((p) => ({ mint: p.mint, symbol: p.symbol, solIn: p.solIn, openedAt: p.openedAt.toISOString() })),
    trades: trades.map((t) => ({ kind: t.kind, symbol: t.symbol, sol: t.sol, sig: t.sig, ok: t.ok, error: t.error, at: t.at.toISOString() })),
  };
}
