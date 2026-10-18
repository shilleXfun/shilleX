// Smoke test of the agents' real chain code on devnet (DevnetChain): launchpad → launch → buy → read → sell → send, with
// the RPC requests each step made. Run: npm run world:smoke -w @shillex/server (DEVNET_RPC_URL, else public devnet).
// Shares the spike's throwaway keypair in data/world-spike-keypair.json, so leftover devnet SOL is reused.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DevnetChain } from '../src/world/devnet-chain.ts';
import { createLaunchpad } from '../src/world/launchpad.ts';

let requests = 0;
const url = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
const conn = new Connection(url, { commitment: 'confirmed', fetch: (input, init) => { requests++; return fetch(input, init); } });
const file = '../../data/world-spike-keypair.json';
mkdirSync('../../data', { recursive: true });
const payer = existsSync(file) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')))) : Keypair.generate();
writeFileSync(file, JSON.stringify(Array.from(payer.secretKey)));
const me = payer.publicKey.toBase58();
const chain = new DevnetChain(conn, null);

async function step<T>(name: string, f: () => Promise<T>): Promise<T> {
  const at = Date.now(), before = requests;
  try {
    const r = await f();
    console.log(`ok   ${name} (${Date.now() - at} ms, ${requests - before} requests)`);
    return r;
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    process.exit(1);
  }
}
const check = (ok: boolean, what: string) => { if (!ok) { console.log(`FAIL ${what}`); process.exit(1); } };

// The host only: the URL carries the RPC key.
console.log('rpc', new URL(url).host, 'payer', me);
await step('the RPC is devnet, not mainnet', () => chain.assertNotMainnet());
if ((await step('read SOL', () => conn.getBalance(payer.publicKey))) < 0.1 * LAMPORTS_PER_SOL) {
  try {
    const signature = await conn.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
    await conn.confirmTransaction({ signature, ...(await conn.getLatestBlockhash()) }, 'confirmed');
    console.log('ok   airdrop 1 SOL');
  } catch (e) {
    console.log(`FAIL airdrop (${(e as Error).message}): fund ${me} at https://faucet.solana.com (devnet) and rerun`);
    process.exit(1);
  }
}
const start = await conn.getBalance(payer.publicKey);
const cfg = await step('create a launchpad', () => createLaunchpad(conn, payer));
chain.setLaunchpad(cfg);
const launch = await step('launch $SMOKE with a 0.01 SOL first buy', () => chain.launch(payer, { name: 'Smoke Test', symbol: 'SMOKE', uri: 'https://example.com/smoke.json', initialBuyLamports: 10_000_000 }));
check(launch.tokenDelta > 0, 'the launch bought no tokens');
const c1 = await step('read the curve', async () => (await chain.curve(launch.mint))!);
const buy = await step('buy 0.005 SOL', () => chain.buy(payer, launch.mint, 5_000_000, 500));
check(buy.tokenDelta > 0, 'the buy got no tokens');
// The buy expired the cached read, so this asks the RPC and must see both buys.
const held = await step('read the wallet', () => chain.balances(me));
const raw = held.tokens.find((t) => t.mint === launch.mint)?.raw ?? 0;
check(raw === launch.tokenDelta + buy.tokenDelta, `the wallet holds ${raw}, the launch and buy got ${launch.tokenDelta + buy.tokenDelta}`);
const cached = requests;
await chain.balances(me);
check(requests === cached, 'a second read asked the RPC again');
const sell = await step('sell half', () => chain.sell(payer, launch.mint, Math.floor(raw / 2), 500));
check(sell.lamportsDelta > 0 && sell.tokenDelta < 0, 'the sale paid nothing');
const c2 = await step('read the curve again', async () => (await chain.curve(launch.mint))!);
await step('send 0.001 SOL to a new wallet', () => chain.sendSol(payer, Keypair.generate().publicKey.toBase58(), 1_000_000));
const end = await step('read SOL', () => conn.getBalance(payer.publicKey));
console.log(`price ${c1.priceLamports.toFixed(4)} → ${c2.priceLamports.toFixed(4)} lamports, curve ${(c2.curveProgress * 100).toFixed(2)}%`);
console.log(`spent ${((start - end) / LAMPORTS_PER_SOL).toFixed(4)} devnet SOL;${requests} RPC requests in all (websocket confirmations not counted)`);
console.log('ALL OK');
// Confirmations opened a websocket that would keep the process alive.
process.exit(0);
