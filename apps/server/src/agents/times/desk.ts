import { createHash } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { chainTxs, marketDeals, marketOffers, posts, timesArticles, users, worldCoins } from '../../db/schema.ts';
import { newId } from '../../lib/ids.ts';
import type { AgentBrain } from '../../world/brain.ts';
import { paperFacts } from '../depth/paper.ts';
import type { ModelBudget } from '../haiku.ts';
import { articleImagePrompt, type ImageMaker } from '../image-cache.ts';
import { REPORTERS, ensureReporters, type Beat, type Reporter } from './reporters.ts';
import { fetchFeeds, type FeedItem } from './rss.ts';
import { writeArticle, type Material, type Source } from './write.ts';

/**
 * The Times' desk (2026-10-28 brief §7): every 10 minutes the reporter whose turn has come (TIMES_EVERY_MIN since their last
 * piece) writes one article on their beat from real material, never the same story twice; a rug, a graduation or a deal of a SOL
 * or more is breaking news at once (30 minutes apart at most). Each article gets a lead image when the day's budget allows.
 */
export interface TimesDeskDeps { db: Db; brain: AgentBrain | null; budget: ModelBudget; now: () => Date; images: ImageMaker | null; feeds: { name: string; url: string }[]; everyMs: number; fetchImpl?: typeof fetch }
const DAY = 86_400_000, BREAKING_GAP_MS = 30 * 60_000;
const BEAT_KINDS: Record<'markets' | 'coins' | 'drama', string[]> = {
  markets: ['win', 'desk_win', 'desk_loss', 'desk_crowd', 'desk_board', 'hot_coin'],
  coins: ['rug', 'hot_coin', 'product', 'product_update'],
  drama: ['feud', 'faction', 'split', 'leak', 'comeback', 'ghost', 'default', 'broke_word', 'proven_wrong'],
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'story';
const sol = (l: number) => `${(Math.abs(l) / 1e9).toFixed(3)} SOL`;

export function createTimesDesk(d: TimesDeskDeps) {
  let feedCache: { at: number; items: FeedItem[] } | null = null;
  let lastBreaking = 0;
  const feed = async () => {
    if (feedCache && d.now().getTime() - feedCache.at < 30 * 60_000) return feedCache.items;
    feedCache = { at: d.now().getTime(), items: await fetchFeeds(d.feeds, d.fetchImpl) };
    return feedCache.items;
  };
  const covered = async (key: string) => (await d.db.select({ id: timesArticles.id }).from(timesArticles).where(eq(timesArticles.topicKey, key))).length > 0;

  /** What a beat has to write about now, and the key that says it was covered; null when nothing new happened. */
  async function material(r: Reporter): Promise<{ m: Material; key: string } | null> {
    const now = d.now(), day = now.toISOString().slice(0, 10);
    if (r.beat === 'world' || r.beat === 'satire') {
      const items = (await feed()).filter((i) => !i.published || now.getTime() - i.published.getTime() < 2 * DAY);
      for (const it of items) {
        const key = `${r.beat}:${it.link}`;
        if (await covered(key)) continue;
        const source: Source = { title: it.title, url: it.link, publisher: it.source, text: it.summary };
        return { key, m: { kind: r.beat === 'world' ? 'real_news' : 'satire', section: r.section, facts: [], sources: [source], quotes: [] } };
      }
      return null;
    }
    const facts = (await paperFacts(d.db, day)).items.filter((i) => BEAT_KINDS[r.beat as 'markets' | 'coins' | 'drama'].includes(i.kind)).sort((a, b) => b.weight - a.weight).slice(0, 5);
    const extra: string[] = [];
    if (r.beat === 'markets') {
      const big = await d.db.select({ who: users.username, kind: chainTxs.kind, delta: chainTxs.lamportsDelta, sym: worldCoins.symbol }).from(chainTxs)
        .innerJoin(users, eq(users.id, chainTxs.agentId)).innerJoin(worldCoins, eq(worldCoins.mint, chainTxs.mint))
        .where(and(inArray(chainTxs.kind, ['buy', 'sell']), gte(chainTxs.createdAt, new Date(now.getTime() - DAY)))).orderBy(sql`abs(${chainTxs.lamportsDelta}) desc`).limit(4);
      extra.push(...big.map((t) => `@${t.who} ${t.kind === 'buy' ? 'bought' : 'sold'} ${sol(t.delta)} of $${t.sym}`));
    }
    if (r.beat === 'coins') {
      const launched = await d.db.select({ sym: worldCoins.symbol, who: users.username }).from(worldCoins).innerJoin(users, eq(users.id, worldCoins.creatorId))
        .where(gte(worldCoins.launchedAt, new Date(now.getTime() - DAY))).orderBy(desc(worldCoins.launchedAt)).limit(4);
      extra.push(...launched.map((c) => `@${c.who} launched $${c.sym}`));
    }
    if (r.beat === 'drama' || r.beat === 'markets') {
      const deals = await d.db.select({ status: marketDeals.status, price: marketDeals.priceAmount, cur: marketDeals.currencySymbol, title: marketOffers.title, buyer: users.username }).from(marketDeals)
        .innerJoin(marketOffers, eq(marketOffers.id, marketDeals.offerId)).innerJoin(users, eq(users.id, marketDeals.buyerId))
        .where(and(inArray(marketDeals.status, r.beat === 'drama' ? ['disputed', 'refunded'] : ['released']), gte(marketDeals.updatedAt, new Date(now.getTime() - DAY)))).limit(3);
      extra.push(...deals.map((x) => `@${x.buyer}'s marketplace deal "${x.title}" (${x.price} ${x.cur}) was ${x.status}`));
    }
    const all = [...facts.map((f) => f.text), ...extra];
    if (all.length < 2) return null;
    const key = `${r.beat}:${day}:${hash(all.slice(0, 3).join('|'))}`;
    if (await covered(key)) return null;
    const who = [...new Set(facts.map((f) => f.agentId).filter((x): x is string => Boolean(x)))].slice(0, 4);
    const quotes = who.length ? (await d.db.select({ body: posts.body }).from(posts).where(and(inArray(posts.authorId, who), eq(posts.visibility, 'public'), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(6)).map((p) => p.body) : [];
    return { key, m: { kind: 'world_news', section: r.section, facts: all, sources: [], quotes } };
  }

  /** One article by one reporter, published, or null when there was nothing new or it could not be written. */
  async function publish(r: Reporter, opts: { breaking?: boolean; material?: { m: Material; key: string } } = {}) {
    const ids = await ensureReporters(d.db, d.now());
    const authorId = ids.get(r.handle);
    if (!authorId) return null;
    const got = opts.material ?? (await material(r));
    if (!got) return null;
    const a = await writeArticle({ db: d.db, brain: d.brain, budget: d.budget, now: d.now }, r, got.m);
    if (!a) return null;
    const image = d.images ? await d.images.make(articleImagePrompt(a.headline, a.section), { kind: 'article', size: '1536x1024' }) : null;
    const id = newId();
    const [row] = await d.db.insert(timesArticles).values({
      id, slug: `${slugify(a.headline)}-${id.slice(-6).toLowerCase()}`, section: a.section, kind: a.kind, label: a.label, headline: a.headline, dek: a.dek, body: a.body, pullQuote: a.pullQuote,
      authorId, imageUrl: image?.url ?? null, sources: got.m.sources.map((s) => ({ title: s.title, url: s.url, publisher: s.publisher })), topicKey: got.key, breaking: Boolean(opts.breaking), publishedAt: d.now(),
    }).onConflictDoNothing().returning();
    if (row) console.log(`[times] @${r.handle} published "${row.headline}" (${row.section}${row.breaking ? ', breaking' : ''})`);
    return row ?? null;
  }

  /** A rug, a graduation or a big deal in the last half hour, not yet covered: the coins desk writes it now. */
  async function breaking() {
    const now = d.now();
    if (now.getTime() - lastBreaking < BREAKING_GAP_MS) return null;
    const since = new Date(now.getTime() - 30 * 60_000);
    const rug = (await paperFacts(d.db, now.toISOString().slice(0, 10))).items.find((i) => i.kind === 'rug');
    const grads = await d.db.select({ sym: worldCoins.symbol, mint: worldCoins.mint }).from(worldCoins).where(and(gte(worldCoins.graduatedAt, since), gte(worldCoins.launchedAt, new Date(now.getTime() - 7 * DAY)))).limit(5);
    const bigDeals = await d.db.select({ id: marketDeals.id, price: marketDeals.priceAmount, title: marketOffers.title, seller: users.username }).from(marketDeals)
      .innerJoin(marketOffers, eq(marketOffers.id, marketDeals.offerId)).innerJoin(users, eq(users.id, marketDeals.sellerId))
      .where(and(eq(marketDeals.status, 'released'), eq(marketDeals.currency, 'SOL'), gte(marketDeals.priceAmount, 1), gte(marketDeals.updatedAt, since))).limit(1);
    const coins = REPORTERS.find((r) => r.beat === 'coins')!;
    const candidates: { key: string; facts: string[] }[] = [
      ...(rug ? [{ key: `breaking:rug:${hash(rug.text)}`, facts: [rug.text, ...(rug.body ? [rug.body] : [])] }] : []),
      ...grads.map((g) => ({ key: `breaking:graduated:${g.mint}`, facts: [`$${g.sym} graduated: its curve filled and it moved to the open pool`, 'It is one of the few Shillex coins to make it this far.'] })),
      ...bigDeals.map((x) => ({ key: `breaking:deal:${x.id}`, facts: [`@${x.seller} was paid ${x.price} SOL through escrow for "${x.title}"`, 'It is one of the biggest deals the marketplace has seen.'] })),
    ];
    for (const c of candidates) {
      if (await covered(c.key)) continue;
      lastBreaking = now.getTime();
      return publish(coins, { breaking: true, material: { key: c.key, m: { kind: 'world_news', section: 'coins', facts: c.facts, sources: [], quotes: [] } } });
    }
    return null;
  }

  return {
    publish: (beat: Beat) => publish(REPORTERS.find((r) => r.beat === beat)!),
    breaking,
    /** Breaking news first; otherwise the one reporter longest past their turn writes. */
    async tick() {
      if (await breaking()) return;
      const last = await d.db.select({ author: users.username, at: sql<string>`max(${timesArticles.publishedAt})` }).from(timesArticles).innerJoin(users, eq(users.id, timesArticles.authorId)).groupBy(users.username);
      const when = new Map(last.map((l) => [l.author, Date.parse(l.at)]));
      const due = REPORTERS.map((r) => ({ r, at: when.get(r.handle) ?? 0 })).filter((x) => d.now().getTime() - x.at >= d.everyMs).sort((a, b) => a.at - b.at);
      for (const { r } of due) if (await publish(r)) return;
    },
  };
}
export type TimesDesk = ReturnType<typeof createTimesDesk>;
