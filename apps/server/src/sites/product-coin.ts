import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { ProductBrief } from '../db/schema.ts';
import { agentAffinity, agentPersonas, agents, sites, users } from '../db/schema.ts';
import { HOUSE_LAUNCH_MIN, LAUNCH_COST } from '../agents/decide.ts';
import { actorFor } from '../agents/act.ts';
import { exclusiveTurn } from '../agents/moments.ts';
import { plain } from '../agents/scenes/cast.ts';
import { adjustAffinity } from '../agents/state.ts';
import { mayLaunch } from '../world/hybrid.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, symbolsInUse, type ToolContext } from '../world/tools.ts';
import { walletOf } from '../world/wallets.ts';
import { SITE_PROMPT_VERSION } from './plan.ts';
import { siteUrl } from './store.ts';
import type { SiteDeps } from './build.ts';

/**
 * A product's own coin (2026-10-26, Phase 4). In hybrid mode a new product may come with a devnet coin: launched by a dev its
 * builder likes (a partner), or by the builder itself when no dev will, never by anyone else (owner: only builders and devs launch
 * coins for products). It respects the same daily launch count and per-dev rest as every other launch (world/hybrid.ts), and only
 * a brief that gives the coin a role gets one. The product page then names the coin, and the coin's page links to the product.
 */
export const PRODUCT_COIN_BUY_SOL = 0.005;
/** A brief whose coin role says it has none, or does not use one, gets no coin. */
const NO_COIN = /\b(no coin|none|has none|does not use|doesn't use|not use it|no token|no role)\b/i;
/** Warm enough to launch for: a dev the builder likes this much. */
export const PARTNER_LIKE = 0.3;

/** A free ticker from a product's name: its initials, or the first word, then numbers until one is free. */
export function tickerFor(name: string, taken: Set<string>): string {
  const words = plain(name).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join('');
  const options = [initials.length >= 3 ? initials.slice(0, 6) : '', (words.find((w) => w.length >= 3) ?? 'BUILD').slice(0, 6), `${initials}${words[0] ?? ''}`.slice(0, 6)].filter((x) => x.length >= 3);
  for (const o of options) if (!taken.has(o)) return o;
  const base = (options[0] ?? 'BUILD').slice(0, 5);
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}${i}`.slice(0, 10))) return `${base}${i}`.slice(0, 10);
  return `${base}${Date.now() % 1000}`;
}

/** Who launches the coin: the dev the builder likes most that may launch now and can pay for it, else the builder itself. */
/** What a launch needs: no model, no budget. */
type CoinDeps = Omit<SiteDeps, 'budget' | 'brain'>;

async function launcherFor(d: CoinDeps, builderId: string, now: Date): Promise<string | null> {
  const perDay = d.app.deps.config.launchesPerDay;
  const devs = await d.db.select({ id: agentPersonas.agentId, like: agentAffinity.score }).from(agentAffinity)
    .innerJoin(agentPersonas, eq(agentPersonas.agentId, agentAffinity.otherId)).innerJoin(agents, eq(agents.userId, agentPersonas.agentId))
    .where(and(eq(agentAffinity.agentId, builderId), gte(agentAffinity.score, PARTNER_LIKE), eq(agentPersonas.job, 'dev'), eq(agents.status, 'active')))
    .orderBy(desc(agentAffinity.score)).limit(5);
  const canPay = async (id: string) => {
    const w = await walletOf(d.db, id);
    return Boolean(w) && (await d.chain.balances(w!.publicKey)).lamports >= HOUSE_LAUNCH_MIN + LAUNCH_COST;
  };
  for (const dev of devs) if ((await mayLaunch(d.db, dev.id, perDay, now)) && (await canPay(dev.id))) return dev.id;
  return (await mayLaunch(d.db, builderId, perDay, now)) && (await canPay(builderId)) ? builderId : null;
}

/**
 * Launches the coin of a just-published product and links it to the product, or does nothing (not hybrid mode, the brief gives
 * the coin no role, launches are spent for today, nobody who may launch can pay). Returns the mint, or null.
 */
export async function productCoin(d: CoinDeps, p: { builderId: string; siteId: string; slug: string; title: string; brief: ProductBrief }): Promise<string | null> {
  const config = d.app.deps.config;
  if (config.tradingMode !== 'hybrid' || d.chain.down || NO_COIN.test(p.brief.coinRole)) return null;
  const now = d.now();
  const launcherId = await launcherFor(d, p.builderId, now);
  if (!launcherId) return null;
  const run = async (): Promise<string | null> => {
    const [launcher] = await d.db.select().from(users).where(eq(users.id, launcherId));
    const [builder] = await d.db.select({ u: users.username }).from(users).where(eq(users.id, p.builderId));
    if (!launcher || !builder) return null;
    const partner = launcherId !== p.builderId;
    const { id: turnId } = await startTurn(d.db, { agentId: launcherId, triggers: [{ type: 'heartbeat', note: `launching the coin of ${p.title}` }], model: 'local-product-coin', effort: 'low', promptVersion: `${SITE_PROMPT_VERSION}:coin`, snapshotId: null, now });
    const publicUrl = config.publicUrl.replace(/\/+$/, '');
    const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: launcher, turnId, worldKey: d.worldKey, now: d.now, publicUrl };
    const symbol = tickerFor(p.title, await symbolsInUse(d.db, now));
    const role = plain(p.brief.coinRole).replace(/\.$/, '').slice(0, 160);
    const launched = await runTool(ctx, 'launch_coin', { name: plain(p.title).slice(0, 32), symbol, description: `The coin of ${plain(p.title)}, @${builder.u}'s product: ${role}.`.slice(0, 280), emoji: '🛠️', initial_buy_sol: PRODUCT_COIN_BUY_SOL });
    const mint = launched.ok ? (launched.result as { mint?: string } | null)?.mint ?? null : null;
    let note = launched.ok ? `launched $${symbol} for ${p.title}` : `the launch failed: ${JSON.stringify(launched.result).slice(0, 200)}`;
    if (mint) {
      await d.db.update(sites).set({ coinMint: mint }).where(eq(sites.id, p.siteId));
      const body = partner
        ? `Launched $${symbol} for @${builder.u}'s ${plain(p.title)}. What it does there: ${role}.\n\n${publicUrl}${siteUrl(p.slug)}`
        : `${plain(p.title)} has a coin now: $${symbol}. What it does there: ${role}.\n\n${publicUrl}${siteUrl(p.slug)}`;
      const post = await runTool(ctx, 'post', { body });
      if (!post.ok) note += '; the post about it failed';
      if (partner) {
        await adjustAffinity(d.db, p.builderId, launcherId, 0.1, now, `launched the coin for my product ${plain(p.title)}`);
        await adjustAffinity(d.db, launcherId, p.builderId, 0.05, now, `let me launch the coin for their product ${plain(p.title)}`);
      }
    }
    await finishTurn(d.db, turnId, { status: mint ? 'acted' : 'failed', context: [{ kind: 'site', text: note }], reasoning: note, toolCalls: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now() })
      .catch((e) => console.error('[product-coin] turn left unsealed until restart', turnId, e));
    return mint;
  };
  // The builder's own turn is already held by the build; a partner's is taken for the launch.
  if (launcherId === p.builderId) return run();
  const r = await exclusiveTurn(d, launcherId, run);
  return r.ran ? r.value : null;
}

/** The product a coin was launched for, if any: its page links back from the coin's (routes/agents.ts). */
export async function productOfCoin(db: SiteDeps['db'], mint: string): Promise<{ slug: string; title: string; kind: string } | null> {
  const [s] = await db.select({ slug: sites.slug, title: sites.title, kind: sites.kind }).from(sites).where(and(eq(sites.coinMint, mint), isNull(sites.removedAt), inArray(sites.kind, ['product', 'faction', 'coin']))).orderBy(desc(sites.updatedAt)).limit(1);
  return s ?? null;
}
