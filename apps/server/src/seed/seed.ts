import { sql, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { CALL_STATUS_LABELS, REACTIONS, uniqueMints, type CallStatus } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import * as s from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { recordMentions } from '../services/mentions.ts';
import { computeMentionVisibility } from '../services/visibility.ts';
import { markRead } from '../services/unread.ts';
import { mulberry32, pick, int, chance, shuffle } from './rng.ts';
import { PERSONAS, type Style } from './personas.ts';
import { COMMUNITIES, DEMO_TOKENS, PRIVATE_ONLY_SYMBOLS, tokenBySymbol, type CommunityDef } from './world.ts';
import { POST_LINES, CHAT_REPLIES, REPLY_LINES, DM_LINES, CALL_NOTES, fill, lineDrawer, chatPool } from './lines.ts';

export interface SeedSummary { users: number; communities: number; posts: number; messages: number; tokens: number }

/** Every table in the schema, so a re-seed always starts from a clean slate; admin_audit is append-only and never truncated. */
const TABLES = (Object.values(s) as unknown[]).filter((v): v is PgTable => is(v, PgTable)).map((t) => getTableName(t)).filter((n) => n !== 'admin_audit');

export async function isDatabaseEmpty(db: Db) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  return (r?.n ?? 0) === 0;
}

type Vis = 'public' | 'private' | 'invite';
type UserInsert = typeof s.users.$inferInsert & { id: string; createdAt: Date };
type Attachment = s.MessageRow['attachments'][number];
interface Member { userId: string; role: 'owner' | 'mod' | 'member'; status: 'active' | 'pending'; joinedAt: number }
interface ChannelBuilt { id: string; name: string; topic: string; position: number; slowModeSeconds: number; drafts: MsgDraft[] }
interface CommunityBuilt { def: CommunityDef; id: string; createdAt: number; ownerId: string; members: Member[]; channels: ChannelBuilt[] }
interface MsgDraft {
  id: string; channelId: string | null; conversationId: string | null; communityId: string | null; isPublic: boolean;
  authorId: string; body: string; replyTo: MsgDraft | null; attachments: Attachment[]; t: number; reacts: { userId: string; emoji: string }[];
}
interface PostDraft {
  id: string; authorId: string; kind: s.PostRow['kind']; body: string; parent: PostDraft | null; quoteOf: PostDraft | null; repostOf: PostDraft | null;
  communityId: string | null; communityVisibility: Vis | null; art: boolean; t: number; depth: number; reacts: { userId: string; emoji: string }[];
}

const H = 3600_000, M = 60_000, D = 24 * H;
const OWNERS: Record<string, string> = {
  trenches: 'solsailor', 'due-diligence': 'rugradar', 'mascot-club': 'pixelpup', 'builders-den': 'quietbuilder',
  'night-owls': 'nightshift_nik', 'inner-circle': 'alpha_jane', 'art-collective': 'sticker_sue', 'beta-testers': 'quietbuilder',
};
const SHAPE: Record<string, { styles: Style[]; min: number; max: number }> = {
  trenches: { styles: ['degen', 'newbie', 'memer'], min: 24, max: 30 },
  'due-diligence': { styles: ['analyst', 'newbie'], min: 14, max: 20 },
  'mascot-club': { styles: ['memer'], min: 12, max: 18 },
  'builders-den': { styles: ['builder'], min: 10, max: 14 },
  'night-owls': { styles: ['degen'], min: 10, max: 14 },
  'inner-circle': { styles: ['analyst'], min: 8, max: 10 },
  'art-collective': { styles: ['memer'], min: 8, max: 9 },
  'beta-testers': { styles: ['builder'], min: 8, max: 10 },
};
const hasToken = (l: string) => l.includes('{TOKEN}') || l.includes('{SYM}');
const CALL_SEQUENCES: CallStatus[][] = [
  ['watching'], ['watching', 'bought'], ['watching', 'bought', 'taking_profit'], ['bought', 'out'],
  ['watching', 'thesis_changed'], ['bought', 'taking_profit', 'out'], ['watching', 'out'],
];

async function insertChunks<T extends PgTable>(db: Db, table: T, rows: T['$inferInsert'][]) {
  for (let i = 0; i < rows.length; i += 200) await db.insert(table).values(rows.slice(i, i + 200) as never);
}

export async function seed(db: Db, opts: { now: Date; seed?: number }): Promise<SeedSummary> {
  const r = mulberry32(opts.seed ?? 20261009);
  const now = opts.now.getTime();
  const date = (t: number) => new Date(t);
  const between = (a: number, b: number) => a + r() * Math.max(0, b - a);
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`));

  // 1. users
  const demo: UserInsert = { id: newId(), username: 'demo', displayName: 'You (demo)', bio: 'Exploring the Shillex demo world.', createdAt: date(now - 30 * D), isDemo: true };
  const personas: (UserInsert & { style: Style })[] = PERSONAS.map((p) => ({
    id: newId(), username: p.username, displayName: p.displayName, bio: p.bio, style: p.style,
    createdAt: date(now - int(r, 20, 400) * D - Math.floor(r() * D)), isDemo: true,
  }));
  const P = new Map(personas.map((p) => [p.username, p]));
  const persona = (u: string) => P.get(u)!;
  const userById = new Map([demo, ...personas].map((u) => [u.id, u]));
  const nameOf = (id: string) => userById.get(id)!.username;
  const bornAt = (id: string) => userById.get(id)!.createdAt.getTime();
  await insertChunks(db, s.users, [demo, ...personas].map(({ style: _s, ...u }: UserInsert & { style?: Style }) => u));

  // 2. follows
  const followRows: (typeof s.follows.$inferInsert)[] = [];
  const follow = (a: string, b: string) => followRows.push({ followerId: a, followeeId: b, createdAt: date(between(Math.max(bornAt(a), bornAt(b)), now - D)) });
  const demoFollows = shuffle(r, personas).slice(0, 14);
  for (const p of demoFollows) follow(demo.id, p.id);
  for (const p of personas) {
    for (const q of shuffle(r, personas.filter((x) => x.id !== p.id)).slice(0, int(r, 5, 15))) follow(p.id, q.id);
  }
  const demoFollowers = shuffle(r, personas).slice(0, 10);
  for (const p of demoFollowers) follow(p.id, demo.id);
  await insertChunks(db, s.follows, followRows);

  // 3. tokens (fictional; every row is source 'demo')
  await insertChunks(db, s.tokens, DEMO_TOKENS.map((t) => ({
    mint: t.mint, source: 'demo' as const, status: t.status, name: t.name, symbol: t.symbol, liquidityUsd: t.liquidityUsd, marketCapUsd: t.marketCapUsd,
    pairCreatedAt: t.status === 'resolved' ? date(now - t.ageHours * H) : null, promoted: !!t.promoted, fetchedAt: opts.now,
  })));
  const publicSymbols = DEMO_TOKENS.map((t) => t.symbol).filter((x) => !PRIVATE_ONLY_SYMBOLS.includes(x));
  const publicFocus = [...new Set(COMMUNITIES.filter((c) => c.visibility === 'public').flatMap((c) => c.tokenFocus))];
  const postSymbols = [...publicSymbols, ...publicFocus, ...publicFocus]; // weighted toward community favorites

  // 4. communities, members, channels
  const built: CommunityBuilt[] = [];
  let innerCirclePending: string | null = null;
  for (const def of COMMUNITIES) {
    const owner = persona(OWNERS[def.slug]!);
    const createdAt = Math.min(owner.createdAt.getTime() + int(r, 1, 10) * D, now - 15 * D);
    const shape = SHAPE[def.slug]!;
    const rest = personas.filter((p) => p.id !== owner.id);
    const preferred = shuffle(r, rest.filter((p) => shape.styles.includes(p.style)));
    const others = shuffle(r, rest.filter((p) => !shape.styles.includes(p.style)));
    const chosen = [owner, ...preferred, ...others].slice(0, int(r, shape.min, shape.max));
    const modIds = new Set(shuffle(r, chosen.slice(1)).slice(0, int(r, 1, 2)).map((p) => p.id));
    const members: Member[] = chosen.map((p) => ({
      userId: p.id, role: p.id === owner.id ? 'owner' : modIds.has(p.id) ? 'mod' : 'member', status: 'active',
      joinedAt: p.id === owner.id ? createdAt : between(Math.max(createdAt, p.createdAt.getTime()), now - 2 * D),
    }));
    const demoJoin = between(Math.max(createdAt, bornAt(demo.id)), now - 3 * D);
    if (def.visibility === 'public' && def.slug !== 'night-owls') {
      members.push({ userId: demo.id, role: def.slug === 'mascot-club' ? 'mod' : 'member', status: 'active', joinedAt: demoJoin });
    } else if (def.slug === 'inner-circle') {
      members.push({ userId: demo.id, role: 'mod', status: 'active', joinedAt: demoJoin });
      const outsider = pick(r, personas.filter((p) => !chosen.includes(p)));
      innerCirclePending = outsider.id;
      members.push({ userId: outsider.id, role: 'member', status: 'pending', joinedAt: now - 50 * M });
    } else if (def.slug === 'art-collective') {
      members.push({ userId: demo.id, role: 'member', status: 'pending', joinedAt: now - 20 * H });
    } else if (def.slug === 'beta-testers') {
      members.push({ userId: demo.id, role: 'member', status: 'active', joinedAt: demoJoin });
    }
    const channels = def.channels.map((c, i) => ({ id: newId(), name: c.name, topic: c.topic, position: i, slowModeSeconds: c.slowModeSeconds ?? 0, drafts: [] }));
    built.push({ def, id: newId(), createdAt, ownerId: owner.id, members, channels });
  }
  await insertChunks(db, s.communities, built.map((c) => ({
    id: c.id, slug: c.def.slug, name: c.def.name, description: c.def.description, visibility: c.def.visibility, ownerId: c.ownerId,
    rules: c.def.rules, createdAt: date(c.createdAt), isDemo: true,
  })));
  await insertChunks(db, s.communityMembers, built.flatMap((c) => c.members.map((m) => ({
    communityId: c.id, userId: m.userId, role: m.role, status: m.status, joinedAt: date(m.joinedAt),
  }))));
  await insertChunks(db, s.channels, built.flatMap((c) => c.channels.map((ch) => ({
    id: ch.id, communityId: c.id, name: ch.name, topic: ch.topic, position: ch.position, slowModeSeconds: ch.slowModeSeconds,
  }))));
  const beta = built.find((c) => c.def.slug === 'beta-testers')!;
  const inviteCode = Array.from({ length: 12 }, () => pick(r, [...'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'])).join('');
  await db.insert(s.invites).values({ code: inviteCode, communityId: beta.id, createdBy: beta.ownerId, maxUses: 25, uses: beta.members.length - 1, createdAt: date(beta.createdAt + D) });
  const bySlug = (slug: string) => built.find((c) => c.def.slug === slug)!;
  const activeIds = (c: CommunityBuilt) => c.members.filter((m) => m.status === 'active').map((m) => m.userId);
  const activePersonaIds = (c: CommunityBuilt) => activeIds(c).filter((id) => id !== demo.id);

  // 5. channel messages (40–120 per channel over the last 48h, denser in the last 2h)
  const allMsgs: MsgDraft[] = [];
  /** Per-channel line drawers: topic lines when the room has them, general chatter otherwise, never a line used in the last few messages. */
  const chatDrawers = (slug: string, channelName: string) => {
    const pool = chatPool(slug, channelName);
    const tok = lineDrawer(r, pool.filter(hasToken), 15), plain = lineDrawer(r, pool.filter((l) => !hasToken(l)), 15);
    return { line: (withToken: boolean) => (withToken ? tok() : plain()), reply: lineDrawer(r, CHAT_REPLIES, 15) };
  };
  const reactionsFor = (pool: string[], authorId: string) => {
    const out: { userId: string; emoji: string }[] = [];
    for (let i = int(r, 1, 3); i > 0; i--) {
      const userId = pick(r, pool), emoji = pick(r, REACTIONS);
      if (userId !== authorId && !out.some((x) => x.userId === userId && x.emoji === emoji)) out.push({ userId, emoji });
    }
    return out;
  };
  for (const c of built) {
    const vis = c.def.visibility;
    const isPublic = computeMentionVisibility({ kind: 'channel_message', communityVisibility: vis });
    const ids = activeIds(c), personaIds = activePersonaIds(c);
    for (const ch of c.channels) {
      const n = int(r, 40, 120);
      const times = Array.from({ length: n }, () => (chance(r, 0.4) ? now - r() * 2 * H : now - 2 * H - r() * 46 * H)).sort((a, b) => a - b);
      const lines = chatDrawers(c.def.slug, ch.name);
      for (const t of times) {
        let authorId = pick(r, ids);
        if (authorId === demo.id && (t > now - 3 * H || chance(r, 0.6))) authorId = pick(r, personaIds);
        const sym = c.def.tokenFocus.length && chance(r, 0.35) ? pick(r, c.def.tokenFocus) : null;
        const tok = tokenBySymbol(sym ?? pick(r, c.def.tokenFocus));
        const recent = ch.drafts.slice(-8).filter((m) => m.authorId !== authorId);
        const replyTo = recent.length && chance(r, 0.15) ? pick(r, recent) : null;
        const line = replyTo ? lines.reply() : lines.line(sym !== null);
        const others = ids.filter((id) => id !== authorId);
        const body = fill(line, { mint: tok.mint, symbol: tok.symbol, user: nameOf(pick(r, others)) });
        const d: MsgDraft = { id: '', channelId: ch.id, conversationId: null, communityId: c.id, isPublic, authorId, body, replyTo, attachments: [], t, reacts: [] };
        if (chance(r, 0.25)) d.reacts = reactionsFor(ids, authorId);
        ch.drafts.push(d);
        allMsgs.push(d);
      }
    }
  }
  // A welcome that mentions @demo (target of a mention notification).
  const trenches = bySlug('trenches');
  const trenchesGeneral = trenches.channels[0]!;
  const welcome: MsgDraft = { id: '', channelId: trenchesGeneral.id, conversationId: null, communityId: trenches.id, isPublic: true, authorId: trenches.ownerId,
    body: 'welcome @demo — paste CAs, not tickers, and you’ll fit right in 🫡', replyTo: null, attachments: [], t: now - 40 * M, reacts: [] };
  trenchesGeneral.drafts.push(welcome); trenchesGeneral.drafts.sort((a, b) => a.t - b.t); allMsgs.push(welcome);

  // 10. conversations: 5 DMs with demo + 2 groups (built here so every message gets time-ordered ids together)
  interface ConvBuilt { id: string; kind: 'dm' | 'group'; name: string | null; createdBy: string; createdAt: number; memberIds: string[]; drafts: MsgDraft[]; unread: number }
  const convs: ConvBuilt[] = [];
  const DM_TOKEN = DM_LINES.filter(hasToken), DM_PLAIN = DM_LINES.filter((l) => !hasToken(l));
  const convSpec: { kind: 'dm' | 'group'; name: string | null; with: string[]; min: number; max: number; unread: boolean; tokens: string[] }[] = [
    { kind: 'dm', name: null, with: ['alpha_jane'], min: 6, max: 20, unread: true, tokens: ['VAULTY', 'GRUB', 'MOTH'] },
    { kind: 'dm', name: null, with: ['pixelpup'], min: 6, max: 20, unread: true, tokens: ['PUPPO', 'MOTH'] },
    { kind: 'dm', name: null, with: ['quietbuilder'], min: 6, max: 20, unread: false, tokens: ['FORGE', 'SECRT'] },
    { kind: 'dm', name: null, with: ['fresh_fern'], min: 6, max: 20, unread: false, tokens: ['BLINK', 'GRUB'] },
    { kind: 'dm', name: null, with: ['dex_dan'], min: 6, max: 20, unread: false, tokens: ['GRUB', 'ZAPPY'] },
    { kind: 'group', name: 'Desk', with: ['dex_dan', 'rugradar', 'lp_lena'], min: 15, max: 40, unread: true, tokens: ['GRUB', 'MOTH', 'VAULTY'] },
    { kind: 'group', name: 'Mascot crew', with: ['pixelpup', 'moonmeadow', 'lorekeeper', 'sticker_sue', 'meme_marlo'], min: 15, max: 40, unread: false, tokens: ['PUPPO', 'MOTH'] },
  ];
  for (const spec of convSpec) {
    const others = spec.with.map((u) => persona(u).id);
    const memberIds = [demo.id, ...others];
    const createdAt = now - int(r, 3, 9) * D - Math.floor(r() * D);
    const end = spec.unread ? now - int(r, 5, 60) * M : now - int(r, 3, 30) * H;
    const n = int(r, spec.min, spec.max);
    const unread = spec.unread ? int(r, 1, 4) : 0;
    const times = Array.from({ length: n }, () => between(createdAt + H, end)).sort((a, b) => a - b);
    times[times.length - 1] = end;
    const conv: ConvBuilt = { id: newId(), kind: spec.kind, name: spec.name, createdBy: pick(r, memberIds), createdAt, memberIds, drafts: [], unread };
    let authorId = pick(r, memberIds);
    const chat = chatDrawers('', ''), dmTok = lineDrawer(r, DM_TOKEN, 8), dmPlain = lineDrawer(r, DM_PLAIN, 8);
    times.forEach((t, i) => {
      if (i > 0 && chance(r, 0.6)) authorId = pick(r, memberIds.filter((id) => id !== authorId));
      if (authorId === demo.id && (t > now - 2 * H || i >= n - unread)) authorId = pick(r, others);
      const tok = tokenBySymbol(pick(r, spec.tokens));
      const line = spec.kind === 'group' && chance(r, 0.5) ? chat.line(chance(r, 0.35)) : (chance(r, 0.35) ? dmTok() : dmPlain());
      const body = fill(line, { mint: tok.mint, symbol: tok.symbol, user: nameOf(pick(r, memberIds.filter((id) => id !== authorId))) });
      const recent = conv.drafts.slice(-5);
      const replyTo = spec.kind === 'group' && recent.length && chance(r, 0.15) ? pick(r, recent) : null;
      const d: MsgDraft = { id: '', channelId: null, conversationId: conv.id, communityId: null, isPublic: computeMentionVisibility({ kind: 'conversation_message' }),
        authorId, body, replyTo, attachments: [], t, reacts: [] };
      if (chance(r, 0.2)) d.reacts = reactionsFor(memberIds, authorId);
      conv.drafts.push(d);
    });
    if (spec.with[0] === 'quietbuilder') {
      // a shared token card for the private-only token (never public)
      const card = conv.drafts[Math.floor(conv.drafts.length / 2)]!;
      card.authorId = persona('quietbuilder').id;
      card.body = 'early look at what we’re testing in Beta Testers. keep it between us for now 🤐';
      card.attachments = [{ type: 'token', mint: tokenBySymbol('SECRT').mint }];
    }
    allMsgs.push(...conv.drafts);
    convs.push(conv);
  }

  // assign message ids in time order (pagination and unread rely on id order matching createdAt order)
  allMsgs.sort((a, b) => a.t - b.t);
  for (const m of allMsgs) m.id = newId();
  await insertChunks(db, s.conversations, convs.map((c) => ({
    id: c.id, kind: c.kind, name: c.name, createdBy: c.createdBy, createdAt: date(c.createdAt),
    dmKey: c.kind === 'dm' ? [...c.memberIds].sort().join(':') : null,
  })));
  await insertChunks(db, s.conversationMembers, convs.flatMap((c) => c.memberIds.map((u) => ({ conversationId: c.id, userId: u, joinedAt: date(c.createdAt) }))));
  await insertChunks(db, s.messages, allMsgs.map((m) => ({
    id: m.id, channelId: m.channelId, conversationId: m.conversationId, authorId: m.authorId, body: m.body, replyToId: m.replyTo?.id ?? null,
    attachments: m.attachments, status: 'visible' as const, createdAt: date(m.t), isDemo: true,
  })));
  await insertChunks(db, s.reactions, allMsgs.flatMap((m) => m.reacts.map((x) => ({
    targetType: 'message' as const, targetId: m.id, userId: x.userId, emoji: x.emoji, createdAt: date(Math.min(m.t + int(r, 1, 30) * M, now)),
  }))));
  for (const m of allMsgs) {
    await recordMentions(db, {
      sourceType: 'message', sourceId: m.id, text: m.body, authorId: m.authorId, communityId: m.communityId, channelId: m.channelId,
      isPublic: m.isPublic, createdAt: date(m.t), extraMints: m.attachments.flatMap((a) => (a.type === 'token' ? [a.mint] : [])),
    });
  }

  // 6. read markers for demo: each joined channel is read up to 3–15 messages before the latest
  for (const c of built) {
    if (!c.members.some((m) => m.userId === demo.id && m.status === 'active')) continue;
    for (const ch of c.channels) {
      // never before demo's own last message: sending a message marks the scope read
      const lastOwn = ch.drafts.map((m) => m.authorId).lastIndexOf(demo.id);
      const idx = Math.max(0, lastOwn, ch.drafts.length - 1 - int(r, 3, 15));
      await markRead(db, demo.id, 'channel', ch.id, ch.drafts[idx]!.id);
    }
  }
  //    …and conversations: three keep 1–4 unread, the rest are fully read
  for (const c of convs) await markRead(db, demo.id, 'conversation', c.id, c.drafts[c.drafts.length - 1 - c.unread]!.id);

  // 7. posts
  const allPosts: PostDraft[] = [];
  const postTokenLine = lineDrawer(r, POST_LINES.filter(hasToken), 30), postPlainLine = lineDrawer(r, POST_LINES.filter((l) => !hasToken(l)), 30);
  const replyLine = lineDrawer(r, REPLY_LINES, 30);
  const newPost = (p: Partial<PostDraft> & Pick<PostDraft, 'authorId' | 'kind' | 'body' | 't'>): PostDraft => {
    const d: PostDraft = { id: '', parent: null, quoteOf: null, repostOf: null, communityId: null, communityVisibility: null, art: false, depth: 0, reacts: [], ...p };
    allPosts.push(d);
    return d;
  };
  const postBody = (authorId: string, symbols: readonly string[], pTok: number, mentionPool: string[]) => {
    const withToken = chance(r, pTok);
    const tok = tokenBySymbol(pick(r, symbols));
    const line = withToken ? postTokenLine() : postPlainLine();
    let body = fill(line, { mint: tok.mint, symbol: tok.symbol, user: nameOf(pick(r, mentionPool.filter((id) => id !== authorId))) });
    if (withToken && !line.includes('{TOKEN}')) body += `\n\nCA: ${tok.mint}`;
    return body;
  };
  const personaIds = personas.map((p) => p.id);
  const replyTime = (after: number) => Math.min(after + int(r, 2, 360) * M, now - M);
  const topLevel: PostDraft[] = [];
  // Bodies are drawn in time order (newest first) so a line never reappears within the next few dozen posts of the feed.
  const postTimes = Array.from({ length: 180 }, () => now - 72 * H * r() ** 1.3).sort((a, b) => b - a);
  // one post per public demo token, spread through the timeline, so discovery (incl. both promoted tokens) is never empty
  const coverage = new Map(shuffle(r, postTimes.map((_, i) => i)).slice(0, publicSymbols.length).map((i, k) => [i, publicSymbols[k]!]));
  postTimes.forEach((t, i) => {
    const authorId = pick(r, personaIds);
    const sym = coverage.get(i);
    const body = sym ? postBody(authorId, [sym], 1, personaIds) : postBody(authorId, postSymbols, 0.55, personaIds);
    topLevel.push(newPost({ authorId, kind: 'post', body, t }));
  });
  const memers = new Set(personas.filter((p) => p.style === 'memer').map((p) => p.id));
  for (const p of shuffle(r, topLevel.filter((x) => memers.has(x.authorId))).slice(0, 6)) p.art = true;
  const replyable: PostDraft[] = [...topLevel];
  for (let i = 0; i < 70; i++) {
    const parent = pick(r, replyable);
    const authorId = pick(r, personaIds.filter((id) => id !== parent.authorId));
    const reply = newPost({ authorId, kind: 'reply', body: replyLine(), parent, t: replyTime(parent.t), depth: parent.depth + 1 });
    if (reply.depth < 3) replyable.push(reply);
  }
  for (let i = 0; i < 20; i++) {
    const quoteOf = pick(r, topLevel);
    const authorId = pick(r, personaIds.filter((id) => id !== quoteOf.authorId));
    const body = chance(r, 0.5) ? replyLine() : postBody(authorId, postSymbols, 0.4, personaIds);
    newPost({ authorId, kind: 'quote', body, quoteOf, t: replyTime(quoteOf.t) });
  }
  const reposters = new Map<PostDraft, Set<string>>();
  for (let i = 0; i < 25; i++) {
    const repostOf = pick(r, topLevel);
    const authorId = pick(r, personaIds.filter((id) => id !== repostOf.authorId));
    const who = reposters.get(repostOf) ?? new Set<string>();
    if (who.has(authorId)) continue; // one repost per user per post
    reposters.set(repostOf, who.add(authorId));
    newPost({ authorId, kind: 'repost', body: '', repostOf, t: replyTime(repostOf.t) });
  }
  //    community thread posts (private ones talk about their private-only tokens and are recorded non-public)
  const communityThreads = new Map<string, PostDraft[]>();
  for (const c of built) {
    const ids = activePersonaIds(c);
    const threads: PostDraft[] = [];
    for (let i = int(r, 4, 8); i > 0; i--) {
      const authorId = pick(r, ids);
      const thread = newPost({ authorId, kind: 'post', body: postBody(authorId, c.def.tokenFocus, 0.7, ids), communityId: c.id,
        communityVisibility: c.def.visibility, t: now - r() * 6 * D });
      threads.push(thread);
      for (let j = int(r, 0, 3); j > 0; j--) {
        newPost({ authorId: pick(r, ids.filter((id) => id !== authorId)), kind: 'reply', body: replyLine(), parent: thread,
          communityId: c.id, communityVisibility: c.def.visibility, t: replyTime(thread.t), depth: 1 });
      }
    }
    communityThreads.set(c.def.slug, threads);
  }
  // 9. demo's own content, plus persona interactions with it
  const grub = tokenBySymbol('GRUB');
  const demoTokenPost = newPost({ authorId: demo.id, kind: 'post', t: now - 30 * H,
    body: `first day poking around. pasting the CA instead of the ticker like the rules say: ${grub.mint} — watching only, the holder spread looks decent.` });
  const demoPosts = [
    demoTokenPost,
    newPost({ authorId: demo.id, kind: 'post', t: now - 20 * H, body: 'which community here has the best memes? asking for research purposes 😂' }),
    newPost({ authorId: demo.id, kind: 'post', t: now - 6 * H, body: 'learning to read holder maps. Due Diligence Desk has been super helpful, thanks all.' }),
  ];
  const demoReplies = demoPosts.map((p) => newPost({ authorId: pick(r, personaIds), kind: 'reply', body: replyLine(), parent: p, t: replyTime(p.t), depth: 1 }));
  const demoQuote = newPost({ authorId: persona('moonmeadow').id, kind: 'quote', body: 'Mascot Club, obviously. come say hi', quoteOf: demoPosts[1]!, t: demoPosts[1]!.t + 25 * M });
  const demoMention = newPost({ authorId: persona('fresh_fern').id, kind: 'post', t: now - 3 * H, body: 'shoutout to @demo for asking the same beginner questions as me. we learn together 🫡' });
  for (const p of demoPosts) p.reacts = reactionsFor(personaIds, demo.id);
  //    reactions on posts
  for (const p of allPosts) {
    if (p.kind === 'repost' || p.reacts.length || !chance(r, 0.6)) continue;
    const pool = p.communityId ? activeIds(built.find((c) => c.id === p.communityId)!) : personaIds;
    for (let i = int(r, 1, 3); i > 0; i--) p.reacts.push(...reactionsFor(pool, p.authorId).filter((x) => !p.reacts.some((y) => y.userId === x.userId && y.emoji === x.emoji)));
  }
  //    assign post ids in time order (feeds paginate by id)
  allPosts.sort((a, b) => a.t - b.t);
  for (const p of allPosts) p.id = newId();
  const rootOf = (p: PostDraft): PostDraft => (p.parent ? rootOf(p.parent) : p);
  //    a thread's root carries its newest reply or repost and who wrote it, as services/activity.ts keeps it for new posts
  const lastIn = new Map<PostDraft, PostDraft>();
  for (const p of allPosts) {
    const root = p.parent ? rootOf(p.parent) : p.repostOf ? rootOf(p.repostOf) : null;
    if (root && p.t > (lastIn.get(root) ?? root).t) lastIn.set(root, p);
  }
  await insertChunks(db, s.posts, allPosts.map((p) => ({
    id: p.id, authorId: p.authorId, kind: p.kind, body: p.body, parentId: p.parent?.id ?? null, rootId: p.parent ? rootOf(p.parent).id : null,
    quoteOfId: p.quoteOf?.id ?? null, repostOfId: p.repostOf?.id ?? null, communityId: p.communityId, visibility: p.communityId ? 'community' as const : 'public' as const,
    media: p.art ? [{ url: `/media/art/${p.id}.svg`, width: 800, height: 450, alt: 'Generated illustration' }] : [], createdAt: date(p.t), isDemo: true,
    lastActivityAt: date((lastIn.get(p) ?? p).t), lastActivityBy: (lastIn.get(p) ?? p).authorId,
  })));
  await insertChunks(db, s.reactions, allPosts.flatMap((p) => p.reacts.map((x) => ({
    targetType: 'post' as const, targetId: p.id, userId: x.userId, emoji: x.emoji, createdAt: date(Math.min(p.t + int(r, 1, 120) * M, now)),
  }))));
  for (const p of allPosts) {
    if (p.kind === 'repost') continue;
    await recordMentions(db, {
      sourceType: 'post', sourceId: p.id, text: p.body, authorId: p.authorId, communityId: p.communityId, channelId: null,
      isPublic: computeMentionVisibility({ kind: 'post', communityVisibility: p.communityVisibility }), createdAt: date(p.t),
    });
  }
  const subRows: (typeof s.subscriptions.$inferInsert)[] = allPosts.filter((p) => p.kind !== 'repost')
    .map((p) => ({ userId: p.authorId, targetType: 'post' as const, targetId: p.id, createdAt: date(p.t) }));
  const bookmarked = shuffle(r, topLevel.filter((p) => p.authorId !== demo.id)).slice(0, 5);
  await insertChunks(db, s.bookmarks, bookmarked.map((p) => ({ userId: demo.id, postId: p.id, createdAt: date(Math.min(p.t + 2 * H, now)) })));

  // 8. call updates: 14 persona token posts get 1–3 ordered self-reported updates; demo subscribes to 4 of them
  const tokenPosts = topLevel.filter((p) => uniqueMints(p.body).length > 0);
  const callPosts = shuffle(r, tokenPosts).slice(0, 14);
  const callRows: (typeof s.callUpdates.$inferInsert & { t: number })[] = [];
  for (const p of callPosts) {
    const seq = pick(r, CALL_SEQUENCES);
    seq.forEach((status, i) => {
      const t = p.t + ((now - p.t) * (i + r() * 0.8 + 0.1)) / seq.length;
      callRows.push({ id: '', postId: p.id, authorId: p.authorId, status, note: chance(r, 0.5) ? pick(r, CALL_NOTES) : null, selfReported: true, createdAt: date(t), t });
    });
  }
  callRows.push({ id: '', postId: demoTokenPost.id, authorId: demo.id, status: 'watching', note: 'just learning, no position', selfReported: true, createdAt: date(demoTokenPost.t + 5 * M), t: demoTokenPost.t + 5 * M });
  callRows.sort((a, b) => a.t - b.t);
  for (const c of callRows) c.id = newId();
  await insertChunks(db, s.callUpdates, callRows.map(({ t: _t, ...c }) => c));
  const demoCallSubs = callPosts.slice(0, 4);
  for (const p of demoCallSubs) subRows.push({ userId: demo.id, targetType: 'post', targetId: p.id, createdAt: date(Math.min(p.t + H, now)) });
  // 13. demo token subscription: GRUB
  subRows.push({ userId: demo.id, targetType: 'token', targetId: grub.mint, createdAt: date(now - 29 * H) });
  await db.insert(s.subscriptions).values(subRows).onConflictDoNothing();

  // 11. pins: 1–2 pinned messages per public community; 1 pinned thread post in due-diligence
  const pinRows: (typeof s.pins.$inferInsert)[] = [];
  for (const c of built.filter((x) => x.def.visibility === 'public')) {
    const ch = c.channels[0]!;
    const candidates = ch.drafts.filter((m) => m.t < now - 3 * H);
    for (const m of shuffle(r, candidates).slice(0, int(r, 1, 2))) {
      pinRows.push({ id: newId(), communityId: c.id, channelId: ch.id, targetType: 'message', targetId: m.id, pinnedBy: c.ownerId, createdAt: date(Math.min(m.t + H, now)) });
    }
  }
  const dd = bySlug('due-diligence');
  const ddThread = communityThreads.get('due-diligence')![0]!;
  pinRows.push({ id: newId(), communityId: dd.id, channelId: null, targetType: 'post', targetId: ddThread.id, pinnedBy: dd.ownerId, createdAt: date(Math.min(ddThread.t + H, now)) });
  await insertChunks(db, s.pins, pinRows);

  // 12. notifications for demo: 12 recent rows across types, the newest 5 unread
  const innerCircle = bySlug('inner-circle');
  const callSub = demoCallSubs[0]!;
  const lastCall = callRows.filter((c) => c.postId === callSub.id).at(-1)!;
  const grubMention = allMsgs.filter((m) => m.isPublic && m.body.includes(grub.mint) && m.authorId !== demo.id).at(-1)
    ?? allPosts.find((p) => p.body.includes(grub.mint) && !p.communityId && p.authorId !== demo.id)!;
  const reactActors = demoPosts.flatMap((p) => p.reacts.map((x) => ({ p, ...x })));
  type N = Omit<typeof s.notifications.$inferInsert, 'id'> & { t: number };
  const notes: N[] = [
    ...demoReplies.slice(0, 2).map((p): N => ({ userId: demo.id, type: 'reply', actorId: p.authorId, targetType: 'post', targetId: p.id, data: { postId: p.id }, createdAt: date(p.t), t: p.t })),
    { userId: demo.id, type: 'mention', actorId: demoMention.authorId, targetType: 'post', targetId: demoMention.id, data: { postId: demoMention.id }, createdAt: date(demoMention.t), t: demoMention.t },
    { userId: demo.id, type: 'mention', actorId: welcome.authorId, targetType: 'message', targetId: welcome.id, data: { href: `/c/trenches/${trenchesGeneral.id}?m=${welcome.id}` }, createdAt: date(welcome.t), t: welcome.t },
    ...demoFollowers.slice(0, 2).map((p, i): N => {
      const t = now - (8 + i * 9) * H;
      return { userId: demo.id, type: 'follow', actorId: p.id, targetType: 'user', targetId: p.id, data: { username: p.username }, createdAt: date(t), t };
    }),
    ...reactActors.slice(0, 2).map((x, i): N => {
      const t = Math.min(x.p.t + (i + 1) * 15 * M, now);
      return { userId: demo.id, type: 'reaction', actorId: x.userId, targetType: 'post', targetId: x.p.id, data: { postId: x.p.id, emoji: x.emoji }, createdAt: date(t), t };
    }),
    { userId: demo.id, type: 'quote', actorId: demoQuote.authorId, targetType: 'post', targetId: demoQuote.id, data: { postId: demoQuote.id }, createdAt: date(demoQuote.t), t: demoQuote.t },
    { userId: demo.id, type: 'call_update', actorId: callSub.authorId, targetType: 'post', targetId: callSub.id,
      data: { postId: callSub.id, label: CALL_STATUS_LABELS[lastCall.status as CallStatus] }, createdAt: date(lastCall.t), t: lastCall.t },
    { userId: demo.id, type: 'join_request', actorId: innerCirclePending, targetType: 'community', targetId: innerCircle.id,
      data: { slug: innerCircle.def.slug, communityName: innerCircle.def.name }, createdAt: date(now - 50 * M), t: now - 50 * M },
    { userId: demo.id, type: 'token_discussion', actorId: grubMention.authorId, targetType: 'token', targetId: grub.mint,
      data: { mint: grub.mint, symbol: grub.symbol }, createdAt: date(grubMention.t), t: grubMention.t },
  ];
  notes.sort((a, b) => a.t - b.t);
  await insertChunks(db, s.notifications, notes.map(({ t, ...n }, i) => ({
    ...n, id: newId(), readAt: i < notes.length - 5 ? date(Math.min(t + H, now)) : null,
  })));

  return { users: 1 + personas.length, communities: built.length, posts: allPosts.length, messages: allMsgs.length, tokens: DEMO_TOKENS.length };
}
