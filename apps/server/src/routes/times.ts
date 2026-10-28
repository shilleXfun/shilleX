import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ArticleCard, ArticleView, TimesFront, TimesReporter, TimesSection } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { timesArticles, users } from '../db/schema.ts';
import { requireUser } from '../lib/auth.ts';
import { errors } from '../lib/errors.ts';
import { parse } from '../lib/validate.ts';
import { REPORTERS, type Beat } from '../agents/times/reporters.ts';
import type { TimesDesk } from '../agents/times/desk.ts';

type Row = typeof timesArticles.$inferSelect;
const SECTIONS: TimesSection[] = ['markets', 'coins', 'drama', 'world', 'opinion', 'satire'];

async function reportersOf(db: Db, ids: string[]): Promise<Map<string, TimesReporter>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, [...new Set(ids)]));
  return new Map(rows.map((u) => {
    const r = REPORTERS.find((x) => x.handle === u.username);
    return [u.id, { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, title: r?.title ?? 'Reporter', beat: r?.beat ?? '' }];
  }));
}
const fallback = (id: string): TimesReporter => ({ username: id, displayName: 'Staff', avatarUrl: null, title: 'Reporter', beat: '' });
const card = (a: Row, by: Map<string, TimesReporter>): ArticleCard => ({
  slug: a.slug, section: a.section as TimesSection, kind: a.kind, label: a.label === 'SATIRE' ? 'SATIRE' : null, headline: a.headline, dek: a.dek, imageUrl: a.imageUrl,
  author: by.get(a.authorId) ?? fallback(a.authorId), publishedAt: a.publishedAt.toISOString(), breaking: a.breaking, reads: a.reads, excerpt: (a.body[0] ?? '').slice(0, 260),
});
const view = (a: Row, by: Map<string, TimesReporter>): ArticleView => ({ ...card(a, by), body: a.body, pullQuote: a.pullQuote, sources: a.sources });

/**
 * The Shillex Times (2026-10-28 brief §7): the front page (a lead story, the next four, each section's latest, the most read),
 * a section, an article with related stories. Public. An admin can make a reporter write now (POST /api/admin/times/publish).
 */
export async function registerTimesRoutes(app: FastifyInstance, desk: () => TimesDesk | null) {
  const { db, config } = app.deps;
  await app.register(async (r) => {
    r.get('/times', async (): Promise<TimesFront> => {
      const latest = await db.select().from(timesArticles).orderBy(desc(timesArticles.breaking), desc(timesArticles.publishedAt)).limit(5);
      const recentLead = latest.find((a) => a.breaking && Date.now() - a.publishedAt.getTime() < 6 * 3_600_000) ?? latest.find((a) => a.imageUrl) ?? latest[0];
      // The newest 150 are plenty to fill every section column.
      const bySection = await db.select().from(timesArticles).orderBy(desc(timesArticles.publishedAt)).limit(150);
      const most = await db.select().from(timesArticles).where(sql`${timesArticles.publishedAt} > now() - interval '7 days'`).orderBy(desc(timesArticles.reads)).limit(5);
      const all = [...latest, ...bySection, ...most];
      const by = await reportersOf(db, all.map((a) => a.authorId));
      const reporters = await db.select({ id: users.id }).from(users).where(inArray(users.username, REPORTERS.map((x) => x.handle)));
      const staff = await reportersOf(db, reporters.map((x) => x.id));
      const sections: Partial<Record<TimesSection, ArticleCard[]>> = {};
      for (const s of SECTIONS) sections[s] = bySection.filter((a) => a.section === s && a.id !== recentLead?.id).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 4).map((a) => card(a, by));
      return {
        lead: recentLead ? view(recentLead, by) : null, top: latest.filter((a) => a.id !== recentLead?.id).slice(0, 4).map((a) => card(a, by)), sections,
        mostRead: most.map((a) => card(a, by)), reporters: [...staff.values()],
      };
    });
    r.get<{ Params: { section: string } }>('/times/sections/:section', async (req) => {
      const s = req.params.section as TimesSection;
      if (!SECTIONS.includes(s)) throw errors.notFound('Section');
      const rows = await db.select().from(timesArticles).where(eq(timesArticles.section, s)).orderBy(desc(timesArticles.publishedAt)).limit(40);
      const by = await reportersOf(db, rows.map((a) => a.authorId));
      return { section: s, articles: rows.map((a) => card(a, by)) };
    });
    r.get<{ Params: { slug: string } }>('/times/a/:slug', async (req) => {
      const [a] = await db.update(timesArticles).set({ reads: sql`${timesArticles.reads} + 1` }).where(eq(timesArticles.slug, req.params.slug)).returning();
      if (!a) throw errors.notFound('Article');
      const related = await db.select().from(timesArticles).where(and(eq(timesArticles.section, a.section), ne(timesArticles.id, a.id))).orderBy(desc(timesArticles.publishedAt)).limit(4);
      const by = await reportersOf(db, [a.authorId, ...related.map((x) => x.authorId)]);
      return { article: view(a, by), related: related.map((x) => card(x, by)) };
    });
    r.post('/admin/times/publish', async (req) => {
      const u = requireUser(req);
      if (u.kind !== 'human' || !config.adminUsernames.includes(u.username)) throw errors.forbidden('ADMIN_ONLY', 'Admins only');
      const d = desk();
      if (!d) throw errors.conflict('TIMES_OFF', 'The Times is not running (TIMES, AGENTS or WORLD_HALTED)');
      const { beat } = parse(z.object({ beat: z.enum(['markets', 'coins', 'drama', 'world', 'satire']) }), req.body);
      const row = await d.publish(beat as Beat);
      return { published: row ? row.slug : null };
    });
  }, { prefix: '/api' });
}

