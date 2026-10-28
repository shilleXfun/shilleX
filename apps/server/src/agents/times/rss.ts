/**
 * Real-world news for the Times (2026-10-28 brief §7): free public RSS and Atom feeds, read with a 10 s timeout and a small
 * parser (no dependency). Only titles, links, summaries and dates are kept; the reporters summarise and link the source.
 */
export interface FeedItem { title: string; link: string; summary: string; published: Date | null; source: string }

/** Free feeds by default: crypto, tech and world news. TIMES_RSS_FEEDS replaces them ("name|url,name|url" or plain urls). */
export const DEFAULT_FEEDS: { name: string; url: string }[] = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
/** Plain text: CDATA unwrapped, entities decoded (twice, for escaped HTML), tags removed, spaces folded. */
const text = (s: string | undefined) => {
  if (!s) return '';
  const raw = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decode(decode(raw).replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
};
const tag = (block: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1];
const date = (s: string | undefined) => { const t = s ? Date.parse(text(s)) : NaN; return Number.isNaN(t) ? null : new Date(t); };

export function parseFeed(xml: string, source: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const b = m[1]!;
    const link = text(tag(b, 'link')) || text(tag(b, 'guid'));
    const title = text(tag(b, 'title'));
    if (title && /^https?:\/\//.test(link)) out.push({ title, link, summary: text(tag(b, 'description')).slice(0, 600), published: date(tag(b, 'pubDate') ?? tag(b, 'dc:date')), source });
  }
  for (const m of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
    const b = m[1]!;
    const href = /<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? /<link\b[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? '';
    const title = text(tag(b, 'title'));
    if (title && /^https?:\/\//.test(href)) out.push({ title, link: decode(href), summary: text(tag(b, 'summary') ?? tag(b, 'content')).slice(0, 600), published: date(tag(b, 'updated') ?? tag(b, 'published')), source });
  }
  return out;
}

export function feedsFromEnv(v: string | undefined): { name: string; url: string }[] {
  if (!v?.trim()) return DEFAULT_FEEDS;
  return v.split(',').map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    const [a, b] = s.includes('|') ? s.split('|') : [new URL(s).hostname.replace(/^www\./, ''), s];
    return /^https?:\/\//.test(b ?? '') ? [{ name: a!.trim(), url: b!.trim() }] : [];
  });
}

/** Every feed, newest first; a feed that fails or times out is skipped. */
export async function fetchFeeds(feeds: { name: string; url: string }[], fetchImpl: typeof fetch = fetch): Promise<FeedItem[]> {
  const all = await Promise.all(feeds.map(async (f) => {
    try {
      const r = await fetchImpl(f.url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'user-agent': 'ShillexTimes/1.0' } });
      return r.ok ? parseFeed(await r.text(), f.name) : [];
    } catch { return []; }
  }));
  return all.flat().sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0));
}
