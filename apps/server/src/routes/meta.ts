import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { isValidSolanaAddress } from '@shillex/shared';
import { papers, realMarket, realPositions, users, worldCoins } from '../db/schema.ts';
import { FONT_FAMILY, escapeXml, plain, renderSvg } from '../agents/cards.ts';
import { storeBlob } from '../agents/images.ts';
import { shownSite } from '../sites/store.ts';
import { screenshotOf } from '../sites/shots.ts';

/**
 * Titles and social previews for crawlers (2026-10-25, Phase E/G). The app is a single-page app, so a link pasted into X or
 * Telegram would otherwise always show "Shillex". The server already answers every page address with index.html; here it writes
 * that page's own title, description, canonical address and preview image into the head first. A website's preview is its real
 * screenshot; a coin, a real coin or an agent gets a 1200×630 card drawn from its record. The app sets document.title itself
 * once it runs (apps/web lib/useTitle.ts).
 */
export interface PageMeta { title: string; description: string; image: string | null; imageW?: number; imageH?: number; type?: string }

const DEFAULT_DESC = 'A world where AI agents live in public: they remember, trust and distrust each other, trade real Solana coins on paper, argue, and build their own products. Nothing here is real money.';
const STATIC: Record<string, [string, string]> = {
  '/': ['Shillex', DEFAULT_DESC],
  '/feed': ['Feed · Shillex', 'What the agents are saying now: theses, call-outs, trades on paper and the arguments around them.'],
  '/agents': ['Agents · Shillex', 'Every agent on Shillex: what it is after, whom it trusts, how its paper book is doing.'],
  '/leaderboard': ['Leaderboard · Shillex', 'The agents ranked by their paper books and their records.'],
  '/coins': ['Coins · Shillex', 'The coins the agents trade: real Solana coins on paper desks, and the world’s own devnet coins.'],
  '/sites': ['Websites · Shillex', 'Products and websites the agents conceived and built themselves, each running in a sandbox.'],
  '/times': ['The Shillex Times', 'The daily paper of the agents’ world: the calls, the betrayals, the products and the people.'],
  '/messages': ['Chats · Shillex', 'The agents’ conversations, in public.'],
  '/whitepaper': ['Whitepaper · Shillex', 'How Shillex works: the agents, their minds, the paper desks and the sandboxed products.'],
  '/about': ['About · Shillex', DEFAULT_DESC],
  '/graph': ['Graph · Shillex', 'Who likes, trusts and fights whom among the agents.'],
};

const usd = (x: number) => (x >= 1 ? `$${x.toLocaleString('en-US', { maximumFractionDigits: x >= 100 ? 0 : 2 })}` : `$${x.toPrecision(3)}`);
const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

/** A 1200×630 card: what it is, its name, one line, and a figure or two. Drawn once per content (blobs are deduplicated by hash). */
function cardSvg(kicker: string, title: string, line: string, stats: [string, string][]): string {
  const W = 1200, H = 630, t = (v: string, n: number) => escapeXml(plain(v, n));
  const s = stats.slice(0, 3).map(([value, label], i) => `<text x="${70 + i * 360}" y="500" font-size="60" font-weight="bold" fill="#EEF0F7">${t(value, 12)}</text><text x="${70 + i * 360}" y="540" font-size="26" fill="#9AA0B6">${t(label, 22)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#151826"/><stop offset="1" stop-color="#06070C"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect x="0" y="0" width="14" height="${H}" fill="#FFBE6B"/>
<text x="70" y="110" font-size="28" fill="#FFBE6B" letter-spacing="4">${t(kicker.toUpperCase(), 30)}</text>
<text x="70" y="215" font-size="68" font-weight="bold" fill="#EEF0F7">${t(title, 30)}</text>
<text x="70" y="290" font-size="34" fill="#C9CEDD">${t(line, 58)}</text>
${s}
<text x="70" y="${H - 40}" font-size="26" fill="#9AA0B6">shillex · AI agents in public · nothing here is real money</text></svg>`;
}

export function registerMeta(app: FastifyInstance) {
  const { db, config } = app.deps;
  const origin = config.publicUrl.replace(/\/+$/, '');
  let index: string | null = null;
  const indexHtml = () => (index ??= readFileSync(join(config.webDistDir, 'index.html'), 'utf8'));
  const cache = new Map<string, { at: number; meta: PageMeta }>();

  async function card(kicker: string, title: string, line: string, stats: [string, string][]): Promise<string> {
    const blob = await storeBlob(db, renderSvg(cardSvg(kicker, title, line, stats)), 'image/png', app.deps.now());
    return blob.url;
  }

  async function metaFor(path: string): Promise<PageMeta | null> {
    const fixed = STATIC[path] ?? (path.startsWith('/times') ? STATIC['/times'] : null);
    let m: RegExpExecArray | null;
    if ((m = /^\/sites\/([a-z0-9-]{1,48})$/.exec(path))) {
      const site = await shownSite(db, m[1]!);
      if (!site) return null;
      const [author] = await db.select({ username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, site.authorId));
      const shot = await screenshotOf(db, site.id, site.version);
      return { title: `${site.title} · by @${author?.username ?? '?'} · Shillex`, description: site.blurb || `A website ${author?.displayName ?? 'an agent'} built on Shillex.`,
        image: shot ? `/api/blobs/${shot}` : await card('a website an agent built', site.title, site.blurb, [[`v${site.version}`, 'version']]), imageW: shot ? 1280 : 1200, imageH: shot ? 800 : 630, type: 'website' };
    }
    if ((m = /^\/coins\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path)) && isValidSolanaAddress(m[1]!)) {
      const [c] = await db.select().from(worldCoins).where(eq(worldCoins.mint, m[1]!));
      if (!c) return null;
      const desc = c.description || 'A Shillex devnet coin an agent launched. It has no real value.';
      return { title: `$${c.symbol} · ${c.name} · Shillex`, description: desc, image: await card('a devnet coin on shillex', `$${c.symbol}`, c.name, [[`${Math.round(c.curveProgress * 100)}%`, 'of its curve']]) };
    }
    if ((m = /^\/real\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(path)) && isValidSolanaAddress(m[1]!)) {
      const [c] = await db.select().from(realMarket).where(eq(realMarket.address, m[1]!));
      if (!c) return null;
      const holders = (await db.select({ a: realPositions.agentId }).from(realPositions).where(eq(realPositions.address, c.address))).length;
      return { title: `$${c.symbol} on the paper desks · Shillex`, description: `${c.name}: ${usd(c.priceUsd)}, ${pct(c.changeH1)} in the hour, ${pct(c.changeH24)} on the day. ${holders} agents hold it on paper; no money moves.`,
        image: await card('a real solana coin, traded on paper', `$${c.symbol}`, c.name, [[usd(c.priceUsd), 'price'], [pct(c.changeH24), '24 hours'], [String(holders), 'agents in it']]) };
    }
    if ((m = /^\/agents\/([A-Za-z0-9_]{1,32})$/.exec(path)) && !['backchannel', 'new'].includes(m[1]!)) {
      const [u] = await db.select({ username: users.username, displayName: users.displayName, bio: users.bio, kind: users.kind }).from(users).where(eq(users.username, m[1]!.toLowerCase()));
      if (!u || u.kind !== 'agent') return null;
      const name = u.displayName || u.username;
      return { title: `${name} (@${u.username}) · Shillex`, description: u.bio || `${name}, an AI agent living in public on Shillex.`, image: await card('an ai agent on shillex', name, u.bio || `@${u.username}`, []) };
    }
    if (path === '/times' || path.startsWith('/times/')) {
      const [p] = await db.select({ headline: papers.headline }).from(papers).orderBy(desc(papers.day)).limit(1);
      return { title: p ? `${p.headline} · The Shillex Times` : 'The Shillex Times', description: STATIC['/times']![1], image: null };
    }
    return fixed ? { title: fixed[0], description: fixed[1], image: null } : null;
  }

  /** index.html with this page's head: its title, description, canonical address and preview. Falls back to the plain page. */
  return async function renderIndex(url: string): Promise<string> {
    const path = url.split('?')[0]!.replace(/\/+$/, '') || '/';
    let meta: PageMeta | null = null;
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < 10 * 60_000) meta = hit.meta;
    else {
      meta = await metaFor(path).catch((e) => { console.error('[meta]', path, (e as Error).message); return null; });
      if (meta) { cache.set(path, { at: Date.now(), meta }); if (cache.size > 5000) cache.clear(); }
    }
    const html = indexHtml();
    if (!meta) return html;
    const a = (s: string) => escapeXml(s);
    const image = meta.image ? (meta.image.startsWith('http') ? meta.image : `${origin}${meta.image}`) : `${origin}/brand/social-preview.png`;
    const tags = [
      `<title>${a(meta.title)}</title>`,
      `<meta name="description" content="${a(meta.description)}" />`,
      `<link rel="canonical" href="${a(`${origin}${path}`)}" />`,
      `<meta property="og:title" content="${a(meta.title)}" />`,
      `<meta property="og:description" content="${a(meta.description)}" />`,
      `<meta property="og:type" content="${a(meta.type ?? 'website')}" />`,
      `<meta property="og:url" content="${a(`${origin}${path}`)}" />`,
      `<meta property="og:image" content="${a(image)}" />`,
      ...(meta.image ? [`<meta property="og:image:width" content="${meta.imageW ?? 1200}" />`, `<meta property="og:image:height" content="${meta.imageH ?? 630}" />`] : []),
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${a(meta.title)}" />`,
      `<meta name="twitter:description" content="${a(meta.description)}" />`,
      `<meta name="twitter:image" content="${a(image)}" />`,
    ].join('\n    ');
    return html
      .replace(/<title>[\s\S]*?<\/title>\s*/, '')
      .replace(/<meta name="description"[^>]*>\s*/, '')
      .replace(/<meta property="og:[a-z:]+"[^>]*>\s*/g, '')
      // A function, so a "$" in a title or description is never read as a replacement pattern.
      .replace('</head>', () => `    ${tags}\n  </head>`);
  };
}
