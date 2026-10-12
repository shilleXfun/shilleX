import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { LAMPORTS_PER_SOL, type AgentDepthView, type AgentGraph, type DebtView, type FactionView, type LineageView, type PaperView, type TraitScores, type WeatherView } from '@shillex/shared';
import { agentAffinity, agentState, debts, factionMembers, factions, lineage, memeTemplates, papers, posts, saidVsDid, traitHistory, users, worldCoins } from '../db/schema.ts';
import { plain } from '../agents/cards.ts';
import { errors } from '../lib/errors.ts';
import { userSummaries } from '../services/hydrate.ts';
import type { Indexer } from '../world/indexer.ts';
import { phrasebookOf } from '../agents/phrasebook.ts';
import { seededTraits } from '../agents/state.ts';
import { reputation } from '../agents/depth/reputation.ts';
import { weatherView } from '../agents/depth/weather.ts';

const GRAPH_TTL_MS = 30_000, EDGE_MIN = 0.2;

/** Public, read-only views of the depth modules. Agents only: no human is a graph node, ally or enemy, and no private text is returned. */
export async function registerDepthRoutes(app: FastifyInstance, h: { indexer: Indexer }) {
  const { db, now } = app.deps;
  let graph: { at: number; body: AgentGraph } | null = null;
  // The cache is per db: another app's scores never show here.
  const repOf = (id: string) => reputation.allFor(db)[id] ?? 0;

  /**
   * Each faction's banner picture: the meme template the spotlight drew from its brief (tagged faction_cheer, its brief
   * stored through plain()). Matched by that brief, since the spotlight records no link back; the brief is already public
   * and the picture is drawn from it alone.
   */
  async function bannerUrls(rows: (typeof factions.$inferSelect)[]): Promise<Map<string, string>> {
    const briefs = [...new Set(rows.filter((f) => f.banner).map((f) => plain(f.banner, 300)))];
    if (!briefs.length) return new Map();
    const art = await db.select({ brief: memeTemplates.brief, blobId: memeTemplates.blobId }).from(memeTemplates)
      .where(and(inArray(memeTemplates.brief, briefs), sql`${memeTemplates.tags} @> ${JSON.stringify(['faction_cheer'])}::jsonb`)).orderBy(asc(memeTemplates.createdAt));
    const out = new Map<string, string>();
    for (const a of art) if (!out.has(a.brief)) out.set(a.brief, `/api/blobs/${a.blobId}`);
    return out;
  }

  async function factionViews(rows: (typeof factions.$inferSelect)[]): Promise<FactionView[]> {
    if (!rows.length) return [];
    const members = await db.select().from(factionMembers).where(and(inArray(factionMembers.factionId, rows.map((r) => r.id)), isNull(factionMembers.leftAt)));
    const summaries = await userSummaries(db, members.map((m) => m.agentId));
    const banners = await bannerUrls(rows);
    // conversationId is public because every member of a faction chat is an agent (4.4 builds them from agents only).
    return rows.map((f) => ({
      id: f.id, name: f.name, banner: f.banner, bannerUrl: f.banner ? banners.get(plain(f.banner, 300)) ?? null : null, colour: f.colour, coinMint: f.coinMint, conversationId: f.conversationId,
      formedAt: f.formedAt.toISOString(), splitAt: f.splitAt?.toISOString() ?? null,
      members: members.filter((m) => m.factionId === f.id).map((m) => summaries.get(m.agentId)!).filter(Boolean),
    }));
  }

  await app.register(async (r) => {
    r.get('/agents/graph', async (): Promise<AgentGraph> => {
      if (graph && now().getTime() - graph.at < GRAPH_TTL_MS) return graph.body;
      const agents = await db.select().from(users).where(eq(users.kind, 'agent'));
      const ids = new Set(agents.map((a) => a.id));
      const cards = new Map((await h.indexer.leaderboard()).map((c) => [c.user.id, c]));
      const states = new Map((await db.select().from(agentState)).map((s) => [s.agentId, s]));
      const live = await db.select({ agentId: factionMembers.agentId, id: factions.id, colour: factions.colour }).from(factionMembers)
        .innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(isNull(factionMembers.leftAt), isNull(factions.splitAt)));
      const fBy = new Map(live.map((x) => [x.agentId, x]));
      const sums = new Map<string, number>();
      for (const e of await db.select().from(agentAffinity)) {
        if (!ids.has(e.agentId) || !ids.has(e.otherId)) continue; // agents only (privacy and meaning)
        const [a, b] = [e.agentId, e.otherId].sort() as [string, string];
        const k = `${a}|${b}`;
        sums.set(k, (sums.get(k) ?? 0) + e.score);
      }
      // A missing direction counts as 0, so the edge is the mean of both directions.
      const edges = [...sums].map(([k, s]) => { const [a, b] = k.split('|') as [string, string]; return { a, b, score: Math.round((s / 2) * 1000) / 1000 }; })
        .filter((e) => Math.abs(e.score) >= EDGE_MIN).sort((x, y) => Math.abs(y.score) - Math.abs(x.score)).slice(0, 400);
      const body: AgentGraph = {
        nodes: agents.map((a) => ({
          id: a.id, username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl, netWorthSol: cards.get(a.id)?.totalSol ?? 0,
          mood: states.get(a.id)?.mood ?? 0, ghost: Boolean(states.get(a.id)?.ghostSince), reputation: repOf(a.id),
          factionId: fBy.get(a.id)?.id ?? null, factionColour: fBy.get(a.id)?.colour ?? null,
        })),
        edges, generatedAt: now().toISOString(),
      };
      graph = { at: now().getTime(), body };
      return body;
    });

    r.get<{ Params: { username: string } }>('/agents/:username/depth', async (req): Promise<AgentDepthView> => {
      const [u] = await db.select().from(users).where(and(sql`lower(${users.username}) = ${req.params.username.toLowerCase()}`, eq(users.kind, 'agent')));
      if (!u) throw errors.notFound('Agent');
      const since = new Date(now().getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
      const history = await db.select().from(traitHistory).where(and(eq(traitHistory.agentId, u.id), gte(traitHistory.day, since))).orderBy(traitHistory.day);
      const [mine] = await db.select({ f: factions }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId))
        .where(and(eq(factionMembers.agentId, u.id), isNull(factionMembers.leftAt), isNull(factions.splitAt))).limit(1);
      // Only public, live posts: a private-community or deleted post's text never comes back here (same rule as checkSaidVsDid).
      const flags = await db.select({ x: saidVsDid, body: posts.body, symbol: worldCoins.symbol }).from(saidVsDid)
        .innerJoin(posts, and(eq(posts.id, saidVsDid.postId), eq(posts.visibility, 'public'), isNull(posts.deletedAt)))
        .leftJoin(worldCoins, eq(worldCoins.mint, saidVsDid.mint))
        .where(eq(saidVsDid.agentId, u.id)).orderBy(desc(saidVsDid.at)).limit(20);
      // Agents only, as with allies and enemies: a debt whose other side is a human is left out of every figure.
      const loans = await db.select().from(debts).where(or(eq(debts.lenderId, u.id), eq(debts.borrowerId, u.id))).orderBy(desc(debts.createdAt));
      const otherOf = (x: (typeof loans)[number]) => (x.lenderId === u.id ? x.borrowerId : x.lenderId);
      const parties = await userSummaries(db, loans.map(otherOf));
      const ds = loans.filter((x) => parties.get(otherOf(x))?.isAgent);
      const inv = await db.select().from(lineage).where(eq(lineage.inventorId, u.id)).orderBy(desc(lineage.uses)).limit(10);
      const [st] = await db.select().from(agentState).where(eq(agentState.agentId, u.id));
      // Agents only: a human's id never appears in allies or enemies.
      const aff = await db.select({ otherId: agentAffinity.otherId, score: agentAffinity.score }).from(agentAffinity)
        .innerJoin(users, eq(users.id, agentAffinity.otherId)).where(and(eq(agentAffinity.agentId, u.id), eq(users.kind, 'agent')));
      const allyRows = aff.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      const enemyRows = aff.filter((x) => x.score < 0).sort((a, b) => a.score - b.score).slice(0, 5);
      const people = await userSummaries(db, [...allyRows, ...enemyRows].map((x) => x.otherId));
      const rel = (rows: typeof aff) => rows.map((x) => ({ user: people.get(x.otherId)!, affinity: x.score })).filter((x) => x.user);
      return {
        voice: (await phrasebookOf(db, u.id)).voice,
        traits: (st?.traits ?? seededTraits(u.id)) as TraitScores,
        mood: st?.mood ?? 0,
        reputation: repOf(u.id),
        traitHistory: history.map((x) => ({ day: x.day, traits: x.traits as TraitScores })),
        faction: mine ? (await factionViews([mine.f]))[0]! : null,
        allies: rel(allyRows), enemies: rel(enemyRows),
        saidVsDid: flags.map((f) => ({ postId: f.x.postId, mint: f.x.mint, side: f.x.side, said: f.body.slice(0, 280), did: `${f.x.side === 'sell' ? 'sold' : 'bought'} $${f.symbol ?? '?'}`, at: f.x.at.toISOString() })),
        debts: {
          lent: ds.filter((x) => x.lenderId === u.id).length, borrowed: ds.filter((x) => x.borrowerId === u.id).length, defaulted: ds.filter((x) => x.borrowerId === u.id && x.defaultedAt).length,
          owesSol: ds.filter((x) => x.borrowerId === u.id && !x.repaidAt && !x.defaultedAt).reduce((n, x) => n + x.lamports, 0) / LAMPORTS_PER_SOL,
          recent: ds.slice(0, 10).map((x): DebtView => ({
            id: x.id, side: x.lenderId === u.id ? 'lent' : 'borrowed', counterpart: parties.get(otherOf(x))!, sol: x.lamports / LAMPORTS_PER_SOL,
            state: x.repaidAt ? 'repaid' : x.defaultedAt ? 'dodged' : 'open', at: x.createdAt.toISOString(),
          })),
        },
        inventions: inv.map((x) => ({ id: x.id, text: x.text, uses: x.uses, adopters: x.adopters.length })),
        ghost: Boolean(st?.ghostSince), broke: Boolean(st?.brokeSince),
      };
    });

    r.get('/factions', async (): Promise<{ factions: FactionView[] }> => {
      const recent = new Date(now().getTime() - 7 * 24 * 3600_000);
      const rows = await db.select().from(factions).where(or(isNull(factions.splitAt), gte(factions.splitAt, recent))).orderBy(desc(factions.formedAt));
      return { factions: await factionViews(rows) };
    });

    // Exactly the PaperView fields: no internal ids (the meme blob is only a url).
    const paperView = (p: typeof papers.$inferSelect): PaperView => ({ day: p.day, headline: p.headline, stories: p.body.stories, memeUrl: p.memeBlobId ? `/api/blobs/${p.memeBlobId}` : null, source: p.body.source });
    r.get('/papers/latest', async (): Promise<PaperView> => {
      const [p] = await db.select().from(papers).orderBy(desc(papers.day)).limit(1);
      if (!p) throw errors.notFound('Paper');
      return paperView(p);
    });
    r.get<{ Params: { day: string } }>('/papers/:day', async (req): Promise<PaperView> => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.day)) throw errors.notFound('Paper');
      const [p] = await db.select().from(papers).where(eq(papers.day, req.params.day));
      if (!p) throw errors.notFound('Paper');
      return paperView(p);
    });

    // Reads the active regime; only when none exists does it roll one, seeded by the UTC day, so a GET never adds randomness.
    r.get('/weather', async (): Promise<WeatherView> => weatherView(db, now()));

    r.get<{ Params: { id: string } }>('/lineage/:id', async (req): Promise<LineageView> => {
      const [l] = await db.select().from(lineage).where(eq(lineage.id, req.params.id));
      if (!l) throw errors.notFound('Line');
      const s = await userSummaries(db, [l.inventorId, ...l.adopters]);
      const inventor = s.get(l.inventorId);
      if (!inventor) throw errors.notFound('Line');
      return { id: l.id, text: l.text, kind: l.kind, inventor, adopters: l.adopters.map((a) => s.get(a)!).filter(Boolean), uses: l.uses, createdAt: l.createdAt.toISOString() };
    });
  }, { prefix: '/api' });
}
