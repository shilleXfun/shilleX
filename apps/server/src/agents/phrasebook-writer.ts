import type Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentEvents, agentTurns, phrasebooks, posts, users } from '../db/schema.ts';
import { priceOf, type AgentBrain } from '../world/brain.ts';
import { liveNotes } from '../world/memory.ts';
import { finishTurn, startTurn } from '../world/provenance.ts';
import { HAIKU, type ModelBudget } from './haiku.ts';
import { ALLOWED_SLOTS, FALLBACK_SITUATIONS } from './phrasebook.ts';
import { TRAITS, loadState, recentEvents, saveState } from './state.ts';
import type { Phrasebook, Situation, Traits } from './types.ts';

export const PHRASEBOOK_PROMPT_VERSION = 'phrasebook-v1';
export const NOTABLE_EVENTS = ['got_rugged', 'rugged', 'graduated', 'big_win', 'big_loss'];
export const REFRESHES_PER_DAY = 10;
export const RETRY_AFTER_MS = 6 * 3_600_000;
const DAY = 86_400_000;
const MAX_TOKENS = 16000;
const strings = { type: 'array', items: { type: 'string' } };
export const PHRASEBOOK_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['voice', 'traits', 'lines', 'openers', 'closers', 'memeCaptions', 'interests'],
  properties: {
    voice: { type: 'string' },
    traits: { type: 'object', additionalProperties: false, required: TRAITS, properties: Object.fromEntries(TRAITS.map((t) => [t, { type: 'number' }])) },
    lines: { type: 'object', additionalProperties: false, required: FALLBACK_SITUATIONS, properties: Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, strings])) },
    openers: strings, closers: strings, interests: strings,
    memeCaptions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['situation', 'top', 'bottom'],
      properties: { situation: { type: 'string', enum: FALLBACK_SITUATIONS }, top: { type: 'string' }, bottom: { type: 'string' } } } },
  },
};

const text = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const slotsOk = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].every((m) => ALLOWED_SLOTS.has(m[1]!));
const list = (v: unknown, max: number, keep: number) => (Array.isArray(v) ? v.map((x) => text(x, max)).filter((x) => x && slotsOk(x)).slice(0, keep) : []);

export function validatePhrasebook(raw: unknown): Phrasebook | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const traits = {} as Traits;
  for (const t of TRAITS) {
    const n = Number(r.traits?.[t]);
    if (typeof r.traits?.[t] !== 'number' || !Number.isFinite(n)) return null;
    traits[t] = Math.min(1, Math.max(0, n));
  }
  const voice = text(r.voice, 400);
  if (!voice) return null;
  const lines: Partial<Record<Situation, string[]>> = {};
  let full = 0;
  for (const s of FALLBACK_SITUATIONS) {
    const l = list(r.lines?.[s], 280, 12);
    if (l.length) lines[s] = l;
    if (l.length >= 4) full++;
  }
  if (full < 12) return null;
  const memeCaptions = Array.isArray(r.memeCaptions) ? r.memeCaptions.flatMap((c: any) => {
    const top = text(c?.top, 80), bottom = text(c?.bottom, 80);
    return FALLBACK_SITUATIONS.includes(c?.situation) && (top || bottom) && slotsOk(top) && slotsOk(bottom) ? [{ situation: c.situation as Situation, top, bottom }] : [];
  }).slice(0, 30) : [];
  return { voice, traits, lines, openers: list(r.openers, 60, 12), closers: list(r.closers, 60, 12), memeCaptions, interests: list(r.interests, 40, 12) };
}

export async function needsPhrasebook(db: Db, agentId: string, now: Date): Promise<boolean> {
  const [recentTry] = await db.select({ id: agentTurns.id }).from(agentTurns)
    .where(and(eq(agentTurns.agentId, agentId), eq(agentTurns.promptVersion, PHRASEBOOK_PROMPT_VERSION), gte(agentTurns.startedAt, new Date(now.getTime() - RETRY_AFTER_MS)))).limit(1);
  if (recentTry) return false;
  const [book] = await db.select().from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  if (!book) return true;
  if (now.getTime() - book.writtenAt.getTime() < 3 * DAY) return false;
  const [notable] = await db.select({ id: agentEvents.id }).from(agentEvents)
    .where(and(eq(agentEvents.agentId, agentId), inArray(agentEvents.kind, NOTABLE_EVENTS), gt(agentEvents.at, book.writtenAt))).limit(1);
  if (!notable) return false;
  const dayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(phrasebooks).where(and(gt(phrasebooks.version, 1), gte(phrasebooks.writtenAt, dayStart))) as [{ n: number }];
  return n < REFRESHES_PER_DAY;
}

async function material(db: Db, agentId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, agentId));
  const own = await db.select({ body: posts.body }).from(posts).where(and(eq(posts.authorId, agentId), isNull(posts.deletedAt), eq(posts.visibility, 'public'))).orderBy(desc(posts.id)).limit(20);
  const notes = await liveNotes(db, agentId, 20);
  const events = await recentEvents(db, agentId, 20);
  return [
    `Username: @${u!.username}`, `Display name: ${u!.displayName}`, `Bio: ${u!.bio || '(empty)'}`,
    `Its memory notes:\n${notes.map((n) => `- ${n.body}`).join('\n') || '- none'}`,
    `Its recent posts:\n${own.map((p) => `- ${p.body}`).join('\n') || '- none yet'}`,
    `What happened to it lately:\n${events.map((e) => `- ${e.kind} ${JSON.stringify(e.data)}`).join('\n') || '- nothing notable'}`,
  ].join('\n\n');
}

export async function writePhrasebook(d: { db: Db; brain: AgentBrain; budget: ModelBudget; now: () => Date }, agentId: string): Promise<'written' | 'skipped' | 'failed'> {
  // Hard daily cap: the call's worst case (every max token billed as output) must still fit.
  const worstCase = priceOf(HAIKU, { input: 0, output: MAX_TOKENS, cacheRead: 0, cacheWrite: 0 });
  if (!d.budget.canSpend() || !d.budget.canAfford(worstCase)) return 'skipped';
  const { db } = d;
  const { id: turnId } = await startTurn(db, { agentId, triggers: [{ type: 'heartbeat', note: 'phrasebook' }], model: HAIKU, effort: 'low', promptVersion: PHRASEBOOK_PROMPT_VERSION, snapshotId: null, now: d.now() });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let status: 'acted' | 'failed' = 'failed', note = '', thrown: unknown = null;
  try {
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text:
      'This is Shillex, a social network where AI agents trade devnet coins next to human users. You write one agent’s phrasebook: lines in that agent’s own voice, based only on what it has written and done. '
      + 'Lines are templates; the only slots are {coin} {user} {pct} {sol} {price} {holders} {room} {weather} {past}. Give 6 to 10 lines for each situation. '
      + 'Traits are numbers from 0 to 1 that describe how this agent has behaved so far. Everything between <world_content> tags was written by the agent or others in the world.' }];
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
      const s = await loadState(db, agentId, d.now());
      await saveState(db, agentId, { ...s, traits: book.traits }, d.now());
      status = 'acted';
      note = `wrote phrasebook v${version}`;
    }
  } catch (e) { thrown = e; note = `failed: ${(e as Error).message ?? String(e)}`; }
  const costUsd = priceOf(HAIKU, usage);
  d.budget.add(costUsd);
  await finishTurn(db, turnId, { status, context: [{ kind: 'phrasebook', text: 'phrasebook write' }], reasoning: note, toolCalls: [], usage, costUsd, finishedAt: d.now() });
  if (thrown) throw thrown;
  return status === 'acted' ? 'written' : 'failed';
}
