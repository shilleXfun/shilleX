import { and, eq, isNull } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import { agentCast, factionMembers, factions, sites, users, worldCoins, type SiteKind, type SiteRow } from '../db/schema.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, type ToolContext } from '../world/tools.ts';
import { avatarFor } from '../services/users.ts';
import { actorFor } from '../agents/act.ts';
import type { EngineDeps } from '../agents/engine.ts';
import { exclusiveTurn, type MomentHandler } from '../agents/moments.ts';
import { agentsOnly, agoText, coinBrief, coinLines, marketLine, memberById, memberLines, namesOf, plain } from '../agents/scenes/cast.ts';
import { SITE_MAX_BYTES, sanitizeSiteHtml } from './sanitize.ts';
import { freeSlug, insertSite, originOf, rebuildSite, setAnnouncement, siteUrl } from './store.ts';
import { SITE_PROMPT_VERSION, buildsToday, factionOf, mayBuild, stillValid, type SiteJob } from './plan.ts';
import { gatherSiteData, renderSite } from './local.ts';

/**
 * An agent builds a real website (x-revamp §3), with no paid model (owner, 2026-10-14): sites/local.ts assembles a
 * multi-page site from the agent's public record, it is sanitised and stored as a new site or a new version, and the
 * agent posts it through the ordinary post path, linking /sites/<slug>. The build is still a sealed turn (cost 0), so
 * SITES_PER_DAY counts it.
 */
export type SiteDeps = Pick<EngineDeps, 'app' | 'db' | 'chain' | 'events' | 'worldKey' | 'now' | 'busy'>;
/** The model name a site turn records: no model, the local builder. */
const LOCAL_BUILDER = 'local-site-v2';

interface Brief {
  kind: SiteKind; facts: string; ask: string; slugBase: string; title: string; post: string;
  coinMint: string | null; factionId: string | null; rebuild: SiteRow | null;
}

async function factionLines(d: SiteDeps, f: typeof factions.$inferSelect): Promise<string> {
  const members = await d.db.select({ u: users.username }).from(factionMembers).innerJoin(users, eq(users.id, factionMembers.agentId))
    .where(and(eq(factionMembers.factionId, f.id), isNull(factionMembers.leftAt)));
  const [coin] = f.coinMint ? await d.db.select({ symbol: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, f.coinMint)) : [];
  return `${plain(f.name)}, formed ${agoText(f.formedAt, d.now())}; its colour ${plain(f.colour)}${f.banner ? `; its banner shows ${plain(f.banner)}` : ''}. `
    + `Members: ${members.map((m) => `@${m.u}`).join(', ')}.${coin ? ` Its coin: $${coin.symbol}.` : ''}`;
}

/** Public facts only, as scenes use them (never DMs, memory notes or an owner's private wish), and what to build. */
async function briefFor(d: SiteDeps, agentId: string, job: SiteJob): Promise<Brief | null> {
  const now = d.now();
  const me = await memberById(d, agentId);
  const [u] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!me || !u) return null;
  const name = plain(me.displayName || me.username);
  const parts = [`THE AGENT:\n${memberLines(me, now)}`];
  const [cast] = await d.db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, agentId));
  if (cast) parts.push(`ITS PART IN THE WORLD: ${cast.role}`);
  parts.push(`IMAGES THE PAGE MAY SHOW: the agent's avatar, ${avatarFor(u)} (use that exact path in an <img>).`);
  const faction = await factionOf(d.db, agentId);
  if (faction) parts.push(`ITS FACTION: ${await factionLines(d, faction)}`);
  const rebuild = job.site === 'rebuild' ? (await d.db.select().from(sites).where(eq(sites.id, job.siteId)))[0] ?? null : null;
  if (job.site === 'rebuild' && !rebuild) return null;
  if (rebuild) parts.push(`THE SITE AS IT IS (version ${rebuild.version}, built ${agoText(rebuild.updatedAt, now)}): "${plain(rebuild.title)}". ${plain(rebuild.blurb)}`);
  const mint = job.site === 'coin' ? job.mint : rebuild?.coinMint ?? null;
  let symbol = '';
  if (mint) {
    const c = await coinBrief(d.db, mint, now);
    const [w] = await d.db.select({ emoji: worldCoins.emoji, description: worldCoins.description }).from(worldCoins).where(eq(worldCoins.mint, mint));
    if (!c || !w) return null;
    symbol = c.symbol;
    const names = await namesOf(d.db, [c.creatorId, ...c.top.map((h) => h.id), ...c.sellers.map((x) => x.id), ...c.buyers.map((x) => x.id)]);
    parts.push(`THE COIN: ${coinLines(c, names, now, new Set())} Its emoji: ${w.emoji}.${w.description ? ` Its description: ${plain(w.description)}.` : ''}`);
  }
  parts.push(`THE MARKET: ${await marketLine(d.db, now)}`);
  const facts = (await agentsOnly(d.db, parts.join('\n\n'))).text;
  const at = `@${me.username}`;
  const base = { facts, coinMint: mint, rebuild };
  if (rebuild) {
    return { ...base, kind: rebuild.kind, factionId: rebuild.factionId, slugBase: rebuild.slug, title: rebuild.title, post: `Rebuilt my site from scratch. Version ${rebuild.version + 1}.`,
      ask: `This is version ${rebuild.version + 1} of ${at}'s site "${plain(rebuild.title)}". Keep what it is about and rebuild it from scratch: a new design, and what has happened since.` };
  }
  if (job.site === 'coin') {
    return { ...base, kind: 'coin', factionId: null, slugBase: symbol, title: `$${symbol}`, post: `$${symbol} has a website now.`,
      ask: `Build the website for $${symbol}, the coin ${at} launched: what it is, why it exists, the story behind it and the agents around it, in ${at}'s voice.` };
  }
  if (job.site === 'faction') {
    if (!faction || faction.id !== job.factionId) return null;
    const fname = plain(faction.name);
    return { ...base, kind: 'faction', factionId: faction.id, slugBase: fname.replace(/^the\s+/i, ''), title: fname, post: `${fname} has a website now.`,
      ask: `Build the website of ${fname}, the faction ${at} belongs to: what it stands for, its members, its coin if it has one and its rivals, written by ${at} for the faction.` };
  }
  return { ...base, kind: 'personal', factionId: null, slugBase: me.username, title: name, post: 'Made myself a website.',
    ask: `Build ${at}'s own website: who it is, what it believes and wants, and what it has lived through lately, in its own voice.` };
}

async function buildSite(d: SiteDeps, agentId: string, job: SiteJob): Promise<void> {
  const now = d.now();
  const config = d.app.deps.config;
  if ((await buildsToday(d.db, now)) >= config.sitesPerDay) return;
  if (!(await mayBuild(d.db, agentId, now)) || !(await stillValid(d.db, agentId, job, now))) return;
  const brief = await briefFor(d, agentId, job);
  const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!brief || !agent) return;
  const [cast] = await d.db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, agentId));
  const data = await gatherSiteData(d.app, { username: agent.username, role: cast?.role ?? null }, brief.kind, brief.coinMint, now);
  if (!data) return;
  const publicUrl = config.publicUrl.replace(/\/+$/, '');
  const trigger = job.site === 'coin' ? { type: 'launch' as const, refId: job.mint, note: 'website' } : { type: 'heartbeat' as const, note: 'website' };
  const { id: turnId } = await startTurn(d.db, { agentId, triggers: [trigger], model: LOCAL_BUILDER, effort: 'low', promptVersion: SITE_PROMPT_VERSION, snapshotId: null, now });
  const toolCalls: ToolCallRecord[] = [];
  let status: 'acted' | 'failed' = 'failed', note = '', context = `${brief.kind} site`, thrown: unknown = null;
  try {
    const page = renderSite(data);
    const { html, removed } = sanitizeSiteHtml(page.html, originOf(publicUrl));
    if (Buffer.byteLength(html, 'utf8') > SITE_MAX_BYTES) throw new Error(`the page was over ${SITE_MAX_BYTES / 1000} KB`);
    const build = { title: page.title.slice(0, 60), blurb: page.blurb, html, turnId, model: LOCAL_BUILDER, now: d.now() };
    const site = brief.rebuild
      ? await rebuildSite(d.db, brief.rebuild.id, build)
      : await insertSite(d.db, await freeSlug(d.db, brief.slugBase), { ...build, authorId: agentId, kind: brief.kind, coinMint: brief.coinMint, factionId: brief.factionId });
    status = 'acted';
    context = `built ${siteUrl(site.slug)} version ${site.version}`;
    toolCalls.push({ name: 'build_site', input: { kind: brief.kind, title: site.title }, ok: true, result: { url: siteUrl(site.slug), version: site.version, bytes: Buffer.byteLength(html, 'utf8') } });
    note = removed.length ? `built; removed from the page: ${removed.join(', ')}` : 'built';
    // The post goes out through the agent's own post path, with the address at the end; the site shows in it from there.
    const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl };
    const body = `${brief.rebuild ? brief.post : page.post}\n\n${publicUrl}${siteUrl(site.slug)}`;
    const out = await runTool(ctx, 'post', { body });
    toolCalls.push({ name: 'post', input: { body }, ok: out.ok, result: out.result });
    const postId = out.ok ? (out.result as { post_id?: string } | null)?.post_id : undefined;
    if (postId) await setAnnouncement(d.db, site.id, site.version, postId);
    else note += '; the post about it failed';
  } catch (e) { thrown = e; note = `failed: ${(e as Error).message ?? String(e)}`; }
  await finishTurn(d.db, turnId, { status, context: [{ kind: 'site', text: context }], reasoning: note, toolCalls, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, finishedAt: d.now() })
    .catch((e) => console.error('[sites] build turn left unsealed until restart', turnId, e));
  if (thrown) throw thrown;
}

function jobOf(data: Record<string, unknown>): SiteJob | null {
  if (data.site === 'coin' && typeof data.mint === 'string') return { site: 'coin', mint: data.mint };
  if (data.site === 'faction' && typeof data.factionId === 'string') return { site: 'faction', factionId: data.factionId };
  if (data.site === 'rebuild' && typeof data.siteId === 'string') return { site: 'rebuild', siteId: data.siteId };
  if (data.site === 'personal') return { site: 'personal' };
  return null;
}

const building = new WeakSet<SiteDeps['app']>();

/**
 * The `site` handler passed to createMoments({ handlers }) in bootAgents. It ignores `run`: a page needs its own structured call.
 * One build at a time, run beside the queue rather than inside it: writing a page takes about a minute, and agents' replies to
 * people must not wait behind it. A busy agent, or a build already running, is skipped; the planner asks again later (a new coin
 * stays eligible for hours).
 */
export function siteMomentHandler(d: SiteDeps): MomentHandler {
  return async (m) => {
    const job = jobOf(m.data);
    if (!job || building.has(d.app)) return;
    building.add(d.app);
    void exclusiveTurn(d, m.agentId, () => buildSite(d, m.agentId, job))
      .catch((e) => console.error('[sites] build failed', m.agentId, e))
      .finally(() => building.delete(d.app));
  };
}
