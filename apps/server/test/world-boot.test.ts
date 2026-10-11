import { describe, it, expect } from 'vitest';
import { makeTestApp } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { bootAgents } from '../src/world/boot.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { MemoryChain } from '../src/world/chain.ts';
import { DevnetChain } from '../src/world/devnet-chain.ts';
import { seedWorld } from '../src/world/seed.ts';
import { worldNotReady } from '../src/world/boot.ts';
import { wallets } from '../src/db/schema.ts';
import { Connection } from '@solana/web3.js';

const worldConfig = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 's', WORLD_CHAIN: 'memory', WORLD_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', ...extra });

describe('bootAgents', () => {
  it('boots inside the main app and serves the agents next to the social routes', async () => {
    const t = await makeTestApp({ config: worldConfig() });
    const world = await bootAgents(t.app, { bus: null });
    expect((await t.app.inject({ method: 'GET', url: '/api/world/info' })).json()).toMatchObject({ network: 'memory', agents: 50 });
    const human = await t.createUser('somehuman');
    expect((await t.as(human).post('/api/posts', { body: 'humans and agents, one site' })).status).toBe(201);
    await world.stop();
    await t.close();
  });
  it('reports the runtime as on when AGENTS=on and a brain is available', async () => {
    const t = await makeTestApp({ config: worldConfig({ AGENTS: 'on' }) });
    const world = await bootAgents(t.app, { bus: null, brain: new FakeBrain(() => fakeReply.end()) });
    expect((await t.app.inject({ method: 'GET', url: '/api/world/info' })).json()).toMatchObject({ runtime: 'on' });
    await world.stop();
    await t.close();
  });
  it('boots on devnet before the launchpad exists, and keeps the agents waiting (first deploy, unfunded treasury)', async () => {
    const t = await makeTestApp({ config: worldConfig({ WORLD_CHAIN: 'devnet', DEVNET_RPC_URL: 'http://127.0.0.1:9', AGENTS: 'on' }) });
    const world = await bootAgents(t.app, { bus: null, brain: new FakeBrain(() => fakeReply.end()) });
    expect((await t.app.inject({ method: 'GET', url: '/api/world/info' })).json()).toMatchObject({ runtime: 'off', network: 'devnet' });
    expect(world.runtime).toBeNull();
    await world.stop();
    await t.close();
  });
});

describe('worldNotReady', () => {
  const key = Buffer.from('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', 'base64');
  it('names the launchpad when a devnet chain has none, then the funding, then nothing', async () => {
    const t = await makeTestApp({ config: worldConfig() });
    await seedWorld(t.db, { now: new Date(), worldKey: key, adminPassword: undefined });
    const conn = new Connection('http://127.0.0.1:9');
    expect(await worldNotReady(t.db, new DevnetChain(conn, null))).toMatch(/launchpad/);
    expect(await worldNotReady(t.db, new MemoryChain())).toMatch(/fund/);
    await t.db.update(wallets).set({ fundedAt: new Date() });
    expect(await worldNotReady(t.db, new MemoryChain())).toBeNull();
    await t.close();
  });
  it('makes coin actions fail with NO_LAUNCHPAD instead of crashing when there is no launchpad', async () => {
    const chain = new DevnetChain(new Connection('http://127.0.0.1:9'), null);
    await expect(chain.curve('So11111111111111111111111111111111111111112')).rejects.toMatchObject({ code: 'NO_LAUNCHPAD' });
  });
});