import { describe, it, expect, afterEach } from 'vitest';
import { ledgerCtx } from './ledger-helpers.ts';
import { acceptNotice, assertCanDeposit, currentNotice, excludeSelf, exclusionUntil, publishNotice } from '../src/ledger/consent.ts';
import { registerMainnetRoutes } from '../src/ledger/routes.ts';

const DAY = 86_400_000;
let c: Awaited<ReturnType<typeof ledgerCtx>>;
afterEach(async () => { await c.t.close(); });

describe('consent', () => {
  it('publishes numbered notices and needs the current one, accepted as an adult', async () => {
    c = await ledgerCtx();
    const u = await c.t.createUser('alice');
    await expect(assertCanDeposit(c.t.db, u.id, c.t.clock.now())).rejects.toMatchObject({ code: 'NOTICE_REQUIRED' });
    const n1 = await publishNotice(c.t.db, 'Position A', c.t.clock.now());
    expect(n1.version).toBe('n1');
    await expect(acceptNotice(c.t.db, u.id, 'n1', false, c.t.clock.now())).rejects.toMatchObject({ code: 'ADULTS_ONLY' });
    await acceptNotice(c.t.db, u.id, 'n1', true, c.t.clock.now());
    await expect(assertCanDeposit(c.t.db, u.id, c.t.clock.now())).resolves.toBeUndefined();
    const n2 = await publishNotice(c.t.db, 'Position B', c.t.clock.now());
    expect(n2.version).toBe('n2');
    await expect(assertCanDeposit(c.t.db, u.id, c.t.clock.now())).rejects.toMatchObject({ code: 'NOTICE_REQUIRED' });
    await expect(acceptNotice(c.t.db, u.id, 'n1', true, c.t.clock.now())).rejects.toMatchObject({ code: 'NOTICE_OUTDATED' });
    expect((await currentNotice(c.t.db))!.legalPosition).toBe('Position B');
  });
  it('locks deposits for 7 or 30 days and never shortens a lock', async () => {
    c = await ledgerCtx();
    const u = await c.t.createUser('bob');
    await publishNotice(c.t.db, 'P', c.t.clock.now());
    await acceptNotice(c.t.db, u.id, 'n1', true, c.t.clock.now());
    await expect(excludeSelf(c.t.db, u.id, 3 as 7, c.t.clock.now())).rejects.toMatchObject({ code: 'BAD_DAYS' });
    const until = await excludeSelf(c.t.db, u.id, 30, c.t.clock.now());
    expect(until.getTime()).toBe(c.t.clock.now().getTime() + 30 * DAY);
    expect((await excludeSelf(c.t.db, u.id, 7, c.t.clock.now())).getTime()).toBe(until.getTime());
    await expect(assertCanDeposit(c.t.db, u.id, c.t.clock.now())).rejects.toMatchObject({ code: 'EXCLUDED' });
    c.t.clock.advance(30 * DAY + 1);
    expect(await exclusionUntil(c.t.db, u.id, c.t.clock.now())).toBeNull();
    await expect(assertCanDeposit(c.t.db, u.id, c.t.clock.now())).resolves.toBeUndefined();
  });
  it('serves the notice to anyone and takes answers only from signed-in humans', async () => {
    c = await ledgerCtx();
    await publishNotice(c.t.db, 'Reviewed position', c.t.clock.now());
    await registerMainnetRoutes(c.t.app, { mode: 'rehearsal', chain: c.chain, custody: null, stop: async () => {} });
    const anon = await c.t.as(null).get('/api/mainnet/notice');
    expect(anon.status).toBe(200);
    expect(anon.body).toMatchObject({ version: 'n1', legalPosition: 'Reviewed position', accepted: false, excludedUntil: null });
    expect(anon.body.points.length).toBe(5);
    expect((await c.t.as(null).post('/api/mainnet/notice', { version: 'n1', adult: true })).status).toBe(401);
    const u = await c.t.createUser('carol');
    expect((await c.t.as(u).post('/api/mainnet/notice', { version: 'n1', adult: true })).status).toBe(204);
    expect((await c.t.as(u).get('/api/mainnet/notice')).body.accepted).toBe(true);
    const ex = await c.t.as(u).post('/api/mainnet/exclusion', { days: 7 });
    expect(ex.status).toBe(200);
    expect((await c.t.as(u).get('/api/mainnet/notice')).body.excludedUntil).toBe(ex.body.until);
  });
});
