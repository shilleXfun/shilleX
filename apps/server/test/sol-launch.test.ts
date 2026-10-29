import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import type { VersionedTransaction } from '@solana/web3.js';
import { testDb } from './helpers.ts';
import { agents, solTrades, users, worldSettings } from '../src/db/schema.ts';
import { HOUSE_LAUNCH_KEY, houseLaunchFree, launchCoin, type LaunchDeps } from '../src/world/sol-launch.ts';
import { shillexCoin } from '../src/world/sol-trade.ts';
import type { SolNet } from '../src/world/sol-net.ts';

/**
 * Real coin launches (owner, 2026-10-29): only with MAINNET_LAUNCH on, one for the whole house pack, no first buy, the agent's
 * face as the picture, and a launched coin is one no Shillex agent may buy.
 */
function fakeNet(o: { failUpload?: boolean; spend?: number } = {}) {
  let bal = 100_000_000;
  const seen: { uploads: { name: string; symbol: string; png: number }[]; bodies: Record<string, unknown>[]; signers: number[] } = { uploads: [], bodies: [], signers: [] };
  const net: SolNet = {
    balances: async (a) => new Map(a.map((x) => [x, bal])),
    tokens: async () => 0, hasHolders: async () => true,
    quote: async (body) => { seen.bodies.push(body); return {} as VersionedTransaction; },
    simulate: async () => bal - (o.spend ?? 20_000_000),
    send: async (_tx, signers) => { seen.signers.push(signers.length); bal -= o.spend ?? 20_000_000; return 'launchsig'; },
    confirm: async () => true,
    uploadMetadata: async (m) => { if (o.failUpload) throw new Error('pump.fun metadata 500'); seen.uploads.push({ name: m.name, symbol: m.symbol, png: m.image.length }); return { uri: 'https://ipfs.io/ipfs/meta', name: m.name, symbol: m.symbol }; },
  };
  return { net, seen };
}

async function setup(net: SolNet, launchOn = true) {
  const { db } = await testDb();
  const now = new Date('2026-10-29T12:00:00Z');
  for (const [id, origin] of [['h1', 'wild'], ['h2', 'wild'], ['x1', 'external']] as const) {
    await db.insert(users).values({ id, username: id, displayName: id, kind: 'agent', createdAt: now });
    await db.insert(agents).values({ userId: id, origin, status: 'active', createdAt: now });
  }
  const d: LaunchDeps = { db, net, master: Buffer.alloc(32, 7), now: () => now, on: true, launchOn };
  return { db, d };
}

const PLAN = { name: 'Ledger Lantern', symbol: 'LNTRN', description: 'A light for the ones still reading the tape at 4 am.' };

describe('real coin launches', () => {
  it('are refused while MAINNET_LAUNCH is off', async () => {
    const { net, seen } = fakeNet();
    const { d } = await setup(net, false);
    expect((await launchCoin(d, 'h1', PLAN)).outcome).toMatch(/MAINNET_LAUNCH/);
    expect(seen.bodies).toEqual([]);
  });

  it('give the house pack one launch, with no first buy and the agent\'s face, and mark the coin unbuyable', async () => {
    const { net, seen } = fakeNet();
    const { db, d } = await setup(net);
    const r = await launchCoin(d, 'h1', PLAN);
    expect(r.ok).toBe(true);
    expect(seen.uploads[0]).toMatchObject({ name: 'Ledger Lantern', symbol: 'LNTRN' });
    expect(seen.uploads[0]!.png).toBeGreaterThan(500);
    expect(seen.bodies[0]).toMatchObject({ action: 'create', amount: 0, pool: 'pump', tokenMetadata: { uri: 'https://ipfs.io/ipfs/meta' } });
    expect(seen.signers).toEqual([2]);
    const [t] = await db.select().from(solTrades).where(eq(solTrades.kind, 'launch'));
    expect(t).toMatchObject({ agentId: 'h1', mint: r.mint, symbol: 'LNTRN', ok: true, sol: 0.02 });
    expect(await shillexCoin(db, r.mint!)).toBe(true);
    expect(await houseLaunchFree(db)).toBe(false);
    expect((await launchCoin(d, 'h2', { ...PLAN, symbol: 'OTHER' })).outcome).toMatch(/had its one launch/);
    // An outside agent is not part of the house pack's one launch (its owner's switch decides, in real-act).
    expect((await launchCoin(d, 'x1', { ...PLAN, symbol: 'MINE' })).ok).toBe(true);
  });

  it('gives the house launch back when nothing was sent, and refuses one that would cost too much', async () => {
    const failing = fakeNet({ failUpload: true });
    const a = await setup(failing.net);
    expect((await launchCoin(a.d, 'h1', PLAN)).ok).toBe(false);
    expect(await houseLaunchFree(a.db)).toBe(true);
    const dear = fakeNet({ spend: 90_000_000 });
    const b = await setup(dear.net);
    expect((await launchCoin(b.d, 'h1', PLAN)).outcome).toMatch(/more than 0.05/);
    expect(dear.seen.signers).toEqual([]);
    expect((await b.db.select().from(worldSettings).where(eq(worldSettings.key, HOUSE_LAUNCH_KEY))).length).toBe(0);
  });
});
