import { depthTestCtx } from './depth-helpers.ts';
import { LedgerChain } from '../src/ledger/ledger-chain.ts';
import { DEFAULT_RULES, type LedgerRules } from '../src/ledger/rules.ts';
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
