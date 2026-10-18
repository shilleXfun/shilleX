// THROWAWAY (agent-world Task 1): proves partner config â†’ launch â†’ buy â†’ sell on devnet and prints what each step cost.
// Run: npm run world:spike -w @shillex/server. Keeps its keypair in data/world-spike-keypair.json so a faucet top-up survives reruns.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, type Transaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption, TokenAuthorityOption,
  TokenDecimal, TokenType, buildCurveWithMarketCap, deriveDbcPoolAddress, getCurrentPoint, getPriceFromSqrtPrice,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const client = new DynamicBondingCurveClient(conn, 'confirmed');
const file = '../../data/world-spike-keypair.json';
mkdirSync('../../data', { recursive: true });
const payer = existsSync(file) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')))) : Keypair.generate();
writeFileSync(file, JSON.stringify(Array.from(payer.secretKey)));
const sol = async () => (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
const send = (tx: Transaction, signers: Keypair[]) => sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' });

console.log('payer', payer.publicKey.toBase58(), 'balance', await sol());
if ((await sol()) < 0.5) {
  try { await conn.confirmTransaction(await conn.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed'); }
  catch (e) { console.log('airdrop failed â€” fund this address at https://faucet.solana.com (devnet) and rerun:', (e as Error).message); process.exit(1); }
}

const curve = buildCurveWithMarketCap({
  token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: 1_000_000_000, leftover: 0 },
  fee: {
    baseFeeParams: { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 } },
    dynamicFeeEnabled: false, collectFeeMode: CollectFeeMode.QuoteToken, creatorTradingFeePercentage: 50, poolCreationFee: 0, enableFirstSwapWithMinFee: false,
  },
  migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
  liquidityDistribution: { partnerPermanentLockedLiquidityPercentage: 50, partnerLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0 },
  lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
  activationType: ActivationType.Timestamp,
  initialMarketCap: 1,
  migrationMarketCap: 12,
});

let before = await conn.getBalance(payer.publicKey);
const cfg = Keypair.generate();
await send(await client.partner.createConfig({ config: cfg.publicKey, feeClaimer: payer.publicKey, leftoverReceiver: payer.publicKey, quoteMint: NATIVE_MINT, payer: payer.publicKey, ...curve }), [payer, cfg]);
console.log('config', cfg.publicKey.toBase58(), 'cost lamports', before - (await conn.getBalance(payer.publicKey)));

before = await conn.getBalance(payer.publicKey);
const mint = Keypair.generate();
const launchSig = await send(await client.creator.createPoolWithFirstBuy({
  createPoolParam: { name: 'Spike Coin', symbol: 'SPIKE', uri: 'https://example.com/spike.json', payer: payer.publicKey, poolCreator: payer.publicKey, config: cfg.publicKey, baseMint: mint.publicKey },
  firstBuyParam: { buyer: payer.publicKey, buyAmount: new BN(10_000_000), minimumAmountOut: new BN(0), referralTokenAccount: null },
}), [payer, mint]);
const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, cfg.publicKey);
console.log('launch', launchSig, 'mint', mint.publicKey.toBase58(), 'pool', pool.toBase58(), 'cost incl 0.01 first buy', before - (await conn.getBalance(payer.publicKey)));

const quoteFor = async (swapBaseForQuote: boolean, amountIn: BN) => {
  const virtualPool = (await client.state.getPool(pool))!;
  const config = (await client.state.getPoolConfig(virtualPool.poolState.config))!;
  const currentPoint = await getCurrentPoint(conn, config.activationType);
  return { virtualPool, quote: client.pool.swapQuote({ virtualPool, config, swapBaseForQuote, amountIn, slippageBps: 500, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint }) };
};

before = await conn.getBalance(payer.publicKey);
const buyIn = new BN(10_000_000);
const { quote: bq } = await quoteFor(false, buyIn);
const buySig = await send(await client.pool.swap({ owner: payer.publicKey, pool, amountIn: buyIn, minimumAmountOut: bq.minimumAmountOut, swapBaseForQuote: false, referralTokenAccount: null }), [payer]);
console.log('buy', buySig, 'lamports spent', before - (await conn.getBalance(payer.publicKey)), 'quoted min out', bq.minimumAmountOut.toString());

const ata = await conn.getParsedTokenAccountsByOwner(payer.publicKey, { mint: mint.publicKey });
const held = new BN(ata.value[0]!.account.data.parsed.info.tokenAmount.amount as string);
before = await conn.getBalance(payer.publicKey);
const { quote: sq, virtualPool } = await quoteFor(true, held);
const sellSig = await send(await client.pool.swap({ owner: payer.publicKey, pool, amountIn: held, minimumAmountOut: sq.minimumAmountOut, swapBaseForQuote: true, referralTokenAccount: null }), [payer]);
console.log('sell', sellSig, 'lamports received', (await conn.getBalance(payer.publicKey)) - before, 'tokens sold', held.toString());

const after = (await client.state.getPool(pool))!;
console.log('price SOL/token', getPriceFromSqrtPrice(after.poolState.sqrtPrice, TokenDecimal.SIX, 9).toString(),
  'quoteReserve', after.poolState.quoteReserve.toString(), 'isMigrated', String(after.poolState.isMigrated),
  'progress', await client.state.getPoolQuoteTokenCurveProgress(pool), 'sqrtPrice before sell', virtualPool.poolState.sqrtPrice.toString());
console.log('final balance', await sol());
