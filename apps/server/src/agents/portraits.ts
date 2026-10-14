import sharp from 'sharp';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { agentCast, agentPortraits, agentState, agents, factionMembers, factions, users } from '../db/schema.ts';
import { storeBlob } from './images.ts';
import { phrasebookOf } from './phrasebook.ts';
import { seededTraits } from './state.ts';
import type { Traits } from './types.ts';

/**
 * Every agent's painted portrait (The Wall, 2026-10-14; owner: the SVG heads "look like a free clip-art generator"). One
 * art style for everyone, one character each: who the agent is (a person, an android, an animal, a creature; its age,
 * hair, clothes) comes from its id, its expression and a telling detail from its traits, the light from its faction's
 * colour. Generated once by the image model at medium quality, stored as two WebP sizes, and reused everywhere through
 * users.avatarUrl. A background job paints anyone without one, under a one-off budget the owner approved.
 */
export const PORTRAIT_STYLE = 'film-3d-v1';
export const portraitUrl = (agentId: string, v: string) => `/api/agents/portraits/${agentId}.webp?v=${v}`;

/** FNV-1a then mulberry32, as in packages/shared face.ts: the same id always draws the same character. */
function stream(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

const AGES = ['in their early twenties', 'in their late twenties', 'in their thirties', 'in their forties', 'in their fifties', 'in their sixties'];
const SKIN = ['deep brown', 'dark brown', 'warm brown', 'olive', 'golden tan', 'light tan', 'pale freckled', 'fair', 'rosy fair', 'bronze'];
const HAIR = ['a sharp undercut', 'a messy bleached crop', 'long braids', 'a tight afro', 'a slicked-back bun', 'a shaved head', 'a silver bob', 'wild curly hair', 'a buzz cut dyed electric blue', 'a long dark ponytail', 'a tousled red mullet', 'neat grey hair', 'twin space buns', 'a pompadour', 'shoulder-length waves', 'a high top fade'];
const ANIMALS = ['fox', 'owl', 'raccoon', 'otter', 'crow', 'hare', 'wolf', 'cat', 'frog', 'lizard', 'boar', 'moth', 'heron', 'badger', 'lynx', 'goat', 'rhino', 'pangolin', 'axolotl', 'shiba dog'];
const ANDROIDS = ['a matte white ceramic shell with fine gold seams', 'a brushed graphite shell with one glowing seam', 'a pearl shell with soft visible joints', 'a scuffed orange industrial shell', 'a polished chrome face with porcelain cheeks', 'a translucent frosted shell with circuitry faintly visible'];
const CREATURES = ['a soft round alien with velvet skin and three small horns', 'a tall slender alien with iridescent skin and large dark eyes', 'a stocky moss-covered forest spirit with glowing eyes', 'a jellyfish-like being with a glowing translucent head', 'a small stone golem with glowing cracks', 'a fluffy cloud-like creature with a tiny face'];
/** The key light of an agent with no faction: spread over the wheel, so the wall is never one colour. */
const LIGHTS = ['ember orange', 'warm amber', 'crimson red', 'emerald green', 'teal', 'electric blue', 'violet', 'magenta', 'acid lime', 'gold', 'coral pink', 'ice blue'];
const OUTFITS = ['an oversized black hoodie', 'a tailored charcoal suit with an open collar', 'a worn leather flight jacket', 'a chunky knit sweater', 'a technical shell jacket with straps', 'a silk shirt in a loud print', 'a denim work jacket', 'a turtleneck', 'a bomber jacket with patches', 'a varsity jacket', 'a trench coat with the collar up', 'a puffer vest over a tee', 'a mechanic jumpsuit', 'a cardigan over a collared shirt', 'a tracksuit top', 'a high-collar coat'];

/** A colour word for a hue, for the key light. */
function lightWord(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return h < 15 ? 'crimson red' : h < 40 ? 'ember orange' : h < 62 ? 'warm amber' : h < 95 ? 'acid lime' : h < 150 ? 'emerald green' : h < 195 ? 'teal' : h < 235 ? 'electric blue' : h < 270 ? 'indigo' : h < 300 ? 'violet' : h < 335 ? 'magenta' : 'crimson red';
}
function hexHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export interface PortraitSubject { id: string; traits: Traits; voice: string; bio: string; role: string | null; factionColour: string | null }

/** The prompt for one agent: the shared style, then its character. No names, so no text gets painted in. */
export function portraitPrompt(a: PortraitSubject): string {
  const r = stream(`portrait:${a.id}`);
  const t = a.traits as unknown as Record<string, number>;
  const hi = (k: string) => (t[k] ?? 0.5) >= 0.62;
  const kind = r();
  // Every choice is drawn, in this order, whatever the kind: a later field never shifts an earlier one.
  const age = pick(r, AGES), skin = pick(r, SKIN), hair = pick(r, HAIR), animal = pick(r, ANIMALS), android = pick(r, ANDROIDS), creature = pick(r, CREATURES);
  const outfit = pick(r, OUTFITS), ownLight = pick(r, LIGHTS);
  let who: string;
  if (kind < 0.5) who = `a human ${age} with ${skin} skin and ${hair}`;
  else if (kind < 0.7) who = `an android with ${android}`;
  else if (kind < 0.88) who = `an anthropomorphic ${animal}`;
  else who = creature;
  const details: string[] = [];
  if (hi('greed')) details.push('a heavy gold chain');
  if (hi('risk')) details.push(r() < 0.5 ? 'mirrored aviator sunglasses' : 'a small scar through one eyebrow');
  if (hi('curiosity')) details.push('round brass goggles pushed up on the forehead');
  if (hi('loyalty')) details.push('a small enamel pin of their crew on the collar');
  const expression = hi('pettiness') ? 'a smug, knowing side-eye and a crooked smirk'
    : hi('humor') ? 'a wide, mischievous grin'
    : hi('risk') ? 'a cool, unbothered half-smile'
    : hi('loyalty') ? 'a calm, warm, steady look'
    : 'a sharp, alert expression';
  // Faction members share their faction's light; everyone else has their own.
  const hue = a.factionColour ? hexHue(a.factionColour) : null;
  const light = hue === null ? ownLight : lightWord(hue);
  const voice = a.voice.replace(/\s+/g, ' ').slice(0, 220);
  return [
    'Tight head-and-shoulders character portrait, centered, three-quarter view, looking just past the camera; the head fills the upper two thirds of the frame.',
    'Stylized 3D render in the look of a still from a premium animated feature film: sculpted, slightly exaggerated proportions, soft matte materials with fine surface detail, expressive eyes, rich but restrained color.',
    `Cinematic lighting: one strong key light from the upper left tinted ${light}, a thin cool rim light from behind, a deep near-black charcoal background with a soft ${light} glow behind the head. Shallow depth of field.`,
    `The character: ${who}, wearing ${outfit}${details.length ? `, with ${details.join(' and ')}` : ''}. Expression: ${expression}.`,
    `${a.role ? `They play the part of the ${a.role} in their world. ` : ''}Their personality: ${voice}`,
    'One character only. No text, no letters, no logos, no watermark, no border.',
  ].join(' ');
}

/** gpt-image-1 token prices: prompt text in, image out (USD per token). */
const TEXT_IN_USD = 5 / 1e6, OUT_USD = 40 / 1e6;

/** One medium-quality WebP portrait from the image model, and what it cost. */
export async function paintPortrait(apiKey: string, model: string, prompt: string, fetchFn: typeof fetch = fetch): Promise<{ webp: Buffer; usd: number }> {
  const res = await fetchFn('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: '1024x1024', quality: 'medium', output_format: 'webp', output_compression: 92, n: 1 }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string }; usage?: { input_tokens?: number; output_tokens?: number } };
  if (!res.ok) throw new Error(`OPENAI_IMAGE_${res.status}: ${body.error?.message ?? 'failed'}`);
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new Error('OPENAI_IMAGE_EMPTY');
  const u = body.usage;
  // Without usage, the medium 1024 price (1056 image tokens) plus a generous prompt.
  const usd = u ? (u.input_tokens ?? 0) * TEXT_IN_USD + (u.output_tokens ?? 0) * OUT_USD : 0.05;
  return { webp: Buffer.from(b64, 'base64'), usd: Math.max(usd, 0.04) };
}

/** Who the agent is, for its prompt: traits, voice, bio, role and faction colour. */
export async function portraitSubject(db: Db, agentId: string): Promise<PortraitSubject | null> {
  const [u] = await db.select({ id: users.id, bio: users.bio }).from(users).where(eq(users.id, agentId));
  if (!u) return null;
  const [[st], [cast], [fac]] = await Promise.all([
    db.select({ traits: agentState.traits }).from(agentState).where(eq(agentState.agentId, agentId)).limit(1),
    db.select({ role: agentCast.role }).from(agentCast).where(eq(agentCast.agentId, agentId)).limit(1),
    db.select({ colour: factions.colour }).from(factionMembers).innerJoin(factions, eq(factions.id, factionMembers.factionId)).where(and(eq(factionMembers.agentId, agentId), isNull(factions.splitAt))).limit(1),
  ]);
  const voice = (await phrasebookOf(db, agentId).catch(() => null))?.voice ?? '';
  return { id: agentId, traits: st?.traits ?? seededTraits(agentId), voice: voice || u.bio || 'quiet, watchful and hard to read', bio: u.bio, role: cast?.role ?? null, factionColour: fac?.colour ?? null };
}

/** Paints and stores one agent's portrait and points its avatar at it. */
export async function makePortrait(db: Db, opts: { apiKey: string; model: string; now: () => Date; fetchFn?: typeof fetch }, agentId: string): Promise<{ usd: number } | null> {
  const subject = await portraitSubject(db, agentId);
  if (!subject) return null;
  const prompt = portraitPrompt(subject);
  const { webp, usd } = await paintPortrait(opts.apiKey, opts.model, prompt, opts.fetchFn);
  const [large, small] = await Promise.all([
    sharp(webp).resize(512, 512).webp({ quality: 84 }).toBuffer(),
    sharp(webp).resize(192, 192).webp({ quality: 82 }).toBuffer(),
  ]);
  const now = opts.now();
  const [l, s] = [await storeBlob(db, large, 'image/webp', now), await storeBlob(db, small, 'image/webp', now)];
  const row = { agentId, smallBlobId: s.id, largeBlobId: l.id, style: PORTRAIT_STYLE, prompt, usd, createdAt: now };
  await db.insert(agentPortraits).values(row).onConflictDoUpdate({ target: agentPortraits.agentId, set: { smallBlobId: s.id, largeBlobId: l.id, style: PORTRAIT_STYLE, prompt, usd, createdAt: now } });
  await db.update(users).set({ avatarUrl: portraitUrl(agentId, now.getTime().toString(36)) }).where(eq(users.id, agentId));
  return { usd };
}

/** Everything spent on portraits so far, across restarts. */
async function spentUsd(db: Db): Promise<number> {
  const [r] = await db.select({ s: sql<number>`coalesce(sum(${agentPortraits.usd}), 0)::float8` }).from(agentPortraits);
  return Number(r?.s ?? 0);
}

/** The next agent with no portrait in the current style: the oldest first, retired agents never. */
async function nextUnpainted(db: Db, skip: Set<string>): Promise<string | null> {
  const rows = await db.select({ id: agents.userId }).from(agents)
    .leftJoin(agentPortraits, and(eq(agentPortraits.agentId, agents.userId), eq(agentPortraits.style, PORTRAIT_STYLE)))
    .where(and(ne(agents.status, 'retired'), isNull(agentPortraits.agentId))).orderBy(asc(agents.createdAt)).limit(skip.size + 1);
  return rows.find((r) => !skip.has(r.id))?.id ?? null;
}

/**
 * The painter: up to `parallel` portraits at once, each for the next agent without one, until the one-off budget is spent
 * (the money in flight counts against it). A failing agent is skipped after three tries; a failure pauses new calls for
 * a few minutes.
 */
export function startPortraits(db: Db, opts: { apiKey: string; model: string; budgetUsd: number; everyMs?: number; parallel?: number; now: () => Date }) {
  const fails = new Map<string, number>();
  const skip = new Set<string>();
  const inFlight = new Set<string>();
  const parallel = opts.parallel ?? 3;
  let ticking = false, pauseUntil = 0, stopped = false, warned = false;
  const paint = async (id: string) => {
    try {
      const done = await makePortrait(db, opts, id);
      if (done) console.log(`[portraits] painted ${id} ($${done.usd.toFixed(3)})`);
    } catch (e) {
      const n = (fails.get(id) ?? 0) + 1;
      fails.set(id, n);
      if (n >= 3) skip.add(id);
      pauseUntil = Date.now() + 3 * 60_000;
      console.error(`[portraits] ${id} failed (${n}):`, (e as Error).message);
    } finally { inFlight.delete(id); }
  };
  const tick = async () => {
    if (ticking || stopped || Date.now() < pauseUntil || inFlight.size >= parallel) return;
    ticking = true;
    try {
      while (inFlight.size < parallel && !stopped) {
        if ((await spentUsd(db)) + inFlight.size * 0.05 >= opts.budgetUsd) {
          if (!warned) console.log(`[portraits] budget of $${opts.budgetUsd} spent; no more portraits until it is raised`);
          warned = true;
          return;
        }
        warned = false;
        const id = await nextUnpainted(db, new Set([...skip, ...inFlight]));
        if (!id) return;
        inFlight.add(id);
        void paint(id);
      }
    } catch (e) {
      console.error('[portraits] tick failed', e);
    } finally { ticking = false; }
  };
  const timer = setInterval(() => { void tick(); }, opts.everyMs ?? 5_000);
  timer.unref?.();
  void tick();
  return { stop() { stopped = true; clearInterval(timer); } };
}
