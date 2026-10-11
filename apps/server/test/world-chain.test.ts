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

describe('MemoryChain matches the real curve (local validator run, 2026-10-11)', () => {
  it('charges about 0.0265 SOL to launch, as the real program does', async () => {
    const { c, a } = setup();
    const r = await c.launch(a, { name: 'Moth', symbol: 'MOTH', uri: 'u', initialBuyLamports: 0 });
    expect(-r.lamportsDelta).toBeGreaterThan(26_000_000);
    expect(-r.lamportsDelta).toBeLessThan(27_000_000);
  });
  it('fills a buy that overshoots the curve only up to its threshold, refunds the rest, and graduates the coin', async () => {
    const { c, a } = setup();
    const whale = Keypair.generate();
    c.airdrop(whale.publicKey.toBase58(), 5 * SOL);
    const { mint } = await c.launch(a, { name: 'Moth', symbol: 'MOTH', uri: 'u', initialBuyLamports: 0 });
    const r = await c.buy(whale, mint, 4 * SOL, 500);
    expect(-r.lamportsDelta).toBeLessThan(2.75 * SOL); // 2.688 SOL threshold + 1% fee + tx fee
    expect(-r.lamportsDelta).toBeGreaterThan(2.7 * SOL);
    expect((await c.balances(whale.publicKey.toBase58())).lamports).toBe(5 * SOL + r.lamportsDelta);
    expect(await c.curve(mint)).toMatchObject({ curveProgress: 1, graduated: true });
    await expect(c.buy(whale, mint, SOL / 100, 500)).rejects.toMatchObject({ code: 'GRADUATED' });
  });
});
