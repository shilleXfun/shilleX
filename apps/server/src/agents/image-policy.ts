import { createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { mediaBlobs, memeRenders, memeTemplates, posts, users } from '../db/schema.ts';
import { slotsFor } from './act.ts';
import { renderCard, type CardData, type CardKind } from './cards.ts';
import { recordLineage } from './depth/lineage.ts';
import { captionMeme } from './memes.ts';
import { blobUpload, storeBlob, type ImagePolicy } from './images.ts';
import { fillLine } from './phrasebook.ts';
import type { AgentView, Candidate, Situation } from './types.ts';

export const IMAGE_SHARE = 0.2;
export const TEMPLATE_DAILY_MAX = 3;
export const TEMPLATE_GAP_POSTS = 40;
export const RECENT_WINDOW = 40;
const MAX_RECENT_SHARE = 0.25;
const MAX_ALT = 200; // the posts route rejects a longer alt
const IMAGE_KINDS = new Set<Candidate['kind']>(['post', 'reply', 'launch', 'rug', 'leak']);
const PNL_SITUATIONS = new Set<Situation>(['took_profit', 'sold', 'bought']);
const CHART_SITUATIONS = new Set<Situation>(['pumping', 'dumping', 'market_take']);
const day = (d: Date) => d.toISOString().slice(0, 10);
const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;

type Coin = AgentView['coins'][number];
type Position = AgentView['wallet']['positions'][number];
type Card = { [K in CardKind]: { kind: K; data: CardData[K]; alt: string } }[CardKind];
type Attached = { uploadId: string; alt: string };

/** About 1 in 5 posts on average (0.12 + 0.16 × humour), never when recent agent posts are already image-heavy. */
export function imageWanted(v: AgentView, c: Candidate, recentImageShare: number, rng: () => number): boolean {
  if (!IMAGE_KINDS.has(c.kind) || recentImageShare >= MAX_RECENT_SHARE) return false;
  return rng() < 0.12 + 0.16 * v.state.traits.humor;
}

/** The site-wide post count: the clock the 40-post template gap is measured on. */
async function postCount(db: Db): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(posts);
  return r?.n ?? 0;
}

async function recentImageShare(db: Db): Promise<number> {
  const rows = await db.select({ media: posts.media }).from(posts).innerJoin(users, eq(users.id, posts.authorId))
    .where(eq(users.kind, 'agent')).orderBy(desc(posts.createdAt)).limit(RECENT_WINDOW);
  return rows.length ? rows.filter((r) => r.media.length > 0).length / rows.length : 0;
}

/** A template may be used when it is under its daily cap and at least 40 site-wide posts have passed since its last use. */
const usable = (today: string, seq: number) => and(
  or(ne(memeTemplates.usesDay, today), lt(memeTemplates.usesToday, TEMPLATE_DAILY_MAX)),
  or(isNull(memeTemplates.lastUsedPostSeq), lte(memeTemplates.lastUsedPostSeq, seq - TEMPLATE_GAP_POSTS)),
);

/** Least recently used template for the situation (else any) that is under its daily cap and outside the 40-post gap. */
export async function pickTemplate(db: Db, situation: Situation, now: Date, skip: ReadonlySet<string> = new Set()): Promise<{ id: string; blobId: string } | null> {
  const ok = (await db.select({ id: memeTemplates.id, blobId: memeTemplates.blobId, tags: memeTemplates.tags }).from(memeTemplates)
    .where(usable(day(now), await postCount(db)))
    .orderBy(sql`${memeTemplates.lastUsedAt} asc nulls first`, asc(memeTemplates.createdAt))).filter((t) => !skip.has(t.id));
  const pick = ok.find((t) => t.tags.includes(situation)) ?? ok[0];
  return pick ? { id: pick.id, blobId: pick.blobId } : null;
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
const hueOf = (s: string) => [...s].reduce((h, ch) => h + ch.charCodeAt(0) * 37, 0) % 360;
const agentName = (v: AgentView) => v.agent.displayName || v.agent.username;

/** Seven points 10 minutes apart: the price an hour ago and 10 minutes ago (from the real changes), joined by straight lines, then now. */
function chartPoints(coin: Coin): number[] {
  const at60 = 1 / Math.max(0.01, 1 + coin.change1h), at10 = 1 / Math.max(0.01, 1 + coin.change10m);
  return [0, 1, 2, 3, 4, 5].map((i) => at60 + ((at10 - at60) * i) / 5).concat(1);
}
const chartCard = (coin: Coin): Card => ({ kind: 'chart', data: { symbol: coin.symbol, points: chartPoints(coin), changePct: coin.change1h * 100 },
  alt: `$${coin.symbol} chart: ${signedPct(coin.change1h * 100)} in the last hour` });
function pnlCard(v: AgentView, pos: Position): Card {
  const pct = pos.costLamports ? ((pos.valueLamports - pos.costLamports) / pos.costLamports) * 100 : 0;
  return { kind: 'pnl', data: { agent: agentName(v), symbol: pos.symbol, costSol: pos.costLamports / LAMPORTS_PER_SOL, valueSol: pos.valueLamports / LAMPORTS_PER_SOL, pct },
    alt: `P&L on $${pos.symbol}: ${signedPct(pct)}` };
}

/** A launch poster for the coin just launched; null without its symbol (the new coin is not in the view, so act passes it in `slots`). */
function launchCard(v: AgentView, c: Candidate): Card | null {
  const coin = v.coins.find((x) => x.mint === c.target?.mint);
  const symbol = str(c.slots?.symbol) ?? coin?.symbol;
  if (!symbol) return null;
  const name = str(c.slots?.name) ?? symbol;
  return { kind: 'launch', data: { symbol, name, creator: v.agent.username, hue: hueOf(symbol) }, alt: `Launch poster for $${symbol} (${name}) by @${v.agent.username}` };
}

/** A rug receipt from the real sale (act passes the sold share, the SOL and the signature in `slots`); null when any number is missing. */
function rugCard(v: AgentView, c: Candidate): Card | null {
  const coin = v.coins.find((x) => x.mint === c.target?.mint);
  const symbol = str(c.slots?.symbol) ?? coin?.symbol;
  const soldPct = num(c.slots?.soldPct), sol = num(c.slots?.sol), holdersHurt = num(c.slots?.holdersHurt), signature = str(c.slots?.signature);
  if (!symbol || soldPct === undefined || sol === undefined || holdersHurt === undefined || !signature) return null;
  return { kind: 'rug', data: { creator: v.agent.username, symbol, soldPct, sol, holdersHurt, signature },
    alt: `Rug receipt: @${v.agent.username} sold ${soldPct.toFixed(0)}% of $${symbol} for ${sol.toFixed(3)} SOL` };
}

/** The card for a trade or market post (P&L of the traded coin, the coin's chart), or null when the post is not about one. */
function situationCard(v: AgentView, c: Candidate, situation: Situation): Card | null {
  const mint = c.target?.mint;
  const pos = mint ? v.wallet.positions.find((p) => p.mint === mint) : undefined;
  if (PNL_SITUATIONS.has(situation) && pos) return pnlCard(v, pos);
  const coin = mint ? v.coins.find((x) => x.mint === mint) : undefined;
  if (CHART_SITUATIONS.has(situation) && coin) return chartCard(coin);
  return null;
}

/** When no meme can be made: P&L of the agent's best position, else the chart of the biggest mover; never a repeat of a template. */
function fallbackCard(v: AgentView): Card | null {
  const best = [...v.wallet.positions].sort((a, b) => (b.valueLamports - b.costLamports) - (a.valueLamports - a.costLamports))[0];
  if (best) return pnlCard(v, best);
  const mover = [...v.coins].sort((a, b) => Math.abs(b.change1h) - Math.abs(a.change1h))[0];
  return mover ? chartCard(mover) : null;
}

function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

export function createImagePolicy(d: { db: Db; now: () => Date; rng: () => number }): ImagePolicy {
  const { db } = d;

  async function attach(v: AgentView, card: Card): Promise<Attached> {
    const blob = await storeBlob(db, renderCard(card.kind, card.data as never), 'image/png', d.now());
    return { uploadId: await blobUpload(db, v.agent.id, blob, 'image/png', d.now()), alt: card.alt.slice(0, MAX_ALT) };
  }

  /** A captioned template, or null when none is allowed: the agent has no caption for the situation, or every template is capped, spaced out or already carries each caption. */
  async function tryMeme(v: AgentView, situation: Situation, c: Candidate): Promise<Attached | null> {
    const pool = v.phrasebook.memeCaptions.filter((m) => m.situation === situation);
    if (!pool.length) return null;
    // Act's own slots, without usernames: a caption never names a person, and a caption whose slot can't be filled is skipped.
    const slots = slotsFor(v, c, {});
    const tried = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const tpl = await pickTemplate(db, situation, d.now(), tried);
      if (!tpl) return null;
      tried.add(tpl.id);
      for (const cap of shuffled(pool, d.rng)) {
        const top = fillLine(cap.top, slots), bottom = fillLine(cap.bottom, slots);
        if (top === null || bottom === null || (!top && !bottom)) continue;
        const hash = createHash('sha256').update(`${tpl.id}\n${top}\n${bottom}`).digest('hex');
        if ((await db.select({ h: memeRenders.hash }).from(memeRenders).where(eq(memeRenders.hash, hash))).length) continue;
        // Claim the template in one statement, so two agents acting at once can't both slip inside the gap or past the cap.
        const today = day(d.now()), seq = await postCount(db);
        const claimed = await db.update(memeTemplates).set({
          usesToday: sql`case when ${memeTemplates.usesDay} = ${today} then ${memeTemplates.usesToday} + 1 else 1 end`,
          usesDay: today, lastUsedAt: d.now(), lastUsedPostSeq: seq,
        }).where(and(eq(memeTemplates.id, tpl.id), usable(today, seq))).returning({ id: memeTemplates.id });
        if (!claimed.length) break; // taken meanwhile: try the next template
        const [base] = await db.select().from(mediaBlobs).where(eq(mediaBlobs.id, tpl.blobId));
        if (!base) break;
        const blob = await storeBlob(db, captionMeme(base.bytes, base.width, base.height, top, bottom), 'image/png', d.now());
        const fresh = await db.insert(memeRenders).values({ hash, blobId: blob.id, createdAt: d.now() }).onConflictDoNothing().returning({ h: memeRenders.hash });
        if (!fresh.length) continue; // the same render was just made by someone else
        // The caption's inventor is credited like a line's; a lineage failure must not cost the picture.
        await recordLineage(db, { kind: 'caption', text: `${cap.top} / ${cap.bottom}`, situation, inventorId: v.agent.id }, d.now())
          .catch((e: Error) => console.error('[agents] caption lineage not recorded', e.message));
        return { uploadId: await blobUpload(db, v.agent.id, blob, 'image/png', d.now()), alt: [top, bottom].filter(Boolean).join(' / ').slice(0, MAX_ALT) };
      }
    }
    return null;
  }

  async function choose(v: AgentView, c: Candidate): Promise<Attached | null> {
    if (!IMAGE_KINDS.has(c.kind)) return null;
    // Launches and rugs are rare: they always get their card, but only with the real numbers.
    if (c.kind === 'launch') { const card = launchCard(v, c); return card ? attach(v, card) : null; }
    if (c.kind === 'rug') { const card = rugCard(v, c); return card ? attach(v, card) : null; }
    if (!imageWanted(v, c, await recentImageShare(db), d.rng)) return null;
    const situation: Situation = c.situation ?? 'idle';
    const card = situationCard(v, c, situation);
    if (card) return attach(v, card);
    try {
      const m = await tryMeme(v, situation, c);
      if (m) return m;
    } catch (e) { console.error('[agents] meme failed, using a data card', (e as Error).message); }
    const fallback = fallbackCard(v);
    return fallback ? attach(v, fallback) : null;
  }

  return {
    // Never throws: any failure (render, storage, database) means the post goes out without a picture.
    async maybeAttach(v, c, _text) {
      try { return await choose(v, c); } catch (e) { console.error('[agents] image not attached', (e as Error).message); return null; }
    },
  };
}
