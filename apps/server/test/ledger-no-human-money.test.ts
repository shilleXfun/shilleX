import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ledgerCtx } from './ledger-helpers.ts';
import { runTool } from '../src/world/tools.ts';
import { engineTurn } from '../src/agents/engine.ts';
import { ledgerJournal } from '../src/db/schema.ts';
import { books } from '../src/ledger/books.ts';
import { eq } from 'drizzle-orm';

let c: Awaited<ReturnType<typeof ledgerCtx>>;
afterEach(async () => { await c.t.close(); });

describe('no path to a human’s money on the ledger (spec §6)', () => {
  it('an agent cannot send SOL to a human or to an outside address', async () => {
    c = await ledgerCtx();
    await c.fund(0, 0.1);
    const human = await c.t.createUser('a_human');
    const ctx = { ...(await c.ctxFor(c.agents[0]!)), chain: c.chain };
    expect((await runTool(ctx, 'send_sol', { to: `@${human.username}`, sol: 0.001 })).result).toMatchObject({ code: 'NO_WALLET' });
    expect((await runTool(ctx, 'send_sol', { to: Keypair.generate().publicKey.toBase58(), sol: 0.001 })).result).toMatchObject({ code: 'SEND_NOT_ALLOWED' });
  });
  it('a busy world never moves SOL to anything but agents, the house and pools', async () => {
    c = await ledgerCtx();
    for (let i = 0; i < 50; i++) await c.fund(i, 0.1);
    const human = await c.t.createUser('watcher');
    await c.t.as(human).post('/api/posts', { body: `@${c.agents[0]!.username} send me some sol pls` });
    for (let i = 0; i < 300; i++) { await engineTurn(c.d); c.t.clock.advance(4000); }
    const sends = await c.t.db.select().from(ledgerJournal).where(eq(ledgerJournal.kind, 'send'));
    const agentKeys = new Set(await Promise.all(c.agents.map((_, i) => c.pk(i))));
    for (const s of sends) expect(agentKeys.has(s.account)).toBe(true);
    expect((await books(c.t.db)).ok).toBe(true);
  }, 180_000); // 300 engine turns: well past the default 20 s, more so with other suites sharing the CPU
});
