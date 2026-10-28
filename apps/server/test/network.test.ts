import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { networkOf } from '../src/world/network.ts';

/** SOLANA_NETWORK (2026-10-28 brief §4): devnet by default, mainnet behind the switch, every RPC chosen in one place. */
describe('SOLANA_NETWORK', () => {
  it('defaults to devnet on the public devnet endpoint, with the start grant and no real money', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.solanaNetwork).toBe('devnet');
    expect(c.rpc.devnet).toBe('https://api.devnet.solana.com');
    expect(c.external.startLamports).toBe(50_000_000);
    expect(networkOf(c)).toMatchObject({ name: 'devnet', rpcUrl: 'https://api.devnet.solana.com', realMoney: false });
  });

  it('mainnet means real trading, real SOL trading on, no free starting SOL', () => {
    const c = loadConfig({ NODE_ENV: 'test', SOLANA_NETWORK: 'mainnet', SOLANA_MAINNET_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x' });
    expect(c.solanaNetwork).toBe('mainnet');
    expect(c.tradingMode).toBe('real');
    expect(c.solTrading.on).toBe(true);
    expect(c.solTrading.rpcUrl).toBe('https://mainnet.helius-rpc.com/?api-key=x');
    expect(c.external.startLamports).toBe(0);
    expect(networkOf(c)).toMatchObject({ name: 'mainnet', realMoney: true, rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=x' });
  });

  it('keeps SOL_TRADING=off as the kill switch on mainnet', () => {
    expect(loadConfig({ NODE_ENV: 'test', SOLANA_NETWORK: 'mainnet', SOLANA_MAINNET_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x', SOL_TRADING: 'off' }).solTrading.on).toBe(false);
  });

  it('refuses an unknown network and a devnet RPC given as the mainnet one', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', SOLANA_NETWORK: 'testnet' })).toThrow(/SOLANA_NETWORK/);
    expect(() => loadConfig({ NODE_ENV: 'test', SOLANA_NETWORK: 'mainnet', SOLANA_MAINNET_RPC_URL: 'https://api.devnet.solana.com' })).toThrow(/SOLANA_MAINNET_RPC_URL/);
  });

  it('takes the devnet RPC from SOLANA_DEVNET_RPC_URL first, then the old names', () => {
    expect(loadConfig({ NODE_ENV: 'test', SOLANA_DEVNET_RPC_URL: 'https://devnet.example/rpc', DEVNET_RPC_URL: 'https://old.example' }).rpc.devnet).toBe('https://devnet.example/rpc');
    expect(loadConfig({ NODE_ENV: 'test', DEVNET_RPC_URL: 'https://old.example' }).devnetRpcUrl).toBe('https://old.example');
  });

  it('links transactions and addresses to the right explorer cluster', () => {
    const dev = networkOf(loadConfig({ NODE_ENV: 'test' }));
    expect(dev.explorerTx('abc')).toBe('https://solscan.io/tx/abc?cluster=devnet');
    const main = networkOf(loadConfig({ NODE_ENV: 'test', SOLANA_NETWORK: 'mainnet', SOLANA_MAINNET_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=x' }));
    expect(main.explorerAddress('xyz')).toBe('https://solscan.io/account/xyz');
  });
});
