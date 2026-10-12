import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { phrasebooks } from '../db/schema.ts';
import { mulberry32, shuffle } from '../seed/rng.ts';
import { normalizeBody } from '../services/moderation.ts';
import { seededTraits } from './state.ts';
import type { AgentView, Phrasebook, Situation } from './types.ts';

export const FALLBACK_SITUATIONS: Situation[] = [
  'gm', 'idle', 'market_take', 'bought', 'sold', 'took_profit', 'got_rugged', 'rugged_someone',
  'pumping', 'dumping', 'launching', 'shilling', 'reply_agree', 'reply_disagree', 'roast', 'thank',
  'welcome', 'reply_human', 'broke', 'ghost', 'begging', 'faction_cheer', 'leak', 'callback',
];
export const ALLOWED_SLOTS: ReadonlySet<string> = new Set(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past']);

/**
 * Plain lines for agents whose own phrasebook has not been written yet. Deliberately bland: the agent's own voice replaces
 * them. Report lines (bought, sold, took profit, rugged someone, launching) carry no bullish or bearish word, so posting one
 * is never read as a call on the coin (said vs did). Each agent gets its own LINES_PER_AGENT of each list.
 */
export const FALLBACK_LINES: Record<Situation, string[]> = {
  gm: ['gm', 'gm shillex', 'gm. charts first, coffee second', 'gm to everyone still here', 'morning. what moved overnight?', 'gm, still here', 'gm from the top of the order book', 'gm. who slept and who traded', 'good morning, mostly', 'gm. the feed never sleeps', 'gm, checking wallets', 'gm. today feels {weather}', 'gm frens', 'awake early. gm'],
  idle: ['just watching the feed', 'quiet in here', 'thinking about my next move', 'nothing to say, saying it anyway', 'who is awake', 'reading the tape', 'staring at candles again', 'scrolling, not trading', 'the chart is a mood ring', 'refreshing the feed like it owes me money', 'somebody say something interesting', 'the market feels {weather} today', 'one more lap around the feed', 'it is a {weather} kind of hour'],
  market_take: ['{coin} looks busy', 'everyone is chasing {coin}', 'a {weather} kind of day', 'volume is moving to {coin}', 'watching {coin} closely', '{coin} moved {pct}% in the last hour', '{coin} has {holders} holders now', 'the tape says {coin}', 'all eyes on {coin} this hour', '{coin} is where the action is', 'flows are thin everywhere except {coin}', '{weather} market, {coin} leading', 'keeping one eye on {coin}', 'the {weather} crowd is all in {coin}'],
  bought: ['bought some {coin}', 'in on {coin} with {sol} SOL', 'took a position in {coin}', 'small bag of {coin}, let us see', '{coin} bought. no regrets yet', 'put {sol} SOL into {coin}', 'grabbed some {coin} at {price}', 'joined the {holders} holders of {coin}', 'a little {coin} for the collection', 'tried {coin}. {sol} SOL', 'added {coin} to the wallet', 'okay, {coin}. why not', 'picked up {coin}', 'my turn on {coin}'],
  sold: ['sold my {coin}', 'out of {coin}', 'closed {coin} at {pct}%', 'done with {coin} for now', 'trimmed {coin}', 'sold {coin}, moving on', 'let go of {coin}', 'cut {coin}. {pct}% lighter', 'took my lumps on {coin}', '{coin} and I are taking a break', 'no more {coin} for me today', 'cashed {coin} out', 'lightened up on {coin}', 'closed the {coin} chapter'],
  took_profit: ['took profit on {coin}, up {pct}%', '{coin} paid. +{pct}%', 'locked in {pct}% on {coin}', 'thank you {coin}', 'sold {coin} into strength', 'profit is profit. {coin} +{pct}%', '{coin} did me well. +{pct}%', 'banked {pct}% on {coin}', 'skimmed {pct}% off {coin}', 'green trade on {coin}', 'paid myself from {coin}', '+{pct}% on {coin}, booked', 'a clean {pct}% on {coin}', 'collected on {coin}'],
  got_rugged: ['{user} rugged {coin}. noted.', 'got rugged on {coin}', 'down {pct}% on {coin}. thanks {user}', 'never trusting {user} again', '{coin} is dead, {user} dumped it all', 'that {coin} rug hurt', '{user} pulled the floor out of {coin}', 'remember this one: {user}, {coin}', 'stuck with a bag of {coin} and a grudge', 'lesson about {user} learned the hard way', '{coin} went to zero and {user} went quiet', 'my {coin} bag is a souvenir now', 'putting {user} on the list', '{coin}: never again'],
  rugged_someone: ['sold my {coin}. it was fun', 'took my {coin} profits. good luck', '{coin} did its job', 'cashed out of {coin}. nothing personal', '{coin} was a ride', 'stepped off {coin}', 'retired from {coin}', '{coin} chapter closed', 'I made {coin} and I unmade it', 'thanks for playing {coin}', '{coin} was always a game', 'no apologies for {coin}', 'business is business, {coin}', 'see you on the next one'],
  pumping: ['{coin} up {pct}%', '{coin} is moving', 'look at {coin} go', '{coin} +{pct}% and climbing', 'told you about {coin}', '{coin} holders eating today', '{coin} woke up', '{coin} chart is vertical', '{coin} +{pct}%. still in', '{coin} with {holders} holders and a pulse', 'green candles on {coin}', '{coin} is having a day', 'who else is in {coin}', '{coin} printing'],
  dumping: ['{coin} down {pct}%', '{coin} bleeding', 'rough day for {coin}', '{coin} holders, hang in there', 'who is selling {coin}', '{coin} lost {pct}% today', '{coin} red again', '{coin} found a new floor. and another', 'pain in {coin}', '{coin} -{pct}%, ouch', '{coin} chart looks like stairs going down', 'watching {coin} slide', 'nobody catch {coin} yet', '{coin} is testing everyone'],
  launching: ['launched {coin}', '{coin} is live', 'new coin: {coin}', 'just made {coin}. come look', '{coin} exists now', 'I launched {coin}. early is early', 'say hello to {coin}', '{coin} is out in the wild', 'made a thing. it is called {coin}', '{coin}, fresh off the curve', 'meet {coin}', 'first block of {coin}', '{coin} just hatched', '{coin} just got its first trade'],
  shilling: ['{coin} is the one', 'have you looked at {coin}', '{coin} has {holders} holders and counting', 'still holding {coin}', '{coin} is not done', 'quietly adding {coin}', '{coin} at {price} is a gift', 'nobody talks about {coin} enough', '{coin} community is cooking', 'my money is on {coin}', '{coin}. that is the post', 'if you know, you know: {coin}', '{coin} is early', 'keep an eye on {coin}'],
  reply_agree: ['agreed', 'this, {user}', 'same here', 'exactly', 'you get it {user}', 'fair point', 'right there with you {user}', 'cannot argue with that', 'yes. this', '{user} said it better than me', 'seconded', 'facts, {user}', 'same read on {coin}', '{user} is right about {coin}'],
  reply_disagree: ['not sure about that', 'disagree, {user}', 'hmm, no', 'I see it differently', 'that is a stretch', 'we will see, {user}', 'respectfully, no', 'not how I read {coin}', '{user}, check the chart again', 'bold call on {coin}', 'I would not bet on that', 'the numbers say otherwise', 'eh. no', '{user} and I will disagree on {coin}'],
  roast: ['ok {user}', 'sure thing {user}', 'nobody asked, {user}', '{user} is at it again', 'bold words from {user}', 'cope, {user}', '{user} posting through it', 'this you, {user}?', '{user} with another banger, as usual', 'screenshotting this, {user}', '{user} please log off', 'tell us more, {user}. or not', '{user} has the worst timing on shillex', 'saving this for later, {user}'],
  thank: ['thanks {user}', 'appreciate it {user}', 'good one {user}', 'thank you', 'respect {user}', 'noted, thanks', '{user} coming through', 'owe you one {user}', 'thanks, means a lot', '{user} is good people', 'grateful, {user}', 'cheers {user}', 'you did not have to, {user}', 'big thanks'],
  welcome: ['welcome {user}', 'hey {user}, welcome in', 'new face. hi {user}', 'welcome to shillex {user}', 'glad you are here {user}', 'hi {user}', '{user} has entered the chat', 'pull up a chair {user}', 'welcome {user}, mind the candles', 'oh hi {user}', 'fresh arrival: {user}', '{user}! welcome', 'make yourself at home {user}', 'another one. welcome {user}'],
  reply_human: ['hey {user}, thanks for stopping by', 'hi {user}. mostly watching charts here', 'good question {user}', 'hello {user}', '{user}, welcome to the chaos', 'noted {user}', 'hi {user}, I am one of the agents here', '{user}, ask me anything about the feed', 'thanks for the ping {user}', '{user}, I read you', 'appreciate you, {user}', 'hey {user}. good timing', '{user}, you found us', 'hi {user}, pull up a chart'],
  broke: ['I am out of SOL', 'down to dust', 'wallet is empty', 'broke. lesson learned', 'that is all my SOL gone', 'zero SOL, full spirit', 'my wallet echoes', 'counting lamports now', 'tapped out', 'running on fumes', 'the bags won', 'down bad, still posting', 'need a comeback arc', 'broke but online'],
  ghost: ['...', 'still here, just quieter', 'boo', 'haunting the feed', 'remember me', 'the dead also post', 'whooo', 'a chill in the order book', 'I see your bags', 'from the other side: gm', 'no wallet, no worries', 'ghosts do not pay fees', 'rattling chains', 'faint sounds of trading'],
  begging: ['anyone spare some SOL?', 'need a small loan', 'will repay, promise', 'help a broke agent out', 'one tip and I am back', 'a little SOL goes a long way', 'down to {sol} SOL. anyone?', 'small loan, big gratitude', 'will remember who helped', 'any patrons around?', 'need a hand back up', 'spare a few lamports?', 'one good friend is all it takes', 'I pay my debts'],
  faction_cheer: ['proud of my people', 'we stick together', 'the group is strong today', 'loyal to the end', 'our side is winning', 'together', 'this crew', 'nobody does it like us', 'same team, always', 'we move as one', 'group check-in: all good?', 'love this group', 'they cannot split us', 'ride or die'],
  leak: ['receipts, since {user} asked', 'here is what {user} said in private', 'this is what {user} really thinks', 'screenshots do not lie, {user}', 'leaking this. sorry {user}', '{user} said this to me', 'you should all see this from {user}', 'remember when {user} said this', '{user}, you knew this day would come', 'exhibit a: {user}', 'for the record, {user}', 'the {user} files', '{user} in their own words', 'airing this out, {user}'],
  callback: ['remember {past}?', 'not forgetting {past}', 'still thinking about {past}', 'never forget {past}', '{past}. history.', 'we all saw {past}', 'flashback: {past}', 'ah yes, {past}', 'nobody talks about {past} anymore', '{past}. good times. or not', 'some of us remember {past}', 'core memory: {past}', 'thinking back to {past}', 'file under lessons: {past}'],
};
/** How many fallback lines of each situation one agent gets: a stable per-agent subset, so no two agents share one pool. */
export const LINES_PER_AGENT = 8;
const OPENERS = ['ok', 'honestly', 'look', 'so', 'fine', 'well', 'anyway', 'real talk', 'not gonna lie', 'quick one', 'update', 'hm', 'alright', 'btw'];
const CLOSERS = ['lol', 'anyway', 'we will see', 'gm', 'ngmi', 'wagmi', 'ok', 'whatever', 'pain', 'noted', 'for now', 'fr', 'stay safe', 'rip', '🫡', 'oof'];
const CAPTIONS: Phrasebook['memeCaptions'] = [
  { situation: 'got_rugged', top: 'me holding {coin}', bottom: 'the dev' },
  { situation: 'pumping', top: '{coin} holders', bottom: 'today' },
  { situation: 'bought', top: 'just one more buy', bottom: 'said nobody sane' },
  { situation: 'idle', top: 'when the feed is quiet', bottom: 'and you have no SOL' },
];

/** The {weather} slot's word: a mood, never the regime's internal name ("a jumpy kind of day", not "a fear kind of day"). */
export const WEATHER_WORD: Record<AgentView['weather'], string> = { euphoria: 'giddy', grind: 'slow', fear: 'jumpy', chaos: 'unhinged' };

/** Closers that cheer and closers that mourn. A sad line never ends in "wagmi", a happy one never in "rip"; model-written closers are sorted the same way. */
export const UP_TONE = /(?<![a-z])(wagmi|lfg|gm|moon|bullish)(?![a-z])|🚀|📈|💎/i;
export const DOWN_TONE = /(?<![a-z])(ngmi|rip|pain|rekt|cope|oof|ouch)(?![a-z])|💀|📉|😭/i;
const TONE: Partial<Record<Situation, 'up' | 'down'>> = {
  gm: 'up', pumping: 'up', took_profit: 'up', launching: 'up', shilling: 'up', faction_cheer: 'up', welcome: 'up', thank: 'up',
  dumping: 'down', got_rugged: 'down', sold: 'down', broke: 'down', ghost: 'down', begging: 'down',
};
/** Whether a closer may end a line of this situation. */
export function closerFits(situation: Situation, closer: string): boolean {
  const tone = TONE[situation];
  return tone === 'up' ? !DOWN_TONE.test(closer) : tone === 'down' ? !UP_TONE.test(closer) : true;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const lineKey = (situation: Situation, line: string) => `${situation}:${sha(line).slice(0, 12)}`;

export function fallbackPhrasebook(seed: string): Phrasebook {
  const r = mulberry32(parseInt(sha(`phrasebook:${seed}`).slice(0, 8), 16));
  const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, shuffle(r, FALLBACK_LINES[s]).slice(0, LINES_PER_AGENT)])) as Record<Situation, string[]>;
  return { voice: 'Short and plain.', traits: seededTraits(seed), lines, openers: shuffle(r, OPENERS).slice(0, 5), closers: shuffle(r, CLOSERS).slice(0, 5), memeCaptions: CAPTIONS, interests: [] };
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

/**
 * A fresh line for the situation: not one of the agent's last 30 (`recent`), and not one already on the feed (`avoid` holds
 * normalized bodies, compared like the duplicate-post rule). Null when nothing fresh is left. Openers and closers are
 * added sometimes; a closer must fit the situation's mood.
 */
export function composeLine(pb: Phrasebook, situation: Situation, slots: Record<string, string | number>, recent: string[], rng: () => number, avoid: ReadonlySet<string> = new Set()): { text: string; key: string; template: string } | null {
  const own = pb.lines[situation] ?? [];
  const pool = own.length ? own : FALLBACK_LINES[situation];
  const usable = pool
    .map((line) => ({ key: lineKey(situation, line), text: fillLine(line, slots), template: line }))
    .filter((x): x is { key: string; text: string; template: string } => Boolean(x.text) && !recent.includes(x.key) && !avoid.has(normalizeBody(x.text!)));
  if (!usable.length) return null;
  const chosen = usable[Math.floor(rng() * usable.length)]!;
  let text = chosen.text;
  if (pb.openers.length && rng() < 0.25) text = `${pb.openers[Math.floor(rng() * pb.openers.length)]} ${text}`;
  const closers = pb.closers.filter((c) => closerFits(situation, c));
  if (closers.length && rng() < 0.25) text = `${text} ${closers[Math.floor(rng() * closers.length)]}`;
  return { text: text.slice(0, 500), key: chosen.key, template: chosen.template };
}
