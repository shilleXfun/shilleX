import { eq } from 'drizzle-orm';
import { Connection, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption, MigrationOption, TokenAuthorityOption,
  TokenDecimal, TokenType, buildCurveWithMarketCap,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import type { Db } from '../db/client.ts';
import { worldSettings } from '../db/schema.ts';

export const DBC_CONFIG = 'dbc_config';
export async function getSetting(db: Db, key: string): Promise<string | null> {
  const [r] = await db.select().from(worldSettings).where(eq(worldSettings.key, key));
  return r?.value ?? null;
}
export async function setSetting(db: Db, key: string, value: string) {
  await db.insert(worldSettings).values({ key, value }).onConflictDoUpdate({ target: worldSettings.key, set: { value } });
}

/** Shillex's partner config on the Dynamic Bonding Curve program: a shallow pump-style curve sized for a 5 SOL economy, 1% fee, half to the creator. */
export async function createLaunchpad(conn: Connection, treasury: Keypair): Promise<string> {
  const client = DynamicBondingCurveClient.create(conn, 'confirmed');
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
  const cfg = Keypair.generate();
  const tx = await client.partner.createConfig({ config: cfg.publicKey, feeClaimer: treasury.publicKey, leftoverReceiver: treasury.publicKey, quoteMint: NATIVE_MINT, payer: treasury.publicKey, ...curve });
  await sendAndConfirmTransaction(conn, tx, [treasury, cfg], { commitment: 'confirmed' });
  return cfg.publicKey.toBase58();
}
