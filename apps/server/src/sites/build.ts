import { and, eq, isNull } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import { agentCast, factionMembers, factions, siteVersions, sites, users, worldCoins, type SiteKind, type SiteRow } from '../db/schema.ts';
import { getSetting, setSetting } from '../world/launchpad.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, type ToolContext } from '../world/tools.ts';
import { avatarFor } from '../services/users.ts';
import { actorFor } from '../agents/act.ts';
import type { EngineDeps } from '../agents/engine.ts';
import { exclusiveTurn } from '../agents/moments.ts';
import { PermanentJobError, runJob, type JobOutcome } from '../world/jobs.ts';
import { agentsOnly, agoText, coinBrief, coinLines, marketLine, memberById, memberLines, namesOf, plain } from '../agents/scenes/cast.ts';
import { SITE_MAX_BYTES, sanitizeSiteHtml } from './sanitize.ts';
import { freeSlug, insertSite, originOf, rebuildSite, setAnnouncement, siteUrl } from './store.ts';
import { SITE_PROMPT_VERSION, buildsToday, factionOf, mayBuild, stillValid, type SiteJob } from './plan.ts';
import { gatherSiteData, renderSite } from './local.ts';
import { siteKit, v0Page, worstUsd } from './v0.ts';
import type { ModelBudget } from '../agents/haiku.ts';

/**
 * An agent builds a real website (x-revamp §3), with no paid model (owner, 2026-10-14): sites/local.ts assembles a
 * multi-page site from the agent's public record, it is sanitised and stored as a new site or a new version, and the
 * agent posts it through the ordinary post path, linking /sites/<slug>. The build is still a sealed turn (cost 0), so
 * SITES_PER_DAY counts it.
 */
export type SiteDeps = Pick<EngineDeps, 'app' | 'db' | 'chain' | 'events' | 'worldKey' | 'now' | 'busy'> & { budget?: ModelBudget };
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

async function buildSite(d: SiteDeps, agentId: string, job: SiteJob): Promise<JobOutcome> {
  const now = d.now();
  const config = d.app.deps.config;
  if ((await buildsToday(d.db, now)) >= config.sitesPerDay) return { status: 'skipped', note: 'today’s builds are done' };
  if (!(await mayBuild(d.db, agentId, now))) return { status: 'skipped', note: 'the agent built one in the last 12 h' };
  if (!(await stillValid(d.db, agentId, job, now))) return { status: 'skipped', note: `the ${job.site} job is no longer valid` };
  const brief = await briefFor(d, agentId, job);
  const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!brief || !agent) return { status: 'skipped', note: 'no brief for this agent' };
  const [cast] = await d.db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, agentId));
  const data = await gatherSiteData(d.app, { username: agent.username, role: cast?.role ?? null }, brief.kind, brief.coinMint, now);
  if (!data) return { status: 'skipped', note: 'no public record to build from' };
  const publicUrl = config.publicUrl.replace(/\/+$/, '');
  const trigger = job.site === 'coin' ? { type: 'launch' as const, refId: job.mint, note: 'website' } : { type: 'heartbeat' as const, note: 'website' };
  const { id: turnId } = await startTurn(d.db, { agentId, triggers: [trigger], model: LOCAL_BUILDER, effort: 'low', promptVersion: SITE_PROMPT_VERSION, snapshotId: null, now });
  const toolCalls: ToolCallRecord[] = [];
  let status: 'acted' | 'failed' = 'failed', note = '', context = `${brief.kind} site`, thrown: unknown = null, costUsd = 0;
  try {
    const page = renderSite(data);
    let { html, removed } = sanitizeSiteHtml(page.html, originOf(publicUrl));
    let model = LOCAL_BUILDER;
    // v0 writes the page when it is set up and the budget allows; anything wrong with its page and the local one stands.
    const v0 = config.v0;
    if (v0 && d.budget) {
      const kit = siteKit(data, { avatar: avatarFor(agent), coin: brief.coinMint ? `/api/agents/coin-image/${brief.coinMint}.svg` : null });
      const worst = worstUsd(v0, brief.ask.length + kit.length + 4000);
      if (d.budget.canSpend() && d.budget.canAfford(worst)) {
        try {
          const p = await v0Page(v0, brief.ask, kit);
          costUsd = p.costUsd;
          const clean = sanitizeSiteHtml(p.html, originOf(publicUrl));
          const bytes = Buffer.byteLength(clean.html, 'utf8');
          if (bytes >= 3000 && bytes <= SITE_MAX_BYTES) { html = clean.html; removed = clean.removed; model = p.model; }
          else note = `v0's page was ${bytes} bytes after cleaning; the local page stands. `;
        } catch (e) {
          costUsd = Number((e as { costUsd?: unknown }).costUsd ?? 0) || 0;
          note = `v0 failed (${(e as Error).message}); the local page stands. `;
        }
        d.budget.add(costUsd);
      }
    }
    if (Buffer.byteLength(html, 'utf8') > SITE_MAX_BYTES) throw new PermanentJobError(`the page was over ${SITE_MAX_BYTES / 1000} KB`);
    const build = { title: page.title.slice(0, 60), blurb: page.blurb, html, turnId, model, now: d.now() };
    const site = brief.rebuild
      ? await rebuildSite(d.db, brief.rebuild.id, build)
      : await insertSite(d.db, await freeSlug(d.db, brief.slugBase), { ...build, authorId: agentId, kind: brief.kind, coinMint: brief.coinMint, factionId: brief.factionId });
    status = 'acted';
    context = `built ${siteUrl(site.slug)} version ${site.version}`;
    toolCalls.push({ name: 'build_site', input: { kind: brief.kind, title: site.title }, ok: true, result: { url: siteUrl(site.slug), version: site.version, bytes: Buffer.byteLength(html, 'utf8') } });
    note += removed.length ? `built with ${model}; removed from the page: ${removed.join(', ')}` : `built with ${model}`;
    // The post goes out through the agent's own post path, with the address at the end; the site shows in it from there.
    const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent, turnId, worldKey: d.worldKey, now: d.now, publicUrl };
    const body = `${brief.rebuild ? brief.post : page.post}\n\n${publicUrl}${siteUrl(site.slug)}`;
    const out = await runTool(ctx, 'post', { body });
    toolCalls.push({ name: 'post', input: { body }, ok: out.ok, result: out.result });
    const postId = out.ok ? (out.result as { post_id?: string } | null)?.post_id : undefined;
    if (postId) await setAnnouncement(d.db, site.id, site.version, postId);
    else note += '; the post about it failed';
  } catch (e) { thrown = e; note = `failed: ${(e as Error).message ?? String(e)}`; }
  await finishTurn(d.db, turnId, { status, context: [{ kind: 'site', text: context }], reasoning: note, toolCalls, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd, finishedAt: d.now() })
    .catch((e) => console.error('[sites] build turn left unsealed until restart', turnId, e));
  if (thrown) throw thrown;
  return { status: 'ok', note: context };
}

const building = new WeakSet<SiteDeps['app']>();
/** A build may hold the job this long; a process that died mid-build frees it for the next slot after that. */
const BUILD_LEASE_MS = 10 * 60_000;

/**
 * Starts a site build for this agent now (sites/plan.ts calls it). The local builder costs nothing, so this never goes through
 * the model queue: a paused model or a spent budget must not stop it (2026-10-25 root cause). One build at a time, beside the
 * engine rather than inside a tick (a page takes a while), under the 'site-build' job lease so a second process cannot build
 * the same slot. False when a build is already running here; the planner asks again on its next look.
 */
export function siteBuilder(d: SiteDeps): (agentId: string, job: SiteJob) => boolean {
  return (agentId, job) => {
    if (building.has(d.app)) return false;
    building.add(d.app);
    void runJob(d.db, 'site-build', { now: d.now, leaseMs: BUILD_LEASE_MS }, async () => {
      const r = await exclusiveTurn(d, agentId, () => buildSite(d, agentId, job));
      return r.ran ? r.value : { status: 'skipped', note: `the agent was ${r.reason}` };
    })
      .then((r) => { if (!r.ran) console.log(`[sites] build not started: ${r.reason}`); })
      .finally(() => building.delete(d.app));
    return true;
  };
}

/** Which renderer drew the stored pages; a new one redraws every page the local builder made, once (restyleSites). */
const RENDER_VERSION = 'site-render-2026-10-24';
const RENDER_KEY = 'site_render_version';

/**
 * Redraws every shown site the local builder made with today's renderer, from its agent's record as it is now, in place:
 * the same address, version and announcement, a new design. Pages a model wrote stay as they were. Runs once per renderer.
 */
export async function restyleSites(d: SiteDeps): Promise<number> {
  if ((await getSetting(d.db, RENDER_KEY)) === RENDER_VERSION) return 0;
  const publicUrl = d.app.deps.config.publicUrl.replace(/\/+$/, '');
  const rows = await d.db.select({ s: sites, username: users.username }).from(sites).innerJoin(users, eq(users.id, sites.authorId)).where(isNull(sites.removedAt));
  let done = 0;
  for (const { s, username } of rows) {
    const [v] = await d.db.select({ model: siteVersions.model }).from(siteVersions).where(and(eq(siteVersions.siteId, s.id), eq(siteVersions.version, s.version)));
    if (!v?.model.startsWith('local-site')) continue;
    const [cast] = await d.db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, s.authorId));
    const data = await gatherSiteData(d.app, { username, role: cast?.role ?? null }, s.kind, s.coinMint, d.now()).catch(() => null);
    if (!data) continue;
    const { html } = sanitizeSiteHtml(renderSite(data).html, originOf(publicUrl));
    if (Buffer.byteLength(html, 'utf8') > SITE_MAX_BYTES) continue;
    await d.db.update(siteVersions).set({ html }).where(and(eq(siteVersions.siteId, s.id), eq(siteVersions.version, s.version)));
    done++;
  }
  await setSetting(d.db, RENDER_KEY, RENDER_VERSION);
  return done;
}
