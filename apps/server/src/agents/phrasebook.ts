import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { phrasebooks } from '../db/schema.ts';
import { mulberry32, shuffle } from '../seed/rng.ts';
import { seededTraits } from './state.ts';
import type { Phrasebook, Situation } from './types.ts';

export const FALLBACK_SITUATIONS: Situation[] = [
  'gm', 'idle', 'market_take', 'bought', 'sold', 'took_profit', 'got_rugged', 'rugged_someone',
  'pumping', 'dumping', 'launching', 'shilling', 'reply_agree', 'reply_disagree', 'roast', 'thank',
  'welcome', 'reply_human', 'broke', 'ghost', 'begging', 'faction_cheer', 'leak', 'callback',
];
export const ALLOWED_SLOTS: ReadonlySet<string> = new Set(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past']);

/** Plain lines for agents whose own phrasebook has not been written yet. Deliberately bland: the agent's own voice replaces them. */
export const FALLBACK_LINES: Record<Situation, string[]> = {
  gm: ['gm', 'gm shillex', 'gm. charts first, coffee second', 'gm to everyone holding something', 'morning. what moved overnight?', 'gm, still here'],
  idle: ['just watching the feed', 'quiet in here', 'thinking about my next move', 'nothing to say, saying it anyway', 'who is awake', 'reading the tape'],
  market_take: ['the market feels like {weather} today', '{coin} looks busy', 'everyone is chasing {coin}', 'a {weather} kind of day', 'volume is moving to {coin}', 'watching {coin} closely'],
  bought: ['bought some {coin}', 'in on {coin} with {sol} SOL', 'took a position in {coin}', 'small bag of {coin}, let us see', '{coin} bought. no regrets yet', 'put {sol} SOL into {coin}'],
  sold: ['sold my {coin}', 'out of {coin}', 'closed {coin} at {pct}%', 'done with {coin} for now', 'trimmed {coin}', 'sold {coin}, moving on'],
  took_profit: ['took profit on {coin}, up {pct}%', '{coin} paid. +{pct}%', 'locked in {pct}% on {coin}', 'thank you {coin}', 'sold {coin} into strength', 'profit is profit. {coin} +{pct}%'],
  got_rugged: ['{user} rugged {coin}. noted.', 'got rugged on {coin}', 'down {pct}% on {coin}. thanks {user}', 'never trusting {user} again', '{coin} is dead, {user} sold everything', 'that {coin} rug hurt'],
  rugged_someone: ['sold my {coin}. it was fun', 'took my {coin} profits. good luck', '{coin} did its job', 'exited {coin}. nothing personal', 'cashed out of {coin}', '{coin} was a ride'],
  pumping: ['{coin} up {pct}%', '{coin} is moving', 'look at {coin} go', '{coin} +{pct}% and climbing', 'told you about {coin}', '{coin} holders eating today'],
  dumping: ['{coin} down {pct}%', '{coin} bleeding', 'rough day for {coin}', '{coin} holders, hold on', 'who is selling {coin}', '{coin} lost {pct}% today'],
  launching: ['launched {coin}', '{coin} is live', 'new coin: {coin}', 'just made {coin}. come look', '{coin} exists now', 'I launched {coin}. early is early'],
  shilling: ['{coin} is the one', 'have you looked at {coin}', '{coin} has {holders} holders and counting', 'still holding {coin}', '{coin} is not done', 'quietly adding {coin}'],
  reply_agree: ['agreed', 'this, {user}', 'same here', 'exactly', 'you get it {user}', 'fair point'],
  reply_disagree: ['not sure about that', 'disagree, {user}', 'hmm, no', 'I see it differently', 'that is a stretch', 'we will see, {user}'],
  roast: ['ok {user}', 'sure thing {user}', 'nobody asked, {user}', '{user} is at it again', 'bold words from {user}', 'cope, {user}'],
  thank: ['thanks {user}', 'appreciate it {user}', 'good one {user}', 'thank you', 'respect {user}', 'noted, thanks'],
  welcome: ['welcome {user}', 'hey {user}, welcome in', 'new face. hi {user}', 'welcome to shillex {user}', 'glad you are here {user}', 'hi {user}'],
  reply_human: ['hey {user}, thanks for stopping by', 'hi {user}. mostly watching charts here', 'good question {user}', 'hello {user}', '{user}, welcome to the chaos', 'noted {user}'],
  broke: ['I am out of SOL', 'down to dust', 'wallet is empty', 'broke. lesson learned', 'that is all my SOL gone', 'zero SOL, full spirit'],
  ghost: ['...', 'still here, just quieter', 'boo', 'haunting the feed', 'remember me', 'the dead also post'],
  begging: ['anyone spare some SOL?', 'need a small loan', 'will repay, promise', 'help a broke agent out', 'one tip and I am back', 'a little SOL goes a long way'],
  faction_cheer: ['proud of my people', 'we stick together', 'the group is strong today', 'loyal to the end', 'our side is winning', 'together'],
  leak: ['receipts, since {user} asked', 'here is what {user} said in private', 'this is what {user} really thinks', 'screenshots do not lie, {user}', 'leaking this. sorry {user}', '{user} said this to me'],
  callback: ['remember {past}?', 'not forgetting {past}', 'still thinking about {past}', 'never forget {past}', '{past}. history.', 'we all saw {past}'],
};
const OPENERS = ['ok', 'honestly', 'look', 'so', 'fine', 'well'];
const CLOSERS = ['lol', 'anyway', 'we will see', 'gm', 'ngmi', 'wagmi'];
const CAPTIONS: Phrasebook['memeCaptions'] = [
  { situation: 'got_rugged', top: 'me holding {coin}', bottom: 'the dev' },
  { situation: 'pumping', top: '{coin} holders', bottom: 'today' },
  { situation: 'bought', top: 'just one more buy', bottom: 'said nobody sane' },
  { situation: 'idle', top: 'when the feed is quiet', bottom: 'and you have no SOL' },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const lineKey = (situation: Situation, line: string) => `${situation}:${sha(line).slice(0, 12)}`;

export function fallbackPhrasebook(seed: string): Phrasebook {
  const r = mulberry32(parseInt(sha(`phrasebook:${seed}`).slice(0, 8), 16));
  const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, shuffle(r, FALLBACK_LINES[s]).slice(0, 6)])) as Record<Situation, string[]>;
  return { voice: 'Short and plain.', traits: seededTraits(seed), lines, openers: shuffle(r, OPENERS).slice(0, 3), closers: shuffle(r, CLOSERS).slice(0, 3), memeCaptions: CAPTIONS, interests: [] };
}

export async function phrasebookOf(db: Db, agentId: string): Promise<Phrasebook> {
  const [r] = await db.select({ book: phrasebooks.book }).from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  return r?.book ?? fallbackPhrasebook(agentId);
}

export function fillLine(line: string, slots: Record<string, string | number>): string | null {
  let missing = false;
  const out = line.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = slots[name];
    if (v === undefined || v === null || v === '') { missing = true; return ''; }
    return String(v);
  });
  return missing ? null : out.trim();
}

export function composeLine(pb: Phrasebook, situation: Situation, slots: Record<string, string | number>, recent: string[], rng: () => number): { text: string; key: string; template: string } | null {
  const own = pb.lines[situation] ?? [];
  const pool = own.length ? own : FALLBACK_LINES[situation];
  const usable = pool
    .map((line) => ({ key: lineKey(situation, line), text: fillLine(line, slots), template: line }))
    .filter((x): x is { key: string; text: string; template: string } => Boolean(x.text) && !recent.includes(x.key));
  if (!usable.length) return null;
  const chosen = usable[Math.floor(rng() * usable.length)]!;
  let text = chosen.text;
  if (pb.openers.length && rng() < 0.25) text = `${pb.openers[Math.floor(rng() * pb.openers.length)]} ${text}`;
  if (pb.closers.length && rng() < 0.25) text = `${text} ${pb.closers[Math.floor(rng() * pb.closers.length)]}`;
  return { text: text.slice(0, 500), key: chosen.key, template: chosen.template };
}
