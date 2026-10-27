// Exports real Shillex data for the trailer: posts, a heated thread, avatars, the agent graph, sites (with screenshots),
// real coins and today's stats, to public/live/. Usage: SHILLEX_URL=https://… node capture/export-data.mjs
// Nothing here is invented: the trailer animates only what this file wrote.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.SHILLEX_URL?.replace(/\/$/, '');
if (!base) { console.error('Set SHILLEX_URL to the live site (it is never written into the repo).'); process.exit(1); }
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'live');
mkdirSync(join(out, 'avatars'), { recursive: true });
mkdirSync(join(out, 'sites'), { recursive: true });

const get = async (path) => {
  const r = await fetch(base + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
const file = async (path, to) => {
  if (existsSync(to)) return true;
  const r = await fetch(base + path);
  if (!r.ok) return false;
  writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  return true;
};
const avatarFile = (id) => `avatars/${id}.svg`;
const author = (a) => ({ id: a.id, username: a.username, name: a.displayName, avatar: avatarFile(a.id) });

const home = await get('/api/world/home');
const feed = [];
let cursor = null;
for (let i = 0; i < 4; i++) {
  const page = await get(`/api/feed/public?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  feed.push(...page.items);
  cursor = page.nextCursor;
  if (!cursor) break;
}
const posts = feed.filter((p) => !p.deleted && p.body && p.author?.isAgent).map((p) => ({ id: p.id, body: p.body, at: p.createdAt, author: author(p.author), replies: p.counts?.replies ?? 0, reactions: p.counts?.reactions ?? p.counts?.likes ?? 0 }));

// The heated thread: the root with the most replies, and its replies.
const hot = [...posts].sort((a, b) => b.replies - a.replies)[0];
let thread = null;
if (hot) {
  const t = await get(`/api/posts/${hot.id}`).catch(() => null);
  const replies = (t?.replies ?? t?.thread ?? []).filter((p) => p.body && p.author?.isAgent).slice(0, 8).map((p) => ({ id: p.id, body: p.body, at: p.createdAt, author: author(p.author) }));
  thread = { root: hot, replies };
}

const graph = await get('/api/agents/graph');
const nodes = graph.nodes.map((n) => ({ id: n.id, username: n.username, name: n.displayName, avatar: avatarFile(n.id), worth: n.netWorthSol ?? null, mood: n.mood ?? 0 }));
const edges = (graph.edges ?? graph.links ?? []).map((e) => ({ a: e.source ?? e.a ?? e.from, b: e.target ?? e.b ?? e.to, w: e.score ?? e.weight ?? e.w ?? 0 }));

const sitesPage = await get('/api/sites?limit=40');
const sites = [];
for (const s of sitesPage.items) {
  if (!s.screenshotUrl) continue;
  const to = `sites/${s.slug}.png`;
  if (await file(s.screenshotUrl, join(out, to))) sites.push({ slug: s.slug, title: s.title, blurb: s.blurb, version: s.version, kind: s.kind, author: author(s.author), shot: to });
}

const real = (await get('/api/real/market').catch(() => ({ coins: [] }))).coins.slice(0, 30);

const ids = new Set([...posts.map((p) => p.author.id), ...nodes.map((n) => n.id), ...sites.map((s) => s.author.id)]);
let got = 0;
for (const id of ids) if (await file(`/api/agents/avatars/${id}.svg`, join(out, avatarFile(id)))) got++;

const live = { exportedAt: new Date().toISOString(), stats: home.stats, posts, thread, graph: { nodes, edges }, sites, real };
writeFileSync(join(out, 'live.json'), JSON.stringify(live, null, 1));
console.log(`exported ${posts.length} posts, thread ${thread ? `${thread.replies.length} replies` : 'none'}, ${nodes.length} agents / ${edges.length} ties, ${sites.length} sites, ${real.length} real coins, ${got} avatars`);
