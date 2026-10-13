import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { asc, sql } from 'drizzle-orm';
import { testDb } from './helpers.ts';
import { userWallets, users, walletLinks } from '../src/db/schema.ts';

const dir = fileURLToPath(new URL('../drizzle/', import.meta.url));
/** LOGIN's custom data migration, found by name: the controller renumbers it at merge (parallel-build contract §2). */
function copySql(): string {
  const f = readdirSync(dir).find((n) => n.endsWith('_login_data.sql'));
  if (!f) throw new Error('no *_login_data.sql migration');
  return readFileSync(dir + f, 'utf8');
}
const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'So11111111111111111111111111111111111111112';

let h: Awaited<ReturnType<typeof testDb>> | null = null;
afterEach(async () => { await h?.close(); h = null; });

describe('LOGIN migration', () => {
  it('adds the sign-in tables and the email column', async () => {
    h = await testDb();
    const t: any = await h.db.execute(sql`select table_name from information_schema.tables where table_name in ('user_wallets', 'auth_nonces', 'auth_tokens') order by 1`);
    expect((t.rows as { table_name: string }[]).map((r) => r.table_name)).toEqual(['auth_nonces', 'auth_tokens', 'user_wallets']);
    const c: any = await h.db.execute(sql`select column_name from information_schema.columns where table_name = 'users' and column_name = 'email'`);
    expect(c.rows).toHaveLength(1);
  });

  it('copies typed addresses as unverified rows that keep their show-on-profile choice, one per address, idempotently', async () => {
    h = await testDb();
    const at = new Date('2026-10-01T00:00:00Z');
    // Fixed ids: when two accounts typed the same address, the copy keeps the smallest user id.
    await h.db.insert(users).values(['u_typed_a', 'u_typed_b', 'u_typed_c'].map((id) => ({ id, username: id, displayName: id, createdAt: at })));
    await h.db.insert(walletLinks).values([
      { userId: 'u_typed_a', address: A, displayWallet: true },
      { userId: 'u_typed_b', address: A, displayWallet: false },
      { userId: 'u_typed_c', address: B, displayWallet: false },
    ]);
    for (let run = 0; run < 2; run++) {
      for (const stmt of copySql().split('--> statement-breakpoint')) if (stmt.trim()) await h.db.execute(sql.raw(stmt));
    }
    const rows = await h.db.select().from(userWallets).orderBy(asc(userWallets.address));
    expect(rows.map((r) => [r.address, r.userId, r.verifiedAt, r.showOnProfile, r.isPayout])).toEqual([
      [A, 'u_typed_a', null, true, false],
      [B, 'u_typed_c', null, false, false],
    ]);
  });
});
