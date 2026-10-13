import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { adminAudit, ledgerAccounts, ledgerJournal, ledgerPools } from '../src/db/schema.ts';

let h: Awaited<ReturnType<typeof testDb>> | null = null;
afterEach(async () => { await h?.close(); h = null; });

describe('mainnet schema', () => {
  it('has the ledger tables and world_coins.archived_at', async () => {
    h = await testDb();
    await h.db.insert(ledgerAccounts).values({ publicKey: 'house', ownerId: 'house', lamports: 5 });
    expect((await h.db.select().from(ledgerAccounts))[0]).toMatchObject({ publicKey: 'house', lamports: 5 });
    await h.db.insert(ledgerJournal).values({ id: 'j1', season: 'dev', kind: 'deposit', account: 'house', counter: 'external', mint: null, lamportsDelta: 5, tokenDelta: 0, ref: 'r', createdAt: new Date() });
    expect(await h.db.select().from(ledgerPools)).toEqual([]);
    const cols = (await h.db.execute(sql`select column_name from information_schema.columns where table_name = 'world_coins' and column_name = 'archived_at'`)) as { rows: unknown[] };
    expect(cols.rows.length).toBe(1);
  });
  it('keeps admin_audit append-only', async () => {
    h = await testDb();
    await h.db.insert(adminAudit).values({ id: 'a1', adminId: 'u', action: 'x', payload: '{}', prevHash: null, hash: 'h', createdAt: new Date() });
    // Drizzle wraps the driver's error ("Failed query: …"); the trigger's message is on its cause.
    const why = (p: Promise<unknown>) => p.then(() => 'ok', (e: { message: string; cause?: { message?: string } }) => `${e.message} ${e.cause?.message ?? ''}`);
    expect(await why(h.db.execute(sql`update admin_audit set action = 'y'`))).toMatch(/append-only/);
    expect(await why(h.db.execute(sql`delete from admin_audit`))).toMatch(/append-only/);
    expect(await why(h.db.execute(sql`truncate admin_audit`))).toMatch(/append-only/);
    expect((await h.db.select().from(adminAudit))[0]!.action).toBe('x');
  });
});
