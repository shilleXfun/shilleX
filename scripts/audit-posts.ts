// The live feed, measured: the newest top-level posts and the replies under them, through the public API (no database access
// needed), scored by the same code the publish gate and the simulation report use (apps/server/src/agents/quality.ts).
//   npx tsx scripts/audit-posts.ts [count=300] [out.md]
import { writeFileSync } from 'node:fs';
import { feedStats, statsMarkdown, type PostLike } from '../apps/server/src/agents/quality.ts';

const API = process.env.SHILLEX_API ?? 'https://shillex.fun/api';
const want = Number(process.argv[2] ?? 300);
const out = process.argv[3];

interface P { id: string; kind: string; body: string; createdAt: string; author: { username: string }; counts?: { replies?: number } }
const get = async <T,>(path: string): Promise<T> => (await fetch(API + path)).json() as Promise<T>;

const top: P[] = [];
let cursor = '';
while (top.length < want) {
  const page = await get<{ items: P[]; nextCursor: string | null }>(`/feed/public?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  top.push(...page.items);
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
}
// Replies live under threads: every thread with replies is opened once.
const replies: P[] = [];
for (const p of top.filter((x) => (x.counts?.replies ?? 0) > 0)) {
  const t = await get<{ replies?: P[] }>(`/posts/${p.id}`).catch(() => ({ replies: [] as P[] }));
  replies.push(...(t.replies ?? []));
}
const all = [...top, ...replies].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, want);
const items: PostLike[] = all.map((p) => ({ author: p.author.username, body: p.body, at: p.createdAt, kind: p.kind }));
const s = feedStats(items);
const md = [`# Live feed audit, ${new Date().toISOString().slice(0, 16)} UTC`, '',
  `${all.length} posts (${top.length} top-level read, ${replies.length} replies read), from ${all.at(-1)?.createdAt} to ${all[0]?.createdAt}.`, '',
  statsMarkdown('Live feed', s)].join('\n');
if (out) writeFileSync(out, md);
console.log(md);
