import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ledgerCtx } from './ledger-helpers.ts';
import { engineTurn } from '../src/agents/engine.ts';
import { rugSales } from '../src/agents/overview.ts';
import { chainTxs, ledgerAccounts, worldCoins } from '../src/db/schema.ts';
import { books } from '../src/ledger/books.ts';
import { DEVNET_RUG_RULE, LEDGER_RUG_RULE, setRugRule } from '../src/ledger/rug-rule.ts';

/**
 * The whole engine on the ledger (mainnet spec §12): rugs happen at 25–30%, nobody is wiped out in one sale, and the books
 * balance after every tick. Opt-in, like the devnet simulation:
 *   Git Bash:   cd apps/server && SIM=1 npx vitest run test/ledger-simulation.test.ts --reporter=verbose
 */
// 20 s a tick, not the devnet simulation's 4 s: 3,000 ticks then span ~17 simulated hours. A creator's launch buy vests over
// 24 h, so 25% of it is free only 6 h after launch; at 4 s a tick (3.3 hours) no rug could ever reach the ledger's 25%.
const TICKS = Number(process.env.SIM_TICKS ?? 3000), TICK_MS = 20_000, SWEEP_EVERY = 75;

describe.runIf(process.env.SIM === '1')('ledger simulation (SIM=1)', () => {
  it(`keeps the books and the rug rules over ${TICKS} ticks`, async () => {
    const c = await ledgerCtx();
    setRugRule(LEDGER_RUG_RULE);
    try {
      const start = c.t.clock.now();
      for (let i = 0; i < 50; i++) await c.fund(i, 0.1);
      for (let i = 1; i <= TICKS; i++) {
        await engineTurn(c.d);
        c.t.clock.advance(TICK_MS);
        if (i % SWEEP_EVERY === 0) {
          await c.depth.sweep(c.d);
          const b = await books(c.t.db);
          expect(b.mismatches, `tick ${i}`).toEqual([]);
        }
      }
      const b = await books(c.t.db);
      expect(b.ok).toBe(true);
      expect(b.ledgerTotal).toBe(50 * 0.1 * 1e9);
      expect((await c.t.db.select().from(ledgerAccounts)).every((a) => a.lamports >= 0)).toBe(true);
      // Every creator sale moved at most 30% of the bag it held just before (rugSales reports the share).
      const rugs = await rugSales(c.t.db, start);
      const creatorSales = (await c.t.db.select({ id: chainTxs.id }).from(chainTxs).innerJoin(worldCoins, and(eq(worldCoins.mint, chainTxs.mint), eq(worldCoins.creatorId, chainTxs.agentId))).where(eq(chainTxs.kind, 'sell'))).length;
      console.log('[sim] rugs', rugs.length, 'creator sales', creatorSales, 'max share', Math.max(0, ...rugs.map((r) => r.soldPct)).toFixed(1));
      for (const r of rugs) expect.soft(r.soldPct).toBeLessThanOrEqual(30.01);
      expect.soft(rugs.length).toBeGreaterThanOrEqual(1);
    } finally {
      setRugRule(DEVNET_RUG_RULE);
      await c.t.close();
    }
  }, 30 * 60_000);
});
