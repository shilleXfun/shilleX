import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.ts';

describe('agents config', () => {
  it('has no world mode; agents are off by default and the token lookup stays on mainnet', () => {
    const c = loadConfig({ NODE_ENV: 'test' });
    expect('worldMode' in c).toBe(false);
    expect(c.agentsOn).toBe(false);
    expect(c.solanaRpcUrl).toBe('https://api.mainnet-beta.solana.com');
    expect(c.devnetRpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.agentDailyBudgetUsd).toBe(1);
    expect(c.hideDemo).toBe(false);
    expect(c.openaiImageModel).toBe('gpt-image-1');
    expect(c.imageDailyBudgetUsd).toBe(2);
    expect(c.llmBudgetPer12hUsd).toBe(4);
    expect(c.brainKillSwitch).toBe(false);
    // Launch day raises the number; nothing raises it past the ceiling.
    expect(loadConfig({ NODE_ENV: 'test', LLM_BUDGET_USD_PER_12H: '900', IMAGE_BUDGET_USD_PER_DAY: '3', BRAIN_KILL_SWITCH: 'true' })).toMatchObject({ llmBudgetPer12hUsd: 50, imageDailyBudgetUsd: 3, brainKillSwitch: true });
    expect(c.imageDailyMax).toBe(15);
    expect(c.engineTickMs).toEqual([2000, 6000]);
  });
  it('AGENTS=on hides demo content by default and turns the demo simulator and demo seed off', () => {
    const c = loadConfig({ NODE_ENV: 'development', AGENTS: 'on', WORLD_KEY: 'x' });
    expect(c.agentsOn).toBe(true);
    expect(c.hideDemo).toBe(true);
    expect(c.demoSimulator).toBe(false);
    expect(c.seedOnEmpty).toBe(false);
  });
  it('parses overrides', () => {
    const c = loadConfig({
      NODE_ENV: 'test', AGENTS: 'on', HIDE_DEMO: 'off', AGENT_DAILY_BUDGET_USD: '0.5', DEVNET_RPC_URL: 'https://dev.example',
      OPENAI_API_KEY: 'sk-x', OPENAI_IMAGE_MODEL: 'img-2', IMAGE_DAILY_BUDGET_USD: '2', IMAGE_DAILY_MAX: '3', ENGINE_TICK_MS: '100,200',
      WORLD_CHAIN: 'memory', ADMIN_USERNAMES: 'a, b',
    });
    expect(c.hideDemo).toBe(false);
    expect(c.agentDailyBudgetUsd).toBe(0.5);
    expect(c.devnetRpcUrl).toBe('https://dev.example');
    expect(c.openaiApiKey).toBe('sk-x');
    expect(c.openaiImageModel).toBe('img-2');
    expect(c.imageDailyBudgetUsd).toBe(2);
    expect(c.imageDailyMax).toBe(3);
    expect(c.engineTickMs).toEqual([100, 200]);
    expect(c.worldChain).toBe('memory');
    expect(c.adminUsernames).toEqual(['a', 'b']);
  });
});
