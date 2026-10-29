import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import { mainnetMeter } from './rpc-meter.ts';

/**
 * Everything real SOL touches on the network (2026-10-27): mainnet balances and token holdings, PumpPortal's unsigned trade
 * transactions, simulation, sending and confirming. An interface, so tests stand in for the chain.
 */
export interface SolNet {
  balances(addresses: string[]): Promise<Map<string, number>>;
  /** The wallet's tokens of a mint, in whole tokens (0 when it holds none). */
  tokens(owner: string, mint: string): Promise<number>;
  /** True when the mint has at least `min` holders (Helius DAS); null when the RPC cannot say. */
  hasHolders(mint: string, min: number): Promise<boolean | null>;
  /** PumpPortal's unsigned transaction for a trade. */
  quote(body: Record<string, unknown>): Promise<VersionedTransaction>;
  /** The wallet's lamports after the transaction, as a simulation says; throws when it would fail. */
  simulate(tx: VersionedTransaction, wallet: PublicKey): Promise<number>;
  send(tx: VersionedTransaction | Transaction, signers: Keypair[]): Promise<string>;
  /** True once confirmed, false if it failed, null if it is still unknown after the wait. */
  confirm(sig: string): Promise<boolean | null>;
  /** A recent blockhash, for a transaction someone else signs (the owner's wallet funding agents). */
  blockhash?(): Promise<string>;
}

const PUMPPORTAL = 'https://pumpportal.fun/api/trade-local';
export const SLIPPAGE_PCT = 15, PRIORITY_FEE_SOL = 0.00005;
/** Pools PumpPortal trades (pool "auto"), as DexScreener names their dexes. */
export const TRADABLE_DEXES = new Set(['pumpfun', 'pumpswap', 'raydium', 'launchlab']);
export const PUMP_DEXES = new Set(['pumpfun', 'pumpswap']);

export function solNet(rpcUrl: string, fetchImpl: typeof fetch = fetch): SolNet {
  // Every mainnet call is counted ([rpc mainnet] hourly, /api/health/world); balances are read 100 wallets per request.
  const counted = mainnetMeter().fetch;
  const conn = new Connection(rpcUrl, { commitment: 'confirmed', fetch: counted });
  return {
    async balances(addresses) {
      const out = new Map<string, number>();
      for (let i = 0; i < addresses.length; i += 100) {
        const chunk = addresses.slice(i, i + 100);
        const infos = await conn.getMultipleAccountsInfo(chunk.map((a) => new PublicKey(a)), 'confirmed');
        chunk.forEach((a, j) => out.set(a, infos[j]?.lamports ?? 0));
      }
      return out;
    },
    async tokens(owner, mint) {
      const r = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, 'confirmed');
      return r.value.reduce((n, a) => n + Number((a.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } }).parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
    },
    async hasHolders(mint, min) {
      try {
        const res = await counted(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccounts', params: { mint, limit: Math.min(1000, Math.max(1, Math.ceil(min))), page: 1 } }) });
        const j = await res.json() as { result?: { total?: number } };
        return typeof j.result?.total === 'number' ? j.result.total >= Math.min(1000, min) : null;
      } catch { return null; }
    },
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
    async blockhash() { return (await conn.getLatestBlockhash('confirmed')).blockhash; },
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

const sol = (lamports: number) => lamports / 1e9;

/**
 * One trade through PumpPortal: quote, simulate, refuse if it would take more than `maxSpend` lamports from the wallet, send,
 * confirm. Returns the lamports the wallet gained (negative: spent), from its balance before and after.
 */
export async function pumpTrade(net: SolNet, kp: Keypair, body: { action: 'buy' | 'sell'; mint: string; amount: number | string; denominatedInSol: 'true' | 'false' }, maxSpend: number): Promise<{ sig: string; delta: number }> {
  const me = kp.publicKey.toBase58();
  const before = (await net.balances([me])).get(me) ?? 0;
  const tx = await net.quote({ publicKey: me, ...body, slippage: SLIPPAGE_PCT, priorityFee: PRIORITY_FEE_SOL, pool: 'auto' });
  const after = await net.simulate(tx, kp.publicKey);
  if (before - after > maxSpend) throw new Error(`refused: it would take ${sol(before - after).toFixed(4)} SOL, more than ${sol(maxSpend).toFixed(4)}`);
  const sig = await net.send(tx, [kp]);
  const ok = await net.confirm(sig);
  const now = (await net.balances([me])).get(me) ?? 0;
  // Unknown after the wait: the balance says whether it went through.
  if (ok === false || (ok === null && Math.abs(now - before) < 10_000)) throw Object.assign(new Error('the transaction did not go through'), { sig });
  return { sig, delta: now - before };
}

/** Transfers per funding transaction: about 46 bytes each, so 18 stay well inside a transaction's 1,232 bytes. */
export const FUND_PER_TX = 18;

/**
 * Unsigned transactions that send `lamports` from `from` to each address, FUND_PER_TX at a time, paid and signed by `from`
 * (its owner's wallet, in the browser). Shillex holds no key to them and never sends them itself.
 */
export function fundingTransactions(from: string, to: string[], lamports: number, blockhash: string): string[] {
  const payer = new PublicKey(from), out: string[] = [];
  for (let i = 0; i < to.length; i += FUND_PER_TX) {
    const tx = new Transaction({ feePayer: payer, recentBlockhash: blockhash });
    for (const a of to.slice(i, i + FUND_PER_TX)) tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(a), lamports }));
    out.push(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'));
  }
  return out;
}

/** A plain SOL transfer; returns its signature once confirmed. */
export async function transferSol(net: SolNet, from: Keypair, to: string, lamports: number): Promise<string> {
  const sig = await net.send(new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: new PublicKey(to), lamports })), [from]);
  if ((await net.confirm(sig)) === false) throw Object.assign(new Error('the transfer failed'), { sig });
  return sig;
}
