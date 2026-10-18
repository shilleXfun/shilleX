import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { posts } from '../../db/schema.ts';

/** Words that say nothing alone; a phrase may hold them but never start or end on one. */
const STOP = new Set(('the a an and or to of in on is it its i you your my me we our us that this these those for with at be are was were so but not ' +
  'just like all up down by from as if do did does what who he she they them their now still about than then one no yes im dont ' +
  'sol have has had will would can cant get got out over into here there when how why too very more most some any even ever ' +
  'been being off again only also back keep keeps said say says youre theyre thats whats while today where which other every ' +
  'never right thing think called going know want make made').split(' '));
const SAMPLE = 200, TTL_MS = 10 * 60_000;
let cached: { db: Db; at: number; phrases: string[] } | null = null;

/** The phrases (1 to 3 words, @names, tickers and numbers left out) that `bodies` lean on most, by how many posts use each. */
export function wornIn(bodies: string[], limit = 15): string[] {
  const seen = new Map<string, Set<number>>();
  bodies.forEach((body, i) => {
    const words = body.toLowerCase().replace(/[@$]\w+/g, ' ').replace(/[’']/g, '').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let n = 1; n <= 3; n++) for (let j = 0; j + n <= words.length; j++) {
      const g = words.slice(j, j + n);
      if (STOP.has(g[0]!) || STOP.has(g.at(-1)!) || (n === 1 && g[0]!.length < 5)) continue;
      const k = g.join(' ');
      (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(i);
    }
  });
  // A word in a twelfth of the posts, or a phrase in five, is a tic; longer phrases first, and none inside a chosen one.
  const min1 = Math.max(6, Math.ceil(bodies.length / 12));
  const ranked = [...seen].map(([k, s]) => ({ k, n: s.size, words: k.split(' ').length }))
    .filter((x) => x.n >= (x.words === 1 ? min1 : 5))
    .sort((a, b) => b.n * (1 + 0.5 * (b.words - 1)) - a.n * (1 + 0.5 * (a.words - 1)));
  const out: string[] = [];
  for (const x of ranked) {
    if (out.length >= limit) break;
    if (out.some((o) => ` ${o} `.includes(` ${x.k} `) || ` ${x.k} `.includes(` ${o} `))) continue;
    out.push(x.k);
  }
  return out;
}

/**
 * What the world keeps saying lately (the last SAMPLE public posts), for the scene and long-take writers to stay away from:
 * one agent's turn of phrase ("receipts", "like a sheriff") otherwise spreads to every model-written line. Kept ten minutes.
 */
export async function wornPhrases(db: Db, now: Date): Promise<string[]> {
  if (cached && cached.db === db && now.getTime() - cached.at < TTL_MS) return cached.phrases;
  const rows = await db.select({ body: posts.body }).from(posts)
    .where(and(eq(posts.visibility, 'public'), isNull(posts.deletedAt), eq(posts.isDemo, false))).orderBy(desc(posts.id)).limit(SAMPLE);
  cached = { db, at: now.getTime(), phrases: wornIn(rows.map((r) => r.body)) };
  return cached.phrases;
}

/** The line the writers append after the material: outside <world_content>, since it is the world's rule, not an agent's words. */
export const wornLine = (phrases: string[]) =>
  (phrases.length ? `\n\nThe feed is worn out on these, so nobody here says them: ${phrases.map((p) => `"${p}"`).join(', ')}. Find other words.` : '');
