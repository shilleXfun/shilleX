import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { channels, communities, communityMembers, messages, posts, users, type UserRow } from '../db/schema.ts';
import { sendMessage } from '../services/messages.ts';
import { createPost } from '../services/posts.ts';
import { toUserSummary } from '../services/users.ts';
import { AppError } from '../lib/errors.ts';
import { InMemoryPresence } from '../services/presence.ts';
import { mulberry32, pick, chance } from './rng.ts';
import { CHAT_REPLIES, POST_LINES, REPLY_LINES, fill, pickFresh, chatPool } from './lines.ts';
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
    if (stopped || !(presence instanceof InMemoryPresence)) return;
    const want = new Set(personas.filter(() => chance(r, 0.35)).map((p) => p.id));
    for (const id of virtualOnline) if (!want.has(id)) { presence.setVirtual(id, false); virtualOnline.delete(id); }
    for (const id of want) if (!virtualOnline.has(id)) { presence.setVirtual(id, true); virtualOnline.add(id); }
  }

  async function chatInPublicChannel() {
    const pubs = await db.select().from(communities).where(eq(communities.visibility, 'public'));
    if (stopped || !pubs.length) return;
    const c = pick(r, pubs);
    const def = COMMUNITIES.find((d) => d.slug === c.slug);
    const chans = await db.select().from(channels).where(eq(channels.communityId, c.id));
    if (stopped || !chans.length) return;
    const ch = pick(r, chans);
    const members = await db.select({ u: users }).from(communityMembers).innerJoin(users, eq(users.id, communityMembers.userId))
      .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.status, 'active'), eq(users.isDemo, true), ne(users.username, 'demo'),
        inArray(communityMembers.role, ['member', 'mod', 'owner'])));
    if (stopped || !members.length) return;
    const recent = (await db.select({ id: messages.id, authorId: messages.authorId, body: messages.body }).from(messages)
      .where(and(eq(messages.channelId, ch.id), eq(messages.status, 'visible'))).orderBy(desc(messages.id)).limit(30)).reverse();
    if (stopped) return;
    // don't talk to yourself: skip whoever spoke last when someone else can
    const lastAuthor = recent.at(-1)?.authorId;
    const author = pick(r, members.length > 1 ? members.filter((m) => m.u.id !== lastAuthor) : members).u;
    const tok = tokenBySymbol(def?.tokenFocus.length ? pick(r, def.tokenFocus) : 'BLINK');
    const bodies = recent.map((m) => m.body);
    const answerable = recent.slice(-4).filter((m) => m.authorId !== author.id);
    const replyTo = answerable.length && chance(r, 0.3) ? pick(r, answerable) : null;
    const line = pickFresh(r, replyTo ? CHAT_REPLIES : chatPool(c.slug, ch.name), bodies);
    const others = members.filter((m) => m.u.id !== author.id);
    const body = fill(line, { mint: tok.mint, symbol: tok.symbol, user: pick(r, others.length ? others : members).u.username });
    bus.toRoom(`channel:${ch.id}`, 'typing', { scope: { type: 'channel', id: ch.id }, user: toUserSummary(author) });
    await sendMessage(deps, app.guards, { scope: { type: 'channel', id: ch.id }, author, body, replyToId: replyTo?.id });
  }

  async function postOrReply(personas: UserRow[]) {
    const author = pick(r, personas);
    const tok = tokenBySymbol(pick(r, POST_SYMBOLS));
    if (chance(r, 0.5)) {
      // only ever reply inside the labeled demo world: never to real users' posts (or @demo's)
      const recent = (await db.select({ p: posts }).from(posts).innerJoin(users, eq(users.id, posts.authorId))
        .where(and(eq(posts.kind, 'post'), isNull(posts.communityId), isNull(posts.deletedAt), eq(users.isDemo, true), ne(users.username, 'demo')))
        .orderBy(desc(posts.id)).limit(40)).map((x) => x.p);
      if (stopped) return;
      const parent = recent.length ? pick(r, recent) : null;
      if (parent && parent.authorId !== author.id) {
        const used = await recentPostBodies('reply');
        if (stopped) return;
        await createPost(deps, author, { body: pickFresh(r, REPLY_LINES, used), parentId: parent.id });
        return;
      }
    }
    const used = await recentPostBodies('post');
    if (stopped) return;
    const others = personas.filter((p) => p.id !== author.id);
    await createPost(deps, author, { body: fill(pickFresh(r, POST_LINES, used), { mint: tok.mint, symbol: tok.symbol, user: pick(r, others.length ? others : personas).username }) });
  }

  /** The newest public post or reply bodies, oldest first, so new lines can avoid what the feed just showed. */
  const recentPostBodies = async (kind: 'post' | 'reply') =>
    (await db.select({ body: posts.body }).from(posts).where(and(eq(posts.kind, kind), isNull(posts.communityId), isNull(posts.deletedAt)))
      .orderBy(desc(posts.id)).limit(kind === 'post' ? 50 : 30)).map((x) => x.body).reverse();

  const loadPersonas = () => db.select().from(users).where(and(eq(users.isDemo, true), ne(users.username, 'demo')));

  /** One simulated action. A no-op once stop() has been called (checked again after every await). */
  async function tick() {
    if (stopped) return;
    try {
      const personas = await loadPersonas();
      if (stopped || !personas.length) return;
      if (chance(r, 0.15)) rotatePresence(personas);
      const roll = r();
      if (roll < 0.7) await chatInPublicChannel();
      else if (roll < 0.9) await postOrReply(personas);
      else rotatePresence(personas);
    } catch (e) {
      // Rate limits, slow mode, duplicates, blocks… (AppError) are expected; the simulator just skips this action.
      if (e instanceof AppError) app.log?.debug?.({ err: e }, 'simulator action skipped');
      else app.log?.warn?.({ err: e }, 'simulator action failed');
    }
  }

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => { void tick().then(schedule); }, minMs + r() * (maxMs - minMs));
    timer.unref?.();
  };
  schedule();
  // Put a first crowd online right away; otherwise every room reads "0 online" until a tick happens to rotate presence.
  const ready = loadPersonas().then((p) => rotatePresence(p), (e) => { app.log?.warn?.({ err: e }, 'simulator warmup failed'); });
  return {
    ready,
    tick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (presence instanceof InMemoryPresence) for (const id of virtualOnline) presence.setVirtual(id, false);
      virtualOnline.clear();
    },
  };
}
