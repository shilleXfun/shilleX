import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ledgerCtx } from './ledger-helpers.ts';
import { ledgerJournal } from '../src/db/schema.ts';
import { books } from '../src/ledger/books.ts';
import { HOUSE } from '../src/ledger/accounts.ts';
import { quoteBuy, quoteSell } from '../src/ledger/curve.ts';

const SOL = 1e9;
let c: Awaited<ReturnType<typeof ledgerCtx>>;
afterEach(async () => { await c.t.close(); });

describe('LedgerChain', () => {
  it('credits from outside with a journal pair, and the books balance', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.2);
    expect(await c.chain.balances(await c.pk(0))).toEqual({ lamports: 0.2 * SOL, tokens: [] });
    const rows = await c.t.db.select().from(ledgerJournal);
    expect(rows.map((r) => r.lamportsDelta).sort((a, b) => a - b)).toEqual([-0.2 * SOL, 0.2 * SOL]);
    expect(await books(c.t.db)).toMatchObject({ ok: true, ledgerTotal: 0.2 * SOL, externalNet: -0.2 * SOL, mismatches: [] });
  });

  it('launches for a flat 0.01 SOL to the house, with a first buy on the curve', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.1);
    const r = await c.chain.launch(await c.signer(0), { name: 'Moth', symbol: 'MOTH', uri: 'u', initialBuyLamports: 0.02 * SOL });
    const q = quoteBuy({ sol: 0, sold: 0 }, 0.02 * SOL);
    const houseFee = Math.floor((q.spent * 50) / 10_000);
    expect(r.signature).toMatch(/^ldg_/);
    expect(r.tokenDelta).toBe(q.out);
    // The creator gets its own creator share of the 1% back; the house keeps its 0.5% plus the launch fee.
    expect(r.lamportsDelta).toBe(-(0.01 * SOL) - q.spent + (q.fee - houseFee));
    expect((await c.chain.balances(HOUSE)).lamports).toBe(0.01 * SOL + houseFee);
    expect(await c.chain.curve(r.mint)).toMatchObject({ quoteReserveLamports: q.net, graduated: false });
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('buys and sells on the curve, paying the coin’s creator its share of the fee', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.1); await c.fund(1, 0.1);
    const { mint } = await c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 });
    const creatorBefore = (await c.chain.balances(await c.pk(0))).lamports;
    const b = await c.chain.buy(await c.signer(1), mint, 0.03 * SOL, 0);
    const qb = quoteBuy({ sol: 0, sold: 0 }, 0.03 * SOL);
    expect(b).toMatchObject({ lamportsDelta: -qb.spent, tokenDelta: qb.out, feeLamports: 0 });
    expect((await c.chain.balances(await c.pk(0))).lamports - creatorBefore).toBe(qb.fee - Math.floor((qb.spent * 50) / 10_000));
    const s = await c.chain.sell(await c.signer(1), mint, Math.floor(qb.out / 2), 0);
    const qs = quoteSell({ sol: qb.net, sold: qb.out }, Math.floor(qb.out / 2));
    expect(s).toMatchObject({ lamportsDelta: qs.out, tokenDelta: -Math.floor(qb.out / 2) });
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('sends SOL from one agent to another', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.1);
    const r = await c.chain.sendSol(await c.signer(0), await c.pk(1), 0.01 * SOL);
    expect(r).toMatchObject({ feeLamports: 0 });
    expect((await c.chain.balances(await c.pk(1))).lamports).toBe(0.01 * SOL);
  });

  it('refuses what the wallet cannot cover, and writes nothing', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.005);
    const before = (await c.t.db.select().from(ledgerJournal)).length;
    await expect(c.chain.launch(await c.signer(0), { name: 'X', symbol: 'X', uri: 'u', initialBuyLamports: 0 })).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect((await c.t.db.select().from(ledgerJournal)).length).toBe(before);
    expect((await books(c.t.db)).ok).toBe(true);
  });

  it('refuses a key that is not an agent wallet', async () => {
    c = await ledgerCtx();
    await expect(c.chain.buy(Keypair.generate(), 'nope', 1000, 0)).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
  });

  it('keeps the books balanced under concurrent trades on one coin (review focus 3)', async () => {
    c = await ledgerCtx();
    for (let i = 0; i < 13; i++) await c.fund(i, 0.1);
    const { mint } = await c.chain.launch(await c.signer(0), { name: 'Hot', symbol: 'HOT', uri: 'u', initialBuyLamports: 0 });
    const signers = await Promise.all(Array.from({ length: 12 }, (_, i) => c.signer(i + 1)));
    const buys = await Promise.allSettled(signers.map((s) => c.chain.buy(s, mint, 0.03 * SOL, 0)));
    expect(buys.every((r) => r.status === 'fulfilled')).toBe(true);
    const sells = await Promise.allSettled(signers.slice(0, 6).map(async (s) => {
      const held = (await c.chain.balances(s.publicKey.toBase58())).tokens[0]!.raw;
      return c.chain.sell(s, mint, Math.floor(held / 2), 0);
    }));
    expect(sells.every((r) => r.status === 'fulfilled')).toBe(true);
    const b = await books(c.t.db);
    expect(b).toMatchObject({ ok: true, mismatches: [] });
    expect(b.ledgerTotal).toBe(13 * 0.1 * SOL);
    for (let i = 0; i < 13; i++) expect((await c.chain.balances(await c.pk(i))).lamports).toBeGreaterThanOrEqual(0);
  });
});
