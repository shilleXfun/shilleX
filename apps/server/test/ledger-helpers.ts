import { randomBytes } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { depthTestCtx } from './depth-helpers.ts';
import { FakeRpc } from './ledger-fakes.ts';
import { loadConfig } from '../src/config.ts';
import { LedgerChain } from '../src/ledger/ledger-chain.ts';
import { DEFAULT_RULES, type LedgerRules } from '../src/ledger/rules.ts';
import { Custody, capsFromConfig, type CustodyDeps } from '../src/ledger/custody.ts';
import { acceptNotice, publishNotice } from '../src/ledger/consent.ts';
import { signerFor, walletOf } from '../src/world/wallets.ts';

/** A seeded 50-agent world whose EngineDeps run on a LedgerChain; `fund(i, sol)` credits agent i from outside. */
export async function ledgerCtx(rules: Partial<LedgerRules> = {}) {
  const w = await depthTestCtx();
  const chain = new LedgerChain(w.t.db, w.t.clock.now, { ...DEFAULT_RULES, ...rules });
  w.d.chain = chain;
  const pk = async (i: number) => (await walletOf(w.t.db, w.agents[i]!.id))!.publicKey;
  const signer = (i: number) => signerFor(w.t.db, w.agents[i]!.id, w.key);
  let n = 0;
  const fund = async (i: number, sol: number) => chain.credit(await pk(i), Math.round(sol * 1e9), 'deposit', `test-deposit-${++n}`);
  return { ...w, chain, pk, signer, fund };
}

/** A ledger world with custody on a FakeRpc (devnet genesis), a cold address, and one owner who accepted the notice and has a payout wallet. */
export async function custodyCtx(over: Partial<CustodyDeps> = {}, env: Record<string, string> = {}) {
  const c = await ledgerCtx();
  const rpc = new FakeRpc();
  const payouts = new Map<string, string>();
  const notes: string[] = [];
  const cold = Keypair.generate().publicKey.toBase58();
  const custody = new Custody({
    db: c.t.db, rpc, key: randomBytes(32), network: 'devnet', cold, caps: capsFromConfig(loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', ...env })),
    now: c.t.clock.now, chain: c.chain, worldKey: c.key, payoutOf: async (u) => payouts.get(u) ?? null,
    notify: async (_u, _a, s) => { notes.push(s); }, ...over,
  });
  const owner = await c.t.createUser('owner1');
  await publishNotice(c.t.db, 'Reviewed: test position.', c.t.clock.now());
  await acceptNotice(c.t.db, owner.id, 'n1', true, c.t.clock.now());
  const payer = Keypair.generate().publicKey.toBase58();
  payouts.set(owner.id, payer);
  return { ...c, rpc, custody, owner, payer, payouts, cold, notes, agentId: c.agents[0]!.id };
}
