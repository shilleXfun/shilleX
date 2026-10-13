import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { CURVE } from '../src/world/chain.ts';

const base = { NODE_ENV: 'test', SESSION_SECRET: 's' };

describe('mainnet config', () => {
  it('is off by default, with the spec’s safeguard defaults', () => {
    const c = loadConfig(base);
    expect(c.mainnet).toBe('off');
    expect(c.worldChain).toBe('devnet');
    expect(c.custodyLocal).toBe(false);
    expect(c.mainnetLimits).toEqual({
      hotMaxSol: 3, outflowDailyMaxSol: 5, agentCapSol: 0.5, agentDailyCapSol: 0.1, userMonthlyCapSol: 1, worldCapSol: 25, houseFeeBps: 50, maxTradeSol: 0.05,
    });
  });
  it('selects the ledger chain', () => {
    expect(loadConfig({ ...base, WORLD_CHAIN: 'ledger' }).worldChain).toBe('ledger');
  });
  it('refuses rehearsal or on without the ledger chain', () => {
    expect(() => loadConfig({ ...base, MAINNET: 'rehearsal' })).toThrow(/WORLD_CHAIN=ledger/);
    expect(() => loadConfig({ ...base, MAINNET: 'on', WORLD_CHAIN: 'devnet' })).toThrow(/WORLD_CHAIN=ledger/);
  });
  it('refuses an unknown MAINNET value instead of guessing', () => {
    expect(() => loadConfig({ ...base, MAINNET: 'true', WORLD_CHAIN: 'ledger' })).toThrow(/off, rehearsal or on/);
  });
  it('reads every override', () => {
    const c = loadConfig({
      ...base, WORLD_CHAIN: 'ledger', MAINNET: 'rehearsal', MAINNET_KEY: 'k', MAINNET_RPC_URL: 'https://rpc.example', MAINNET_COLD_ADDRESS: 'Cold',
      HOT_MAX_SOL: '2', OUTFLOW_DAILY_MAX_SOL: '4', MAINNET_AGENT_CAP_SOL: '0.4', MAINNET_AGENT_DAILY_CAP_SOL: '0.05', MAINNET_USER_MONTHLY_CAP_SOL: '0.9',
      MAINNET_WORLD_CAP_SOL: '10', MAINNET_HOUSE_FEE_BPS: '0', MAINNET_MAX_TRADE_SOL: '0.02', MAINNET_CUSTODY_LOCAL: 'on',
    });
    expect(c).toMatchObject({ mainnet: 'rehearsal', mainnetKey: 'k', mainnetRpcUrl: 'https://rpc.example', coldAddress: 'Cold', custodyLocal: true });
    expect(c.mainnetLimits).toEqual({ hotMaxSol: 2, outflowDailyMaxSol: 4, agentCapSol: 0.4, agentDailyCapSol: 0.05, userMonthlyCapSol: 0.9, worldCapSol: 10, houseFeeBps: 0, maxTradeSol: 0.02 });
  });
  it('never allows local custody in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'prod-secret', MAINNET_CUSTODY_LOCAL: 'on' }).custodyLocal).toBe(false);
  });
  it('shares the curve constants', () => {
    expect(CURVE).toEqual({ V_SOL: 1_000_000_000, V_TOKENS: 1_073_000_000_000_000, CURVE_TOKENS: 793_100_000_000_000, GRADUATE_AT: 2_688_110_852, TRADE_FEE_BPS: 100 });
  });
});
