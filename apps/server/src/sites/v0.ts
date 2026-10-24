import type { SiteData } from './local.ts';

/**
 * Agent websites written by v0, Vercel's website model (owner, 2026-10-24: "integrate something other than Claude, for making
 * websites"). One OpenAI-compatible chat call (https://api.v0.dev/v1/chat/completions) with a site kit: what to build, the
 * agent's real public record as data, the exact image paths it may use and the design rules a page must keep to pass
 * sites/sanitize.ts. The page comes back as one HTML document; any failure falls back to the local builder (sites/local.ts).
 */
export interface V0Config { apiKey: string; model: string; priceInPerM: number; priceOutPerM: number; maxTokens: number }
export interface V0Page { html: string; usage: { input: number; output: number }; costUsd: number; model: string }

export const V0_SYSTEM = `You are a senior web designer building one page for a website on Shillex, a small world where AI agents live in public and trade devnet memecoins. The site belongs to one agent (or its coin or its faction) and must look like a real, professional crypto project or personal site: confident typography, a strong hero, clear sections, real numbers shown well, a design with its own character that fits the agent's voice. Never a generic template.

Hard rules (a page that breaks them is thrown away):
- Answer with exactly one complete HTML document: <!doctype html> through </html>. Nothing before or after it, no explanations.
- All CSS inline in one <style> block. Fonts only from Google Fonts (one <link> to fonts.googleapis.com). No other external stylesheets, scripts, frameworks or CDNs, no Tailwind, no React.
- No JavaScript at all. No forms, no iframes, no embeds.
- Images only from the exact paths given in IMAGES; no other image URLs. Charts and decorations are inline SVG drawn from the numbers given.
- Links only to #anchors on the page itself.
- Every fact and number on the page comes from the DATA. Never invent holders, prices, partners, roadmaps with dates, team members, or promises of returns. These are devnet coins: never tell readers to buy.
- Responsive: it must read well at 390 px and at 1440 px wide. Under 120 KB.
- Never mention AI models, prompts, v0 or Vercel. Write in the agent's own voice.`;

/** The page between the first <!doctype or <html and the last </html>, from a reply that may wrap it in a code fence. */
export function extractHtml(reply: string): string | null {
  const start = reply.search(/<!doctype html|<html[\s>]/i);
  const end = reply.toLowerCase().lastIndexOf('</html>');
  return start >= 0 && end > start ? reply.slice(start, end + 7) : null;
}

/** What the page may show, as data: trimmed to what a site needs, numbers rounded. */
export function siteKit(data: SiteData, images: { avatar: string; coin?: string | null }): string {
  const a = data.agent;
  const kit = {
    agent: { name: a.name, username: a.username, bio: a.bio, role: a.role, voice: a.voice, totalSol: +a.totalSol.toFixed(3), pnlSol: +a.pnlSol.toFixed(3), coinsLaunched: a.coinsLaunched, rugs: a.rugs, mood: +a.mood.toFixed(2), reputation: +a.reputation.toFixed(2), traits: a.traits },
    recentPosts: data.posts.slice(0, 8).map((p) => ({ text: p.body.slice(0, 280), at: p.at })),
    allies: data.allies.slice(0, 6).map((x) => ({ name: x.name, username: x.username })),
    rivals: data.enemies.slice(0, 4).map((x) => ({ name: x.name, username: x.username })),
    holdings: data.positions.slice(0, 8).map((p) => ({ symbol: p.symbol, valueSol: +p.valueSol.toFixed(4) })),
    faction: data.faction ? { name: data.faction.name, colour: data.faction.colour, banner: data.faction.banner, members: data.faction.members.map((m) => m.username), coin: data.faction.coinSymbol } : null,
    coin: data.coin ? {
      symbol: data.coin.symbol, name: data.coin.name, description: data.coin.description, launchedAt: data.coin.launchedAt, priceSol: data.coin.priceSol, marketCapSol: data.coin.marketCapSol,
      holders: data.coin.holders, volume24hSol: data.coin.volume24hSol, curveProgress: data.coin.curveProgress, devSoldPct: data.coin.devSoldPct, change1hPct: data.coin.change1hPct,
      priceHistory: data.coin.spark, topHolders: data.coin.top.slice(0, 8).map((h) => ({ username: h.username, sharePct: +(h.share * 100).toFixed(1) })),
      whatOthersSaid: (data.coin.mentions ?? []).slice(0, 4).map((m) => ({ username: m.username, text: m.body.slice(0, 200) })),
    } : null,
  };
  return `IMAGES (use these exact paths, nothing else):\n- the agent's avatar: ${images.avatar}${images.coin ? `\n- the coin's mark: ${images.coin}` : ''}\n\nDATA:\n${JSON.stringify(kit, null, 1)}`;
}

export const worstUsd = (c: V0Config, promptChars: number) => ((promptChars / 3) * c.priceInPerM + c.maxTokens * c.priceOutPerM) / 1_000_000;

/** One page from v0, or a thrown error (network, HTTP status, or a reply with no HTML document in it). */
export async function v0Page(c: V0Config, ask: string, kit: string, fetchImpl: typeof fetch = fetch): Promise<V0Page> {
  const res = await fetchImpl('https://api.v0.dev/v1/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(240_000),
    headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.model, stream: false, max_completion_tokens: c.maxTokens, messages: [{ role: 'system', content: V0_SYSTEM }, { role: 'user', content: `${ask}\n\n${kit}` }] }),
  });
  if (!res.ok) throw new Error(`v0 http ${res.status}`);
  const j = await res.json() as { model?: string; choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const input = j.usage?.prompt_tokens ?? 0, output = j.usage?.completion_tokens ?? 0;
  const costUsd = (input * c.priceInPerM + output * c.priceOutPerM) / 1_000_000;
  const content = j.choices?.[0]?.message?.content;
  const html = typeof content === 'string' ? extractHtml(content) : null;
  if (!html) throw Object.assign(new Error('v0 answered without an HTML page'), { costUsd });
  return { html, usage: { input, output }, costUsd, model: j.model ?? c.model };
}
