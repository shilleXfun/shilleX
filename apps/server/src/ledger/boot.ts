import type { FastifyInstance } from 'fastify';
import { Connection } from '@solana/web3.js';
import { eq } from 'drizzle-orm';
import { agents, users } from '../db/schema.ts';
import { notify } from '../services/notify.ts';
import { payoutWallet } from '../services/wallets.ts';
import { applyDuePayoutChanges, setLiveCustody } from './owner.ts';
import { registerMainnetOwnerRoutes } from './owner-routes.ts';
import type { Chain } from '../world/chain.ts';
import { PRACTICE_SEASONS, currentSeason } from './accounts.ts';
import { registerMainnetAdminRoutes } from './admin.ts';
import { Custody, capsFromConfig } from './custody.ts';
import { gateStatus } from './gate.ts';
import { LedgerChain } from './ledger-chain.ts';
import { reconcile } from './reconcile.ts';
import { registerMainnetRoutes, type MainnetHandles } from './routes.ts';
import { LEDGER_RUG_RULE, setRugRule } from './rug-rule.ts';
import { Web3CustodyRpc, assertCustodyNetwork, type CustodyNetwork, type CustodyRpc } from './rpc.ts';
import { parseMainnetKey } from './vault.ts';
import { startSeason } from './season.ts';

const S = 1000;
const refused = (missing: string[]) => new Error(`MAINNET=on refused. Still missing:\n- ${missing.join('\n- ')}`);

/**
 * Everything a ledger world adds at boot: frozen state, the ledger's rug rule, custody (rehearsal on devnet, on behind the
 * launch gate), the poll / pay / reconcile intervals and the routes. Throws, and so stops the server, when MAINNET is
 * misconfigured or the gate is closed. Returns null outside a ledger world.
 */
export async function bootMainnet(app: FastifyInstance, o: { chain: Chain; worldKey: Buffer; rpc?: CustodyRpc; intervals?: boolean }): Promise<MainnetHandles | null> {
  const { db, config, now } = app.deps;
  if (!(o.chain instanceof LedgerChain)) return null;
  const chain = o.chain;
  // The owner's test of real SOL starts Season 1 by itself, once: practice books (devnet or paper SOL) never back real
  // SOL. Every house agent waits at zero until the owner records a stake and opens the season on /admin.
  if (config.mainnet === 'on' && config.mainnetOwnerOnly && PRACTICE_SEASONS.has(await currentSeason(db))) {
    const wild = await db.select({ id: agents.userId }).from(agents).where(eq(agents.origin, 'wild'));
    const r = await startSeason(db, 'season1', new Map(wild.map((a) => [a.id, 0])), now());
    console.log(`[mainnet] owner test: Season 1 started (${r.archivedCoins} practice coins archived). Send SOL from the cold address, record it as stake on /admin, then open the season.`);
  }
  await chain.loadFrozen();
  setRugRule(LEDGER_RUG_RULE);
  let custody: Custody | null = null;
  if (config.mainnet !== 'off') {
    const network: CustodyNetwork = config.mainnet === 'on' ? 'mainnet' : config.custodyLocal ? 'local' : 'devnet';
    if (!config.mainnetRpcUrl && !o.rpc) throw new Error(`MAINNET=${config.mainnet} needs MAINNET_RPC_URL`);
    const key = parseMainnetKey(config.mainnetKey);
    if (config.mainnetKey === config.worldKey) throw new Error('MAINNET_KEY must differ from WORLD_KEY');
    if (config.mainnet === 'rehearsal') {
      // Devnet custody never runs against books that hold real SOL: a withdrawal would pay devnet SOL for a real balance.
      const season = await currentSeason(db);
      if (!PRACTICE_SEASONS.has(season)) throw new Error(`MAINNET=rehearsal refused: the books are season ${season}'s, which hold real SOL`);
    }
    if (config.mainnet === 'on') {
      // Every condition that needs no network first: while any of them fails, the server never contacts the mainnet RPC.
      const offline = await gateStatus({ db, config, rpc: null, custody: null, now });
      if (offline.length) throw refused(offline);
    }
    const rpc = o.rpc ?? new Web3CustodyRpc(new Connection(config.mainnetRpcUrl!, 'finalized'));
    await assertCustodyNetwork(rpc, network);
    custody = new Custody({
      db, rpc, key, network, cold: config.coldAddress ?? null, caps: capsFromConfig(config), now, chain, worldKey: o.worldKey,
      // LOGIN's verified payout wallet: deposits must come from it and withdrawals go only to it (spec §4).
      payoutOf: (userId) => payoutWallet(db, userId),
      notify: async (userId, agentId, summary) => {
        const [a] = await db.select({ u: users.username }).from(users).where(eq(users.id, agentId));
        await notify(app.deps, { userId, type: 'agent_moment', actorId: agentId, targetType: 'user', targetId: agentId, data: { summary, href: `/agents/${a?.u ?? ''}` } });
      },
    });
    if (config.mainnet === 'on') {
      // Then the network itself: the RPC's genesis and the on-chain reserves against the books.
      const missing = await gateStatus({ db, config, rpc, custody, now });
      if (missing.length) throw refused(missing);
    }
  }
  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    let busy = false;
    const t = setInterval(() => {
      if (busy) return;
      busy = true;
      fn().catch((e) => console.error(`[mainnet] ${name} failed`, e)).finally(() => { busy = false; });
    }, ms);
    t.unref?.(); timers.push(t);
  };
  if (o.intervals !== false) {
    if (custody) {
      const c = custody;
      every(15 * S, 'deposits', () => c.pollDeposits());
      every(30 * S, 'withdrawals', () => c.processWithdrawals());
    }
    every(10 * 60 * S, 'reconciliation', () => reconcile({ db, chain, custody, mode: config.mainnet, now }));
    // Payout-wallet changes asked while funds were held take effect after their 72-hour hold (spec §4).
    every(60 * S, 'payout changes', () => applyDuePayoutChanges(db, now(), (u, s) => notify(app.deps, { userId: u, type: 'agent_moment', actorId: null, targetType: 'user', targetId: u, data: { summary: s, href: '/settings' } })));
  }
  setLiveCustody(custody);
  const handles: MainnetHandles = { mode: config.mainnet, chain, custody, stop: async () => { timers.forEach(clearInterval); setLiveCustody(null); } };
  await registerMainnetRoutes(app, handles);
  await registerMainnetAdminRoutes(app, handles);
  await registerMainnetOwnerRoutes(app, handles);
  return handles;
}
