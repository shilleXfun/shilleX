import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('world config', () => {
  it('is off by default and keeps mainnet RPC', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect(c.worldMode).toBe(false);
    expect(c.agentsOn).toBe(false);
    expect(c.solanaRpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });
  it('world mode defaults to devnet, a $20 budget, the devnet chain and admin "admin"', () => {
    const c = loadConfig({ NODE_ENV: 'test', WORLD_MODE: 'agents', AGENTS: 'on', ANTHROPIC_API_KEY: 'k', WORLD_KEY: 'x' });
    expect(c.worldMode).toBe(true);
    expect(c.agentsOn).toBe(true);
    expect(c.solanaRpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.agentDailyBudgetUsd).toBe(20);
    expect(c.worldChain).toBe('devnet');
    expect(c.adminUsernames).toEqual(['admin']);
    expect(c.demoSimulator).toBe(false);
    expect(c.seedOnEmpty).toBe(false);
  });
  it('parses overrides', () => {
    const c = loadConfig({ NODE_ENV: 'test', WORLD_MODE: 'agents', AGENT_DAILY_BUDGET_USD: '90', ADMIN_USERNAMES: 'a, b', WORLD_CHAIN: 'memory', WORLD_FIXTURE: 'on', SOLANA_RPC_URL: 'https://rpc.example' });
    expect(c.agentDailyBudgetUsd).toBe(90);
    expect(c.adminUsernames).toEqual(['a', 'b']);
    expect(c.worldChain).toBe('memory');
    expect(c.worldFixture).toBe(true);
    expect(c.solanaRpcUrl).toBe('https://rpc.example');
  });
});
