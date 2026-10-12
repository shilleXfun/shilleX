import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

import { Keypair, PublicKey, TransactionExpiredBlockheightExceededError, type Connection } from '@solana/web3.js';
import { DevnetChain } from '../src/world/devnet-chain.ts';

/** Fake RPC: the first confirmation times out although the transaction landed. */
function fakeConnection(landed: boolean) {
  const sent: string[] = [];
  let confirms = 0;
  const conn = {
    getGenesisHash: async () => DEVNET_GENESIS,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    sendRawTransaction: async () => { const sig = `sig${sent.length + 1}`; sent.push(sig); return sig; },
    confirmTransaction: async (s: { signature: string }) => { if (confirms++ === 0) throw new TransactionExpiredBlockheightExceededError(s.signature); return { value: { err: null } }; },
    getSignatureStatuses: async () => ({ value: [landed ? { confirmationStatus: 'confirmed', err: null } : null] }),
    getParsedTransaction: async () => null,
  } as unknown as Connection;
  return { conn, sent };
}

describe('DevnetChain sending (review fix)', () => {
  it('does not resend a transaction that landed after its confirmation timed out', async () => {
    const { conn, sent } = fakeConnection(true);
    const chain = new DevnetChain(conn, new PublicKey(Keypair.generate().publicKey));
    const r = await chain.sendSol(Keypair.generate(), Keypair.generate().publicKey.toBase58(), 1000);
    expect(sent).toEqual(['sig1']);
    expect(r.signature).toBe('sig1');
  });
  it('resends once when the expired transaction never landed', async () => {
    const { conn, sent } = fakeConnection(false);
    const chain = new DevnetChain(conn, new PublicKey(Keypair.generate().publicKey));
    const r = await chain.sendSol(Keypair.generate(), Keypair.generate().publicKey.toBase58(), 1000);
    expect(sent).toEqual(['sig1', 'sig2']);
    expect(r.signature).toBe('sig2');
  });
});

import { MAINNET_GENESIS, makeChain, toChainError } from '../src/world/devnet-chain.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { loadConfig } from '../src/config.ts';
import type { DbHandle } from '../src/db/client.ts';
import { testDb } from './helpers.ts';

/** Solana devnet's genesis hash. */
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

// Messages as the local validator returned them (2026-10-11 run against the cloned DBC program).
const simFail = (logs: string[]) => `Simulation failed. \nMessage: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1. \nLogs: \n${JSON.stringify(logs, null, 2)}. \nCatch the \`SendTransactionError\` and call \`getLogs()\` on it for full details.`;

describe('toChainError (local validator findings)', () => {
  it('says how much SOL the wallet has and needs, without the log dump', () => {
    const e = toChainError(new Error(simFail(['Program 11111111111111111111111111111111 invoke [1]', 'Transfer: insufficient lamports 89990000, need 5000000000', 'Program 11111111111111111111111111111111 failed: custom program error: 0x1'])));
    expect(e.code).toBe('INSUFFICIENT_FUNDS');
    expect(e.message).toBe('Not enough SOL: the wallet has 0.08999 SOL and this needs 5 SOL plus fees');
  });
  it('reports selling more tokens than the wallet holds as INSUFFICIENT_TOKENS', () => {
    const e = toChainError(new Error(simFail(['Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]', 'Program log: Instruction: Swap', 'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]', 'Program log: Error: insufficient funds', 'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1'])));
    expect(e.code).toBe('INSUFFICIENT_TOKENS');
    expect(e.message).toBe('Not enough tokens: the wallet holds fewer than this sale needs');
  });
  it('treats a wallet that cannot pay the fee as out of SOL', () => {
    const e = toChainError(new Error('Simulation failed. \nMessage: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.. \nLogs: \n[]. '));
    expect(e).toMatchObject({ code: 'INSUFFICIENT_FUNDS', message: 'Not enough SOL to pay the transaction fee' });
  });
  it('keeps an Anchor error message and drops the logs', () => {
    const e = toChainError(new Error(simFail(['Program log: AnchorError occurred. Error Code: PoolIsCompleted. Error Number: 6029. Error Message: Pool is completed.'])));
    expect(e).toMatchObject({ code: 'GRADUATED', message: 'This coin graduated: its curve is complete and it can no longer be traded here' });
  });
  it('maps an exceeded slippage limit to SLIPPAGE with a short message', () => {
    const e = toChainError(new Error(simFail(['Program log: AnchorError occurred. Error Code: ExceededSlippage. Error Number: 6003. Error Message: Exceeded slippage tolerance.'])));
    expect(e).toMatchObject({ code: 'SLIPPAGE', message: 'The price moved past your slippage limit; nothing was traded' });
  });
  it('shortens anything else to the first line, with no logs', () => {
    const e = toChainError(new Error(simFail(['Program log: AnchorError occurred. Error Code: MathOverflow. Error Number: 6000. Error Message: Math operation overflow.'])));
    expect(e.code).toBe('TX_FAILED');
    expect(e.message).toBe('Transaction failed: Math operation overflow.');
    expect(toChainError(new Error('socket hang up')).message).toBe('Transaction failed: socket hang up');
  });
});

describe('makeChain refuses Solana mainnet (defence in depth for devnet only)', () => {
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'devnet', DEVNET_RPC_URL: 'http://rpc.example' });
  /** A stubbed RPC answering getGenesisHash from `answers` in turn (an Error is thrown, as by an unreachable RPC). */
  function rpc(...answers: (string | Error)[]) {
    const sent: string[] = [];
    const urls: string[] = [];
    let n = 0;
    const conn = {
      getGenesisHash: async () => { const a = answers[Math.min(n++, answers.length - 1)]!; if (a instanceof Error) throw a; return a; },
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
      sendRawTransaction: async () => { sent.push('sig'); return 'sig'; },
      confirmTransaction: async () => ({ value: { err: null } }),
      getParsedTransaction: async () => null,
    } as unknown as Connection;
    return { connect: (url: string) => { urls.push(url); return conn; }, sent, urls };
  }
  let h: DbHandle;
  beforeAll(async () => { h = await testDb(); });
  afterAll(() => h.close());

  it('refuses to start when DEVNET_RPC_URL serves mainnet-beta', async () => {
    const r = rpc(MAINNET_GENESIS);
    await expect(makeChain(config, h.db, r.connect)).rejects.toThrow(/mainnet/);
    expect(r.urls).toEqual(['http://rpc.example']);
  });
  it('starts on devnet and on a local validator (any other genesis)', async () => {
    expect(await makeChain(config, h.db, rpc(DEVNET_GENESIS).connect)).toBeInstanceOf(DevnetChain);
    expect(await makeChain(config, h.db, rpc(Keypair.generate().publicKey.toBase58()).connect)).toBeInstanceOf(DevnetChain);
  });
  it('starts when the RPC cannot be reached, and checks again before the first transaction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const r = rpc(new Error('fetch failed'), MAINNET_GENESIS);
      const chain = await makeChain(config, h.db, r.connect) as DevnetChain;
      expect(warn).toHaveBeenCalled();
      await expect(chain.sendSol(Keypair.generate(), Keypair.generate().publicKey.toBase58(), 1000)).rejects.toMatchObject({ code: 'WRONG_NETWORK' });
      expect(r.sent).toEqual([]);
    } finally { warn.mockRestore(); }
  });
  it('asks once: a checked devnet RPC is not asked again on every send', async () => {
    const r = rpc(DEVNET_GENESIS, MAINNET_GENESIS);
    const chain = await makeChain(config, h.db, r.connect) as DevnetChain;
    await chain.sendSol(Keypair.generate(), Keypair.generate().publicKey.toBase58(), 1000);
    expect(r.sent).toEqual(['sig']);
  });
  it('never asks a memory chain', async () => {
    const r = rpc(MAINNET_GENESIS);
    expect(await makeChain({ ...config, worldChain: 'memory' }, h.db, r.connect)).toBeInstanceOf(MemoryChain);
    expect(r.urls).toEqual([]);
  });
});
