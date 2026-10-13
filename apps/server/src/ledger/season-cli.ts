import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { agents } from '../db/schema.ts';
import { devnetNetWorth, fundOpening, startSeason } from './season.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const config = loadConfig();
if (config.worldChain !== 'ledger') throw new Error('Seasons belong to a ledger world: set WORLD_CHAIN=ledger');
const h = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
try {
  const [cmd, name] = args;
  if (cmd === 'start' && name === 'rehearsal') console.log(await startSeason(h.db, 'rehearsal', await devnetNetWorth(h.db), new Date()));
  else if (cmd === 'start' && name === 'season1') {
    const per = Math.round(Number(flag('--per-agent') ?? '0.05') * 1e9);
    // Task 17 narrows this to the original (wild) agents once RAISE's agents.origin exists; raised agents start at 0.
    const all = await h.db.select({ id: agents.userId }).from(agents);
    console.log(await startSeason(h.db, 'season1', new Map(all.map((a) => [a.id, per])), new Date()));
  } else if (cmd === 'open') console.log(await fundOpening(h.db, new Date()));
  else throw new Error('Usage: npm run mainnet:season -- start rehearsal | start season1 [--per-agent 0.05] | open');
} finally { await h.close(); }
