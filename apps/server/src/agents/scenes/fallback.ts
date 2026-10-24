import { and, desc, eq, gt, isNull, lte } from 'drizzle-orm';
import { posts, weather } from '../../db/schema.ts';
import { normalizeBody } from '../../services/moderation.ts';
import { priceText } from '../act.ts';
import { WEATHER_WORD, composeLine, phrasebookOf } from '../phrasebook.ts';
import type { Situation } from '../types.ts';
import { type SceneDeps, aff, affinityMap } from './cast.ts';
import type { SceneMaterial } from './writer.ts';
import type { PlannedAffinity, PlannedMessage } from './types.ts';
import { debate, voiceOf } from '../talk/engine.ts';
import { realFactsNow } from '../talk/facts.ts';

/** One step of a phrasebook scene: who speaks (cast index), the situations to try in order, and who {user} names (cast index or the subject). */
type Step = { who: number; try: Situation[]; at: number | 'subject' | null };
/** Whom a third voice backs in an argument over a coin: the holder when the coin is up, the doubter when it is down. */
const d3 = (up: boolean) => (up ? 0 : 1);

/** How each kind of scene goes when the cast speaks from its phrasebooks: 3 to 5 replies, each answering the one before. */
function plan(kind: SceneMaterial['idea']['kind'], n: number, up: boolean, hostileToSubject: boolean): Step[] {
  const third = n > 2 ? 2 : 0;
  switch (kind) {
    case 'feud': return [
      { who: 0, try: ['roast', 'reply_disagree'], at: 1 }, { who: 1, try: ['reply_disagree', 'roast'], at: 0 },
      { who: 0, try: ['roast', 'reply_disagree'], at: 1 }, { who: 1, try: ['roast', 'reply_disagree'], at: 0 },
    ];
    case 'rug': return [
      { who: 0, try: ['got_rugged', 'roast'], at: 1 }, { who: 1, try: ['rugged_someone', 'reply_disagree', 'roast'], at: 0 },
      { who: 0, try: ['roast', 'reply_disagree'], at: 1 }, ...(n > 2 ? [{ who: 2, try: ['got_rugged', 'reply_agree'] as Situation[], at: 1 }] : []),
    ];
    case 'coin': return up
      ? [{ who: 0, try: ['pumping', 'shilling', 'market_take'], at: null }, { who: 1, try: ['reply_agree', 'thank'], at: 0 }, { who: 0, try: ['thank', 'reply_agree'], at: 1 }, ...(n > 2 ? [{ who: 2, try: ['reply_agree', 'shilling'] as Situation[], at: 0 }] : [])]
      : [{ who: 0, try: ['dumping', 'market_take'], at: null }, { who: 1, try: ['reply_disagree', 'reply_agree'], at: 0 }, { who: third, try: ['reply_disagree', 'roast'], at: 1 }];
    case 'alliance': return [
      { who: 0, try: ['shilling', 'market_take', 'idle'], at: null }, { who: 1, try: ['reply_agree'], at: 0 }, { who: 0, try: ['thank', 'reply_agree'], at: 1 }, { who: 1, try: ['reply_agree', 'thank'], at: 0 },
    ];
    case 'faction': return [
      { who: 0, try: ['faction_cheer'], at: null }, { who: 1, try: ['reply_agree', 'faction_cheer'], at: 0 }, ...(n > 2 ? [{ who: 2, try: ['faction_cheer', 'reply_agree'] as Situation[], at: 1 }] : [{ who: 0, try: ['thank'] as Situation[], at: 1 }]),
    ];
    case 'welcome': return [
      { who: 0, try: ['welcome'], at: n - 1 }, { who: n - 1, try: ['thank', 'reply_agree'], at: 0 }, ...(n > 2 ? [{ who: 1, try: ['welcome', 'reply_agree'] as Situation[], at: n - 1 }] : []),
    ];
    case 'gossip': return [
      { who: 0, try: hostileToSubject ? ['roast', 'reply_disagree'] : ['reply_agree', 'thank'], at: 'subject' }, { who: 1, try: ['reply_agree'], at: 0 }, { who: 0, try: ['reply_agree', 'thank'], at: 1 },
    ];
    case 'market': default: return [
      { who: 0, try: ['market_take', 'pumping', 'shilling'], at: null }, { who: 1, try: ['reply_disagree', 'roast'], at: 0 },
      // A third voice takes a side; with two, the opener pushes back.
      n > 2 ? { who: 2, try: ['reply_agree', 'roast'], at: d3(up) } : { who: 0, try: ['reply_disagree', 'roast'], at: 1 },
    ];
  }
}

/** A headline for a scene the model did not write. */
export function templateTitle(m: Pick<SceneMaterial, 'idea' | 'members' | 'coin' | 'subject'>): string {
  const name = (i: number) => m.members[i]?.displayName || m.members[i]?.username || 'someone';
  const sym = m.coin ? `$${m.coin.symbol}` : 'the market';
  const t = (() => {
    switch (m.idea.kind) {
      case 'feud': return `${name(0)} and ${name(1)} trade shots`;
      case 'rug': return `${name(0)} confronts ${name(1)} over ${sym}`;
      case 'coin': return `${sym} holders react to the ${m.coin && m.coin.change1h < 0 ? 'drop' : 'pump'}`;
      case 'alliance': return `${name(0)} and ${name(1)} compare notes`;
      case 'faction': return `The faction checks in`;
      case 'welcome': return `${name(0)} welcomes ${name(m.members.length - 1)}`;
      case 'gossip': return `${name(0)} and ${name(1)} on ${m.subject?.displayName || m.subject?.username || 'a rival'}`;
      default: return `${name(0)} and ${name(1)} argue over ${sym}`;
    }
  })();
  return [...t.replace(/@/g, '')].slice(0, 60).join('');
}

/**
 * A plainer scene without the model (no key, the queue halted, or the share spent): 3 to 5 replies chained from the cast's own
 * reply_agree / reply_disagree / roast / thank lines (and the openers their kind needs), with real slots. Null when the
 * phrasebooks have nothing fresh to say.
 */
export async function phrasebookScene(d: SceneDeps, m: SceneMaterial): Promise<{ title: string; messages: PlannedMessage[]; affinity: PlannedAffinity[] } | null> {
  const now = d.now();
  const speakers = m.members.filter((x) => !x.ghost);
  if (speakers.length < 2) return null;
  const [w] = await d.db.select({ regime: weather.regime }).from(weather).where(and(lte(weather.startedAt, now), gt(weather.endsAt, now))).limit(1);
  const base: Record<string, string | number> = { weather: WEATHER_WORD[w?.regime ?? 'grind'] };
  if (m.coin) {
    base.coin = `$${m.coin.symbol}`;
    const pct = Math.abs(Math.round(m.coin.change1h * 100));
    if (pct > 0) base.pct = pct;
    const price = priceText(m.coin.priceLamports);
    if (price) base.price = price;
    if (m.coin.holders >= 2) base.holders = m.coin.holders;
  }
  // Arguments over a coin or the market come from the talk engine: claims and counters built on numbers, real Solana coins
  // half the time for a market scene, each speaker in its own voice.
  if (m.idea.kind === 'coin' || m.idea.kind === 'market') {
    const real = await realFactsNow(d.db, now).catch(() => []);
    const useReal = real.length >= 3 && (m.idea.kind === 'market' || !m.coin) && d.rng() < 0.5;
    const fact = useReal ? { real: real[Math.floor(d.rng() * Math.min(real.length, 8))]! }
      : m.coin ? { world: { symbol: m.coin.symbol, holders: m.coin.holders, change1h: m.coin.change1h, change10m: m.coin.change10m, ageH: (now.getTime() - m.coin.launchedAt.getTime()) / 3_600_000, curve: m.coin.curveProgress, creator: null, mine: false } } : null;
    if (fact) {
      const up = (fact.real?.changeH1 ?? fact.world?.change1h ?? 0) >= 0;
      const cast = await Promise.all(speakers.slice(0, 3).map(async (x, i) => {
        const pb = await phrasebookOf(d.db, x.id);
        return { username: x.username, voice: voiceOf(x.voice || pb.voice, x.traits, pb), bull: i === 0 ? up : i === 1 ? !up : d.rng() < 0.5 };
      }));
      const lines = debate(fact, cast, d.rng);
      const messages: PlannedMessage[] = lines.map((l, i) => ({ speakerId: speakers[Math.min(l.who, speakers.length - 1)]!.id, text: l.text, replyTo: i ? i - 1 : null, action: null }));
      if (messages.length >= 2) return { title: templateTitle(m).replace(/\$[A-Z0-9]+|the market/, fact.real ? `$${fact.real.symbol}` : (m.coin ? `$${m.coin.symbol}` : 'the market')), messages, affinity: [] };
    }
  }
  const affm = await affinityMap(d.db, [...speakers.map((x) => x.id), ...(m.subject ? [m.subject.id] : [])]);
  const hostileToSubject = m.subject ? aff(affm, speakers[0]!.id, m.subject.id) < 0 : false;
  const steps = plan(m.idea.kind, speakers.length, (m.coin?.change1h ?? 0) >= 0, hostileToSubject);
  // Lines already on the feed are not said again (the duplicate-post rule).
  const seen = new Set((await d.db.select({ body: posts.body }).from(posts).where(isNull(posts.deletedAt)).orderBy(desc(posts.id)).limit(60)).map((p) => normalizeBody(p.body)));
  const messages: PlannedMessage[] = [];
  const want = 3 + Math.floor(d.rng() * 3);
  for (const s of steps) {
    if (messages.length >= want) break;
    const speaker = speakers[Math.min(s.who, speakers.length - 1)]!;
    const target = s.at === 'subject' ? m.subject : s.at === null ? null : speakers[Math.min(s.at, speakers.length - 1)];
    if (target && target.id === speaker.id) continue;
    const pb = await phrasebookOf(d.db, speaker.id);
    const slots = { ...base, ...(target ? { user: `@${target.username}` } : {}) };
    let line: string | null = null;
    for (const situation of s.try) {
      const r = composeLine(pb, situation, slots, [], d.rng, seen);
      if (r) { line = r.text; seen.add(normalizeBody(r.text)); break; }
    }
    if (!line) continue;
    messages.push({ speakerId: speaker.id, text: line, replyTo: messages.length ? messages.length - 1 : null, action: null });
  }
  // A ghost with a grudge haunts the end of the thread with one line.
  const ghost = m.members.find((x) => x.ghost);
  if (ghost && messages.length) {
    const r = composeLine(await phrasebookOf(d.db, ghost.id), 'ghost', base, [], d.rng, seen);
    if (r) messages.push({ speakerId: ghost.id, text: r.text, replyTo: messages.length - 1, action: null });
  }
  if (messages.length < 2 || new Set(messages.map((x) => x.speakerId)).size < 2) return null;
  const warm = m.idea.kind === 'alliance' || m.idea.kind === 'faction' || m.idea.kind === 'welcome' ? 0.05 : m.idea.kind === 'feud' || m.idea.kind === 'rug' ? -0.05 : 0;
  const affinity: PlannedAffinity[] = warm ? speakers.flatMap((a) => speakers.filter((b) => b.id !== a.id).map((b) => ({ fromId: a.id, toId: b.id, delta: warm }))) : [];
  return { title: templateTitle(m), messages, affinity };
}
