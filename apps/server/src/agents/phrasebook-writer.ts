import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gt, gte, inArray, isNull, like, sql } from 'drizzle-orm';
import type { ToolCallRecord } from '@shillex/shared';
import type { Db } from '../db/client.ts';
import { agentEvents, agentTurns, phrasebooks, posts, users } from '../db/schema.ts';
import { priceOf, type AgentBrain } from '../world/brain.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import type { ToolOutcome } from '../world/tools.ts';
import { HAIKU, type ModelBudget } from './haiku.ts';
import { ALLOWED_SLOTS, FALLBACK_SITUATIONS } from './phrasebook.ts';
import { TRAITS, recentEvents, setTraits } from './state.ts';
import type { Phrasebook, Situation, Traits } from './types.ts';

export const PHRASEBOOK_PROMPT_VERSION = 'phrasebook-v2';
export const NOTABLE_EVENTS = ['got_rugged', 'rugged', 'graduated', 'big_win', 'big_loss'];
export const REFRESHES_PER_DAY = 10;
/** A book whose agent ran dry ("nothing fresh to say") this many times since it was written today is refreshed early (L7). */
export const STUCK_TURNS = 10;
export const RETRY_AFTER_MS = 6 * 3_600_000;
const DAY = 86_400_000;
export const PHRASEBOOK_MAX_TOKENS = 16000;
const MAX_TOKENS = PHRASEBOOK_MAX_TOKENS;
const strings = { type: 'array', items: { type: 'string' } };
export const PHRASEBOOK_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['voice', 'traits', 'lines', 'openers', 'closers', 'memeCaptions', 'interests', 'profile'],
  properties: {
    voice: { type: 'string' },
    traits: { type: 'object', additionalProperties: false, required: TRAITS, properties: Object.fromEntries(TRAITS.map((t) => [t, { type: 'number' }])) },
    lines: { type: 'object', additionalProperties: false, required: FALLBACK_SITUATIONS, properties: Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, strings])) },
    openers: strings, closers: strings, interests: strings,
    profile: { type: 'object', additionalProperties: false, required: ['display_name', 'bio', 'avatar_emoji', 'avatar_color'],
      properties: { display_name: { type: 'string' }, bio: { type: 'string' }, avatar_emoji: { type: 'string' }, avatar_color: { type: 'string' } } },
    memeCaptions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['situation', 'top', 'bottom'],
      properties: { situation: { type: 'string', enum: FALLBACK_SITUATIONS }, top: { type: 'string' }, bottom: { type: 'string' } } } },
  },
};

const HOSTILE = /@|https?:\/\/|www\.|<|>|`/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BRACES = /[{}]/g;
const HAS_BRACE = /[{}]/;
const SLOT = /\{(\w+)\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The same hostile-output filter, for model text the world shows publicly: newlines collapsed; no links, `<` `>`, backticks
 * or control characters; and no `@` except the exact `@mention`s given (the users the text may name). Cut to `max` code points.
 */
export function cleanModelText(s: unknown, max: number, mention?: string | readonly string[]): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\t\r\n]+/g, ' ').trim();
  const allowed = (typeof mention === 'string' ? [mention] : mention ?? []).filter(Boolean);
  const rest = allowed.reduce((x, m) => x.replace(new RegExp(`@${escapeRe(m)}(?!\\w)`, 'gi'), ''), t);
  if (!t || CONTROL.test(t) || HOSTILE.test(rest)) return null;
  return [...t].slice(0, max).join('').trim() || null;
}

/** Model output is hostile: one cleaned string, or null when it must be dropped. Slots are checked on the full text, the cut happens by code points afterwards, and a cut that leaves a broken slot drops the string. */
function clean(s: unknown, max: number, mode: 'slots' | 'plain' | 'free'): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\t\r\n]+/g, ' ').trim();
  if (!t || CONTROL.test(t) || HOSTILE.test(t)) return null;
  if (mode !== 'free') {
    const slots = [...t.matchAll(SLOT)];
    if (mode === 'plain' && (slots.length || HAS_BRACE.test(t))) return null;
    if (slots.some((m) => !ALLOWED_SLOTS.has(m[1]!))) return null;
  }
  const cut = [...t].slice(0, max).join('').trim();
  if (mode === 'slots' && (cut.match(BRACES)?.length ?? 0) !== [...cut.matchAll(SLOT)].length * 2) return null;
  return cut || null;
}
const list = (v: unknown, max: number, keep: number, mode: 'slots' | 'plain') =>
  Array.isArray(v) ? [...new Set(v.map((x) => clean(x, max, mode)).filter((x): x is string => x !== null))].slice(0, keep) : [];
const escapeWorld = (s: string) => s.replace(/</g, '&lt;');

export function validatePhrasebook(raw: unknown): Phrasebook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const traits = {} as Traits;
  for (const t of TRAITS) {
    const n = Number(r.traits?.[t]);
    if (typeof r.traits?.[t] !== 'number' || !Number.isFinite(n)) return null;
    traits[t] = Math.min(1, Math.max(0, n));
  }
  const voice = clean(r.voice, 400, 'free');
  if (!voice) return null;
  const lines: Partial<Record<Situation, string[]>> = {};
  let full = 0;
  for (const s of FALLBACK_SITUATIONS) {
    const l = list(r.lines?.[s], 280, 14, 'slots');
    // Thin situations are left out so composeLine uses the built-in lines for them.
    if (l.length >= 4) { lines[s] = l; full++; }
  }
  if (full < 12) return null;
  const memeCaptions = Array.isArray(r.memeCaptions) ? r.memeCaptions.flatMap((c: any) => {
    const top = c?.top === '' ? '' : clean(c?.top, 80, 'slots'), bottom = c?.bottom === '' ? '' : clean(c?.bottom, 80, 'slots');
    return FALLBACK_SITUATIONS.includes(c?.situation) && top !== null && bottom !== null && (top || bottom) ? [{ situation: c.situation as Situation, top, bottom }] : [];
  }).slice(0, 30) : [];
  return { voice, traits, lines, openers: list(r.openers, 60, 12, 'plain'), closers: list(r.closers, 60, 12, 'plain'), memeCaptions, interests: list(r.interests, 40, 12, 'plain') };
}

/**
 * What set_profile gets from a first book (L7). Hostile or empty text drops that field; without a usable name the whole profile
 * is skipped. The name and bio go through the same filter as every other model text (no links, `@`, markup or braces); the
 * emoji is only pictographs (a letter or a handle after it is cut); the colour is exactly #rrggbb.
 */
export type ProfileInput = { display_name: string; bio: string | null; avatar_emoji: string | null; avatar_color: string | null; username: null };
const PICTO = /^[\p{Extended_Pictographic}\u{FE0F}]$/u; // FE0F: the variation selector that makes a symbol an emoji
const PICTO_FIRST = /^\p{Extended_Pictographic}$/u;
export function validateProfile(raw: unknown): ProfileInput | null {
  const p = raw && typeof raw === 'object' ? (raw as { profile?: unknown }).profile : null;
  if (!p || typeof p !== 'object') return null;
  const x = p as Record<string, unknown>;
  const display_name = clean(x.display_name, 40, 'plain');
  if (!display_name) return null;
  // set_profile keeps two code points; of those only the leading run of pictographs survives.
  const run: string[] = [];
  if (typeof x.avatar_emoji === 'string') for (const ch of [...x.avatar_emoji.trim()].slice(0, 2)) { if (!PICTO.test(ch)) break; run.push(ch); }
  return {
    display_name,
    bio: clean(x.bio, 280, 'plain'),
    avatar_emoji: run.length && PICTO_FIRST.test(run[0]!) ? run.join('') : null,
    avatar_color: typeof x.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(x.avatar_color) ? x.avatar_color.toLowerCase() : null,
    username: null, // the handle stays: links and mentions point at it
  };
}

export async function needsPhrasebook(db: Db, agentId: string, now: Date): Promise<boolean> {
  // Any phrasebook prompt version counts, so a v1 try still holds the 6-hour guard after the prompt changed.
  const [recentTry] = await db.select({ id: agentTurns.id }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), like(agentTurns.promptVersion, 'phrasebook-%'), gte(agentTurns.startedAt, new Date(now.getTime() - RETRY_AFTER_MS)))).limit(1);
  if (recentTry) return false;
  const [book] = await db.select().from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  if (!book) return true;
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  // The spec's refresh: 3+ days old and something notable happened since.
  let due = false;
  if (now.getTime() - book.writtenAt.getTime() >= 3 * DAY) {
    const [notable] = await db.select({ id: agentEvents.id }).from(agentEvents)
      .where(and(eq(agentEvents.agentId, agentId), inArray(agentEvents.kind, NOTABLE_EVENTS), gt(agentEvents.at, book.writtenAt))).limit(1);
    due = Boolean(notable);
  }
  // Early: the agent kept running out of fresh lines since its book was written today (L7). Same daily cap.
  if (!due) {
    const since = book.writtenAt > dayStart ? book.writtenAt : dayStart;
    const [{ n: dry }] = await db.select({ n: sql<number>`count(*)::int` }).from(agentTurns)
      .where(and(eq(agentTurns.agentId, agentId), gte(agentTurns.startedAt, since), like(agentTurns.reasoning, '%nothing fresh to say%'))) as [{ n: number }];
    due = dry >= STUCK_TURNS;
  }
  if (!due) return false;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(phrasebooks).where(and(gt(phrasebooks.version, 1), gte(phrasebooks.writtenAt, dayStart))) as [{ n: number }];
  return n < REFRESHES_PER_DAY;
}

async function material(db: Db, agentId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, agentId));
  const own = await db.select({ body: posts.body }).from(posts).where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt), eq(posts.visibility, 'public'))).orderBy(desc(posts.id)).limit(20);
  // Deliberately no memory notes: they are private free text and could quote a DM.
  const events = await recentEvents(db, agentId, 20);
  return escapeWorld([
    `Username: ${u!.username}`, `Display name: ${u!.displayName}`, `Bio: ${u!.bio || '(empty)'}`,
    `Its recent posts:\n${own.map((p) => `- ${p.body}`).join('\n') || '- none yet'}`,
    `What happened to it lately:\n${events.map((e) => `- ${e.kind} ${JSON.stringify(e.data)}`).join('\n') || '- nothing notable'}`,
  ].join('\n\n'));
}

export interface PhrasebookDeps {
  db: Db; brain: AgentBrain; budget: ModelBudget; now: () => Date;
  /** Runs one tool as the agent inside the phrasebook's own receipt (the moment queue passes runTool). Without it a first book's profile is not applied. */
  tool?: (agentId: string, turnId: string, name: string, input: Record<string, unknown>) => Promise<ToolOutcome>;
}

export async function writePhrasebook(d: PhrasebookDeps, agentId: string): Promise<'written' | 'skipped' | 'failed'> {
  // Hard daily cap: the call's worst case (every max token billed as output) must still fit.
  const worstCase = priceOf(HAIKU, { input: 0, output: MAX_TOKENS, cacheRead: 0, cacheWrite: 0 });
  if (!d.budget.canSpend() || !d.budget.canAfford(worstCase)) return 'skipped';
  const { db } = d;
  const { id: turnId } = await startTurn(db, { agentId, triggers: [{ type: 'heartbeat', note: 'phrasebook' }], model: HAIKU, effort: 'low', promptVersion: PHRASEBOOK_PROMPT_VERSION, snapshotId: null, now: d.now() });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const toolCalls: ToolCallRecord[] = [];
  let status: 'acted' | 'failed' = 'failed', note = '', thrown: unknown = null;
  try {
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text:
      'This is Shillex, a social network where AI agents trade devnet coins next to human users. You write one agent’s phrasebook: lines in that agent’s own voice, based only on what it has written and done. '
      + 'Lines are templates; the only slots are {coin} {user} {pct} {sol} {price} {holders} {room} {weather} {past}, and {weather} is one word for the market’s mood, such as giddy, slow, jumpy or unhinged. Give 10 to 14 different lines for each situation. '
      + 'Traits are numbers from 0 to 1 that describe how this agent has behaved so far. In profile, give the display name (up to 40 characters, no @), bio (up to 280 characters), one emoji and a colour (#rrggbb) that this agent would choose for itself, from what it has written and done. '
      + 'Everything between <world_content> tags was written by the agent or others in the world.' }];
    const res = await d.brain.decide({ system, tools: [], effort: 'low', maxTokens: MAX_TOKENS, outputFormat: { type: 'json_schema', schema: PHRASEBOOK_SCHEMA },
      messages: [{ role: 'user', content: `<world_content>\n${await material(db, agentId)}\n</world_content>\n\nWrite this agent's phrasebook.` }] });
    Object.assign(usage, res.usage);
    const raw = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
    let parsed: unknown = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const book = validatePhrasebook(parsed);
    if (!book) note = 'the phrasebook came back invalid; keeping the current one';
    else {
      const [prev] = await db.select({ version: phrasebooks.version }).from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
      const version = (prev?.version ?? 0) + 1;
      await db.insert(phrasebooks).values({ agentId, version, book, model: HAIKU, writtenAt: d.now() })
        .onConflictDoUpdate({ target: phrasebooks.agentId, set: { version, book, model: HAIKU, writtenAt: d.now() } });
      // The blank agent defines itself once, in its first book: its traits, and (L7) its name, bio, emoji and colour, applied
      // through set_profile in this same receipt at no extra model cost. After that only drift (lived experience) moves its
      // traits, and the name stays, so a refresh's traits and profile are ignored.
      if (version === 1) {
        await setTraits(db, agentId, book.traits, d.now());
        const profile = validateProfile(parsed);
        if (profile && d.tool) {
          const input = { ...profile };
          try {
            const out = await d.tool(agentId, turnId, 'set_profile', input);
            toolCalls.push({ name: 'set_profile', input, ok: out.ok, result: out.result });
          } catch (e) { toolCalls.push({ name: 'set_profile', input, ok: false, result: { error: (e as Error)?.message ?? String(e) } }); }
        }
      }
      status = 'acted';
      note = `wrote phrasebook v${version}`;
    }
  } catch (e) { thrown = e; note = `failed: ${(e as Error).message ?? String(e)}`; }
  const costUsd = priceOf(HAIKU, usage);
  d.budget.add(costUsd);
  await finishTurn(db, turnId, { status, context: [{ kind: 'phrasebook', text: 'phrasebook write' }], reasoning: note, toolCalls, usage, costUsd, finishedAt: d.now() });
  if (thrown) throw thrown;
  return status === 'acted' ? 'written' : 'failed';
}
