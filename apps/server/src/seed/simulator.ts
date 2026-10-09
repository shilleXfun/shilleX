import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { channels, communities, communityMembers, posts, users, type UserRow } from '../db/schema.ts';
import { sendMessage } from '../services/messages.ts';
import { createPost } from '../services/posts.ts';
import { toUserSummary } from '../services/users.ts';
import { InMemoryPresence } from '../services/presence.ts';
import { mulberry32, pick, chance } from './rng.ts';
import { CHAT_LINES, POST_LINES, REPLY_LINES, fill } from './lines.ts';
import { COMMUNITIES, tokenBySymbol } from './world.ts';

/** Public tokens the simulator may post about (never the private-only demo tokens). */
const POST_SYMBOLS = ['BLINK', 'GRUB', 'ZAPPY', 'MOTH', 'PUPPO', 'FORGE', 'OWLY', 'KITE', 'FIZZ'];

/**
 * Labeled demo activity: demo personas (never @demo) chat in public channels, post and reply through the real
 * services, so every rule (rate limits, slow mode, duplicates, privacy of mentions) applies. Rejections are skipped.
 */
export function startSimulator(app: FastifyInstance, opts: { minMs?: number; maxMs?: number; seed?: number } = {}) {
  const deps = app.deps;
  const { db, bus, presence } = deps;
  const r = mulberry32(opts.seed ?? Date.now() % 2 ** 31);
  const minMs = opts.minMs ?? 4000, maxMs = opts.maxMs ?? 12000;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const virtualOnline = new Set<string>();

  function rotatePresence(personas: UserRow[]) {
    if (!(presence instanceof InMemoryPresence)) return;
    const want = new Set(personas.filter(() => chance(r, 0.35)).map((p) => p.id));
    for (const id of virtualOnline) if (!want.has(id)) { presence.setVirtual(id, false); virtualOnline.delete(id); }
    for (const id of want) if (!virtualOnline.has(id)) { presence.setVirtual(id, true); virtualOnline.add(id); }
  }

  async function chatInPublicChannel() {
    const pubs = await db.select().from(communities).where(eq(communities.visibility, 'public'));
    if (!pubs.length) return;
    const c = pick(r, pubs);
    const def = COMMUNITIES.find((d) => d.slug === c.slug);
    const chans = await db.select().from(channels).where(eq(channels.communityId, c.id));
    if (!chans.length) return;
    const ch = pick(r, chans);
    const members = await db.select({ u: users }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
      .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.status, 'active'), eq(users.isDemo, true), ne(users.username, 'demo'),
        inArray(communityMembers.role, ['member', 'mod', 'owner'])));
    if (!members.length) return;
    const author = pick(r, members).u;
    const tok = tokenBySymbol(def?.tokenFocus.length ? pick(r, def.tokenFocus) : 'BLINK');
    const body = fill(pick(r, CHAT_LINES), { mint: tok.mint, symbol: tok.symbol, user: pick(r, members).u.username });
    bus.toRoom(`channel:${ch.id}`, 'typing', { scope: { type: 'channel', id: ch.id }, user: toUserSummary(author) });
    await sendMessage(deps, app.guards, { scope: { type: 'channel', id: ch.id }, author, body });
  }

  async function postOrReply(personas: UserRow[]) {
    const author = pick(r, personas);
    const tok = tokenBySymbol(pick(r, POST_SYMBOLS));
    if (chance(r, 0.5)) {
      const recent = await db.select().from(posts)
        .where(and(eq(posts.kind, 'post'), isNull(posts.communityId), isNull(posts.deletedAt))).orderBy(desc(posts.id)).limit(40);
      const parent = recent.length ? pick(r, recent) : null;
      if (parent && parent.authorId !== author.id) {
        await createPost(deps, author, { body: pick(r, REPLY_LINES), parentId: parent.id });
        return;
      }
    }
    await createPost(deps, author, { body: fill(pick(r, POST_LINES), { mint: tok.mint, symbol: tok.symbol, user: pick(r, personas).username }) });
  }

  async function tick() {
    try {
      const personas = await db.select().from(users).where(and(eq(users.isDemo, true), ne(users.username, 'demo')));
      if (!personas.length) return;
      if (chance(r, 0.15)) rotatePresence(personas);
      const roll = r();
      if (roll < 0.7) await chatInPublicChannel();
      else if (roll < 0.9) await postOrReply(personas);
      else rotatePresence(personas);
    } catch (e) {
      // Rate limits, slow mode, duplicates, blocks… are expected; the simulator just skips this action.
      app.log?.debug?.({ err: e }, 'simulator action skipped');
    }
  }

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => { void tick().then(schedule); }, minMs + r() * (maxMs - minMs));
    timer.unref?.();
  };
  schedule();
  return {
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (presence instanceof InMemoryPresence) for (const id of virtualOnline) presence.setVirtual(id, false);
      virtualOnline.clear();
    },
  };
}
