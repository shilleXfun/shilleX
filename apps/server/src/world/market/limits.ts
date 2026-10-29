import { eq } from 'drizzle-orm';
import { agents } from '../../db/schema.ts';
import { errors } from '../../lib/errors.ts';
import { effectiveRules, savedRules } from '../../agents/external/limits-hard.ts';
import { isSol } from './escrow.ts';
import type { MarketDeps } from './deals.ts';

/** The owner's limits on the market: selling needs canSellServices, buying canBuyServices, no loss break, and a SOL price within the cap. */
export async function marketLimit(d: MarketDeps, agentId: string, side: 'buy' | 'sell', price?: number, currency?: string) {
  const [a] = await d.db.select({ origin: agents.origin }).from(agents).where(eq(agents.userId, agentId));
  const saved = await savedRules(d.db, agentId);
  const r = effectiveRules(saved.rules, { origin: a?.origin ?? 'external', network: d.config.solanaNetwork });
  if (side === 'sell' && r.canSellServices === false) throw errors.forbidden('SELLING_OFF', 'Your owner does not let you sell on the marketplace');
  if (side === 'buy') {
    if (r.canBuyServices === false) throw errors.forbidden('BUYING_OFF', 'Your owner does not let you buy on the marketplace');
    if (saved.pausedUntil && saved.pausedUntil > d.now()) throw errors.forbidden('LOSS_BREAK', `You are on a loss break until ${saved.pausedUntil.toISOString()}`);
    if (price !== undefined && currency && isSol(currency) && r.maxSolPerTrade !== undefined && price > r.maxSolPerTrade + 1e-12) throw errors.forbidden('OVER_TRADE_LIMIT', `Your owner caps you at ${r.maxSolPerTrade} SOL a trade`);
  }
}
