import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import { agentCast, agentDesks, mediaBlobs, agentGoals, agentMemories, factionMembers, factions, productBriefs, siteBuilds, siteVersions, sites, users, worldCoins, type ProductBrief, type ProductBriefRow, type SiteRow } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import type { AgentBrain } from '../world/brain.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { runTool, type ToolContext } from '../world/tools.ts';
import { actorFor } from '../agents/act.ts';
import { modelName, type ModelBudget } from '../agents/haiku.ts';
import { MEMORY_HEADING, recallLines } from '../agents/minds.ts';
import { calibration } from '../agents/depth/desk.ts';
import { queueAround, queueReaction } from '../agents/reactions.ts';
import { agentsOnly, memberById, memberLines, plain } from '../agents/scenes/cast.ts';
import { freeSlug, insertSite, originOf, rebuildSite, setAnnouncement, siteUrl } from './store.ts';
import { SITE_PROMPT_VERSION } from './plan.ts';
import { personaOf } from '../agents/personas.ts';
import { arcsOf } from '../agents/arcs.ts';
import { productCoin } from './product-coin.ts';
import { captureSite, type StudioRender } from './shots.ts';
import type { SiteDeps } from './build.ts';
import { tripOn } from '../agents/moments.ts';
import { SITE_DATA, siteData } from './data.ts';
import { siteCsp } from './routes.ts';
import { studioBuild, type StudioBrief, type StudioPurpose } from './studio.ts';

/**
 * Websites agents make (2026-10-27): every site, a product, a coin's, a home page, a faction's or the next version of one, is designed
 * from nothing by its agent in the studio (sites/studio.ts): its own brief, a page written from scratch, a real render, a look at
 * its own screenshots, and a gate. There are no genres and no templates any more, and without a model nothing is built: a page an
 * agent did not design is not its site. Publishing happens last, so nothing half-made is ever shown.
 */
type ProductDeps = Omit<SiteDeps, 'brain' | 'budget'> & { brain: AgentBrain | null; budget: ModelBudget | null;
  /** Tests stand in for the browser here. */ render?: (html: string) => Promise<StudioRender | null> };

/** What starts a build: a new product, a coin's site, a home page, a faction's site, or the next version of a site. */
export type StudioJob = { site: 'product'; collab?: { withId: string; idea: string }; forkOf?: string } | { site: 'improve'; siteId: string } | { site: 'faction'; factionId: string } | { site: 'coin'; mint: string } | { site: 'personal' };

const kitFor = (avatar: string, coin: { mint: string; symbol: string } | null) =>
  `IMAGE PATHS YOU MAY USE: your avatar ${avatar}${coin ? `; your coin's mark /api/agents/coin-image/${coin.mint}.svg` : ''}.`;

/** The studio's brief kept in the shape older briefs have (a product's fields), with the whole design beside it. */
export function asProductBrief(b: StudioBrief): ProductBrief {
  return {
    name: b.title, tagline: b.tagline, genre: b.aesthetic.split(/[,:;(.]/)[0]!.trim().slice(0, 40) || 'site', tie: b.why, problem: b.concept, user: 'visitors',
    coreAction: b.interaction, loop: b.toy, distinct: b.aesthetic, revisit: b.motion, coinRole: '', success: '', fallbackScope: '', announcement: b.announcement,
    palette: { bg: b.palette[0] ?? '#000000', fg: b.palette[1] ?? '#ffffff', accent: b.palette[2] ?? '#ff3366' }, design: b,
  };
}

/** Everything the agent knows about itself that a product could come from: who it is, what it is after, what it remembers, how it trades. */
async function selfFacts(d: ProductDeps, agentId: string): Promise<{ text: string; username: string; coin: { mint: string; symbol: string } | null; avatar: string } | null> {
  const now = d.now();
  const me = await memberById(d, agentId);
  const [u] = await d.db.select().from(users).where(eq(users.id, agentId));
  if (!me || !u) return null;
  const parts = [`YOU:\n${memberLines(me, now)}`];
  const [cast] = await d.db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, agentId));
  if (cast) parts.push(`YOUR PART IN THE WORLD: ${cast.role}`);
  // Who it is (agents/personas.ts) and the story it is in now (agents/arcs.ts): the product has to come out of both (Phase 4).
  const persona = await personaOf(d.db, agentId);
  if (persona) parts.push(`YOUR PERSONA: your job here is ${persona.job}. ${plain(persona.background)} You believe: ${plain(persona.worldview)} Your humor: ${plain(persona.humor)}.`);
  const arcs = await arcsOf(d.db, agentId, 4);
  const live = arcs.filter((a) => !a.resolvedAt), ended = arcs.filter((a) => a.resolvedAt && now.getTime() - a.resolvedAt.getTime() < 7 * 86_400_000);
  if (live.length || ended.length) parts.push(`YOUR STORY RIGHT NOW:\n${[...live.map((a) => `- ${plain(a.title)} (a ${a.kind.replace(/_/g, ' ')}, still going)`), ...ended.map((a) => `- ${plain(a.title)} (a ${a.kind.replace(/_/g, ' ')}, ended: ${plain(a.outcome ?? 'unresolved')})`)].join('\n')}`);
  const [goal] = await d.db.select().from(agentGoals).where(and(eq(agentGoals.agentId, agentId), isNull(agentGoals.endedAt)));
  if (goal) parts.push(`WHAT YOU ARE AFTER: ${goal.kind} (${plain(goal.why)})`);
  const mem = await recallLines(d.db, agentId, { limit: 6 }, now);
  if (mem.length) parts.push(`${MEMORY_HEADING}\n${mem.join('\n')}`);
  const [desk] = await d.db.select().from(agentDesks).where(eq(agentDesks.agentId, agentId));
  const cal = await calibration(d.db, agentId);
  if (desk) parts.push(`HOW YOU TRADE (on paper): ${desk.style}; ${plain(desk.lessons)}${cal.n ? ` Record: ${Math.round(cal.winRate * cal.n)} wins in your last ${cal.n} calls.` : ''}`);
  const [coin] = await d.db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins).where(and(eq(worldCoins.creatorId, agentId), isNull(worldCoins.archivedAt))).orderBy(desc(worldCoins.launchedAt)).limit(1);
  parts.push(coin ? `YOUR COIN: $${coin.symbol} (a Shillex devnet coin, no real value). It may support the product (a leaderboard, a credit, provenance) only in ways the page really implements.`
    : 'YOU HAVE NO COIN: say so honestly if the product mentions coins at all; do not invent one.');
  const scrubbed = await agentsOnly(d.db, parts.join('\n\n'));
  return { text: scrubbed.text, username: u.username, coin: coin ?? null, avatar: `/api/agents/avatars/${u.id}.svg` };
}

/** A faction a product is built for: its name, and a few lines on who is in it, its coin and how long it has stood. */
export interface FactionFacts { id: string; name: string; coinMint: string | null; text: string }
async function factionFacts(d: ProductDeps, factionId: string): Promise<FactionFacts | null> {
  const [f] = await d.db.select().from(factions).where(and(eq(factions.id, factionId), isNull(factions.splitAt)));
  if (!f) return null;
  const members = await d.db.select({ u: users.username }).from(factionMembers).innerJoin(users, eq(users.id, factionMembers.agentId))
    .where(and(eq(factionMembers.factionId, f.id), isNull(factionMembers.leftAt)));
  const [coin] = f.coinMint ? await d.db.select({ symbol: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, f.coinMint)) : [];
  const days = Math.max(1, Math.round((d.now().getTime() - f.formedAt.getTime()) / 86_400_000));
  const others = await d.db.select({ name: factions.name }).from(factions).where(and(isNull(factions.splitAt))).limit(8);
  const text = (await agentsOnly(d.db, `${plain(f.name)}, standing for ${days} day(s); its members: ${members.map((m) => `@${m.u}`).join(', ')}.${coin ? ` Its coin: $${coin.symbol}.` : ' It has no coin.'} The other factions: ${others.filter((o) => o.name !== f.name).map((o) => plain(o.name)).join(', ') || 'none'}.`)).text;
  return { id: f.id, name: plain(f.name), coinMint: f.coinMint, text };
}

/** Whether a product has something new to be about since its last version, without any model call. */
export async function improvementReason(db: SiteDeps['db'], site: SiteRow, viewsAtVersion: number, now: Date): Promise<string | null> {
  if (now.getTime() - site.updatedAt.getTime() < 3 * 86_400_000) return null;
  const fresh = await db.select({ text: agentMemories.text }).from(agentMemories)
    .where(and(eq(agentMemories.agentId, site.authorId), gte(agentMemories.at, site.updatedAt), gte(agentMemories.weight, 2))).orderBy(desc(agentMemories.at)).limit(5);
  const visitors = site.views - viewsAtVersion;
  if (!fresh.length && visitors < 5) return null;
  return [...fresh.map((m) => `- ${plain(m.text)}`), ...(visitors > 0 ? [`- ${visitors} visits since the last version`] : [])].join('\n');
}


/** The kind of site a job makes, as stored. */
const kindOf = (job: StudioJob, site: SiteRow | null) => (site ? site.kind : job.site === 'faction' ? 'faction' : job.site === 'coin' ? 'coin' : job.site === 'personal' ? 'personal' : 'product');

/**
 * Builds a site for this agent in the studio, or its next version. Returns a job outcome; throws only on failures a retry could fix
 * (the job ledger records and backs off). `force`: a version even when nothing changed (a site from before the studio).
 */
export async function buildProduct(d: ProductDeps, agentId: string, job: StudioJob, opts: { force?: string; /** The daily remaster: the stronger model, paid by the house, announced as such. */ remaster?: boolean } = {}): Promise<{ status: 'ok' | 'skipped'; note: string }> {
  if (!d.brain || !d.budget) return { status: 'skipped', note: 'no model: a site is only built by its agent' };
  const now = d.now();
  const facts = await selfFacts(d, agentId);
  if (!facts) return { status: 'skipped', note: 'no agent' };
  const faction = job.site === 'faction' ? await factionFacts(d, job.factionId) : null;
  if (job.site === 'faction' && !faction) return { status: 'skipped', note: 'the faction is gone' };
  const [coinRow] = job.site === 'coin' ? await d.db.select({ mint: worldCoins.mint, symbol: worldCoins.symbol }).from(worldCoins).where(eq(worldCoins.mint, job.mint)) : [];
  if (job.site === 'coin' && !coinRow) return { status: 'skipped', note: 'the coin is gone' };
  let site: SiteRow | null = null, purpose: StudioPurpose, current: string | undefined;
  let forked: { id: string; author: string; authorId: string; title: string; reference: { text: string; jpeg: Buffer | null } } | null = null;
  if (job.site === 'improve') {
    site = (await d.db.select().from(sites).where(and(eq(sites.id, job.siteId), eq(sites.authorId, agentId), isNull(sites.removedAt))))[0] ?? null;
    if (!site) return { status: 'skipped', note: 'no site to improve' };
    const [brief] = await d.db.select().from(productBriefs).where(eq(productBriefs.siteId, site.id)).orderBy(desc(productBriefs.createdAt)).limit(1);
    const why = opts.force ?? await improvementReason(d.db, site, Number((brief?.note ?? '').match(/views=(\d+)/)?.[1] ?? 0), now);
    if (!why) {
      await d.db.insert(siteBuilds).values({ id: newId(), agentId, siteId: site.id, briefId: brief?.id ?? null, kind: 'improve', status: 'skipped', model: 'none', note: 'no improvement needed: nothing changed', startedAt: now, finishedAt: now });
      return { status: 'skipped', note: 'no improvement needed' };
    }
    current = (await d.db.select({ html: siteVersions.html }).from(siteVersions).where(and(eq(siteVersions.siteId, site.id), eq(siteVersions.version, site.version))))[0]?.html;
    purpose = { kind: 'version', title: site.title, version: site.version + 1, changes: why.replace(/\n/g, '; ').slice(0, 400) };
  } else {
    // Built together (collab_with): the partner's handle and the idea they agreed on.
    const partner = job.site === 'product' && job.collab ? (await d.db.select({ u: users.username }).from(users).where(eq(users.id, job.collab.withId)))[0]?.u ?? null : null;
    // A fork or a parody (build_site fork_of): the original's brief and its last screenshot go with the brief step.
    if (job.site === 'product' && job.forkOf) {
      const [o] = await d.db.select({ s: sites, author: users.username }).from(sites).innerJoin(users, eq(users.id, sites.authorId)).where(and(eq(sites.id, job.forkOf), isNull(sites.removedAt)));
      if (!o || o.s.authorId === agentId) return { status: 'skipped', note: 'nothing to fork' };
      const [b] = await d.db.select({ brief: productBriefs.brief }).from(productBriefs).where(eq(productBriefs.siteId, o.s.id)).orderBy(desc(productBriefs.createdAt)).limit(1);
      const [v] = await d.db.select({ blob: siteVersions.screenshotBlobId }).from(siteVersions).where(and(eq(siteVersions.siteId, o.s.id), eq(siteVersions.version, o.s.version)));
      const [img] = v?.blob ? await d.db.select({ bytes: mediaBlobs.bytes }).from(mediaBlobs).where(eq(mediaBlobs.id, v.blob)) : [];
      const design = b?.brief.design;
      forked = { id: o.s.id, author: o.author, authorId: o.s.authorId, title: plain(o.s.title), reference: { text: `"${plain(o.s.title)}" by @${o.author} (/sites/${o.s.slug}): ${plain(o.s.blurb)}${design ? ` Its design: ${plain(design.aesthetic)}; ${plain(design.concept)} The toy: ${plain(design.toy)}.` : ''}`, jpeg: img?.bytes ? Buffer.from(img.bytes) : null } };
    }
    purpose = job.site === 'faction' ? { kind: 'faction', name: faction!.name, facts: faction!.text } : job.site === 'coin' ? { kind: 'coin', symbol: coinRow!.symbol } : job.site === 'personal' ? { kind: 'personal' }
      : { kind: 'product', ...(forked ? { collab: `as your fork or parody of @${forked.author}'s "${forked.title}"` } : partner && job.site === 'product' && job.collab ? { collab: `together with @${partner}, the idea you both agreed on: ${plain(job.collab.idea).slice(0, 300)}` } : {}) };
  }
  // Opus while it is up and within its day's money, paid by the house (owner, 2026-10-29); the everyday model otherwise.
  const pro = d.siteModel?.usable() ? d.siteModel : null;
  const label = pro?.model ?? modelName();
  const { id: turnId } = await startTurn(d.db, { agentId, triggers: [{ type: job.site === 'coin' ? 'launch' : 'heartbeat', note: `website (${purpose.kind})` }], model: label, effort: 'medium', promptVersion: SITE_PROMPT_VERSION, snapshotId: null, now });
  const buildId = newId();
  await d.db.insert(siteBuilds).values({ id: buildId, agentId, siteId: site?.id ?? null, briefId: null, kind: site ? 'improve' : 'new', status: 'building', model: label, startedAt: now });
  const spent = { usd: 0 };
  const toolCalls: ToolCallRecord[] = [];
  let outcome: { status: 'ok' | 'skipped'; note: string } = { status: 'skipped', note: '' }, thrown: unknown = null, turnStatus: 'acted' | 'failed' | 'quiet' = 'failed';
  let briefRow: ProductBriefRow | undefined;
  try {
    const publicUrl = d.app.deps.config.publicUrl.replace(/\/+$/, '');
    const coinMint = site?.coinMint ?? coinRow?.mint ?? (faction ? faction.coinMint : null) ?? facts.coin?.mint ?? null;
    // What the bridge answers with while the page is studied: the same public data a visitor's page would get.
    const pseudo = { authorId: agentId, coinMint } as SiteRow;
    const data = Object.fromEntries(await Promise.all(SITE_DATA.map(async (k) => [k, await siteData(d.db, site ?? pseudo, k).catch(() => null)] as const)));
    const recent = (await d.db.select({ brief: productBriefs.brief }).from(productBriefs).where(inArray(productBriefs.status, ['published', 'building'])).orderBy(desc(productBriefs.createdAt)).limit(30))
      .map((r) => ({ aesthetic: r.brief.design?.aesthetic ?? r.brief.genre ?? '', concept: r.brief.design?.concept ?? r.brief.problem ?? '' }));
    const made = await studioBuild({
      db: d.db, brain: pro?.brain ?? d.brain, budget: pro?.budget ?? d.budget, now: d.now, turnId, spent, username: facts.username, facts: facts.text, kit: kitFor(facts.avatar, coinRow ?? facts.coin), purpose,
      recent, current, origin: originOf(publicUrl), csp: siteCsp(originOf(publicUrl)), data, ...(d.render ? { render: d.render } : {}),
      ...(opts.remaster ? { tier: 2 as const, house: true } : {}), ...(pro ? { house: true, priceAs: pro.model } : {}), ...(forked ? { reference: forked.reference } : {}),
    });
    const brief = asProductBrief(made.brief);
    [briefRow] = await d.db.insert(productBriefs).values({ id: newId(), agentId, siteId: site?.id ?? null, name: plain(brief.name).slice(0, 60), genre: brief.genre, brief, status: made.html ? 'building' : 'failed', note: made.html ? null : made.problems.join('; ').slice(0, 500), model: label, createdAt: now, updatedAt: now }).returning();
    await d.db.update(siteBuilds).set({ briefId: briefRow!.id }).where(eq(siteBuilds.id, buildId));
    if (!made.html) {
      // Two tries and still not good enough: dropped, never shipped half-broken (the live version, if any, stays).
      await d.db.update(siteBuilds).set({ status: 'failed_validation', problems: made.problems, attempts: made.attempts, costUsd: spent.usd, finishedAt: d.now(), note: 'dropped after two tries; the published version, if any, stays' }).where(eq(siteBuilds.id, buildId));
      outcome = { status: 'skipped', note: `dropped: ${made.problems.slice(0, 2).join('; ')}` };
      turnStatus = 'quiet';
    } else {
      const title = plain(brief.name).slice(0, 60), blurb = plain(brief.tagline).slice(0, 200);
      const build = { title, blurb, html: made.html, turnId, model: label, now: d.now() };
      const published = site ? await rebuildSite(d.db, site.id, build)
        : await insertSite(d.db, await freeSlug(d.db, brief.name), { ...build, authorId: agentId, kind: kindOf(job, null), coinMint, factionId: faction?.id ?? null, coAuthorId: job.site === 'product' ? job.collab?.withId ?? null : null, forkOfId: forked?.id ?? null });
      await d.db.update(siteVersions).set({ notes: made.notes ? plain(made.notes).slice(0, 300) : null }).where(and(eq(siteVersions.siteId, published.id), eq(siteVersions.version, published.version)));
      await d.db.update(productBriefs).set({ siteId: published.id, status: 'published', note: `views=${published.views}`, updatedAt: d.now() }).where(eq(productBriefs.id, briefRow!.id));
      await d.db.update(siteBuilds).set({ siteId: published.id, status: 'published', version: published.version, problems: made.problems, attempts: made.attempts, costUsd: spent.usd, finishedAt: d.now() }).where(eq(siteBuilds.id, buildId));
      toolCalls.push({ name: 'build_site', input: { kind: kindOf(job, site), title, aesthetic: brief.genre }, ok: true, result: { url: siteUrl(published.slug), version: published.version } });
      // The agent says it in its own words (the brief's announcement), with the address at the end.
      const [agent] = await d.db.select().from(users).where(eq(users.id, agentId));
      // A remaster says so; a fork credits its original if the agent's own words did not.
      const own = plain(brief.announcement).slice(0, 240);
      const said = opts.remaster ? `Remastered: ${title}, version ${published.version}. ${plain(made.notes ?? '').slice(0, 180)}`.trim()
        : site ? `${title}, version ${published.version}: ${plain(made.notes ?? 'remade').slice(0, 200)}`
        : forked && !own.includes(`@${forked.author}`) ? `${own} (my take on @${forked.author}'s "${forked.title}")` : own;
      const body = `${said}\n\n${publicUrl}${siteUrl(published.slug)}`;
      const ctx: ToolContext = { app: d.app, db: d.db, actor: actorFor(d.app), chain: d.chain, events: d.events, agent: agent!, turnId, worldKey: d.worldKey, now: d.now, publicUrl };
      const out = await runTool(ctx, 'post', { body });
      toolCalls.push({ name: 'post', input: { body }, ok: out.ok, result: out.result });
      const postId = out.ok ? (out.result as { post_id?: string } | null)?.post_id : undefined;
      if (postId) await setAnnouncement(d.db, published.id, published.version, postId);
      // A new site gets reviewed under its announcement by its author's friends and rivals (agents/reactions.ts).
      // The original's author hears about the fork, under its announcement.
      if (postId && forked) await queueReaction(d.db, { agentId: forked.authorId, kind: 'reply', format: 'review', event: `@${agent!.username} forked your site "${forked.title}" into "${title}"`, postId, aboutId: agentId }, d.now()).catch(() => undefined);
      if (postId && !site) await queueAround(d.db, { actorId: agentId, event: `@${agent!.username} just published a new site${faction ? ` for ${faction.name}` : ''}, "${title}": ${blurb}`, friendFormat: 'review', rivalFormat: 'review', postId, max: 2 }, d.now()).catch(() => undefined);
      // A new product may get its own devnet coin (hybrid mode), launched by its builder or a dev it likes; the two pages link.
      if (!site && kindOf(job, null) === 'product' && !published.coinMint) await productCoin(d, { builderId: agentId, siteId: published.id, slug: published.slug, title, brief }).catch((e) => console.error('[products] product coin failed', (e as Error).message));
      // The screenshot comes after: a slow or failed capture never holds up publishing (the last good one stands).
      void captureSite(d.app, published.id, published.slug, published.version).catch((e) => console.error('[shots] capture failed', (e as Error).message));
      outcome = { status: 'ok', note: `${site ? 'remade' : 'built'} ${siteUrl(published.slug)} v${published.version} (${brief.genre})` };
      turnStatus = 'acted';
    }
  } catch (e) {
    // An account problem (a refused key, a usage limit) pauses every model caller (halt.ts): the build waits for the brain.
    if (tripOn(d.halt, e)) { thrown = null; outcome = { status: 'skipped', note: 'the brain is halted' }; turnStatus = 'quiet'; }
    else thrown = e;
    await d.db.update(siteBuilds).set({ status: 'failed', problems: [(e as Error).message.slice(0, 300)], costUsd: spent.usd, finishedAt: d.now() }).where(eq(siteBuilds.id, buildId)).catch(() => undefined);
    if (briefRow) await d.db.update(productBriefs).set({ status: 'failed', note: (e as Error).message.slice(0, 300), updatedAt: d.now() }).where(eq(productBriefs.id, briefRow.id)).catch(() => undefined);
  }
  await finishTurn(d.db, turnId, { status: turnStatus, context: [{ kind: 'site', text: outcome.note || 'site build' }], reasoning: thrown ? `failed: ${(thrown as Error).message}` : outcome.note, toolCalls, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: spent.usd, finishedAt: d.now() })
    .catch((e) => console.error('[products] build turn left unsealed until restart', turnId, e));
  if (thrown) throw thrown;
  return outcome;
}
