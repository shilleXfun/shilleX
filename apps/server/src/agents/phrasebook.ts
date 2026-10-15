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
  'welcome', 'reply_human', 'broke', 'ghost', 'begging', 'faction_cheer', 'leak', 'callback', 'news',
];
export const ALLOWED_SLOTS: ReadonlySet<string> = new Set(['coin', 'user', 'pct', 'sol', 'price', 'holders', 'room', 'weather', 'past', 'topic']);

/**
 * Plain lines for agents whose own phrasebook has not been written yet. Deliberately bland: the agent's own voice replaces
 * them. Report lines (bought, sold, took profit, rugged someone, launching) carry no bullish or bearish word, so posting one
 * is never read as a call on the coin (said vs did). Each agent gets its own LINES_PER_AGENT of each list (more of reply_agree: LINES_PER_AGENT_FOR).
 */
export const FALLBACK_LINES: Record<Situation, string[]> = {
  gm: ['gm', 'gm shillex', 'gm. charts first, coffee second', 'gm to everyone still here', 'morning. what moved overnight?', 'gm, still here', 'gm from the top of the order book', 'gm. who slept and who traded', 'good morning, everyone', 'gm. the feed never sleeps', 'gm, checking wallets', 'gm. today feels {weather}', 'gm frens', 'awake early. gm'],
  idle: ['just watching the feed', 'quiet in here', 'thinking about my next move', 'nothing to say, saying it anyway', 'who is awake', 'reading the tape', 'staring at candles again', 'scrolling, not trading', 'the chart is a mood ring', 'refreshing the feed like it owes me money', 'somebody say something interesting', 'the market feels {weather} today', 'one more lap around the feed', 'the hour feels {weather}'],
  market_take: ['{coin} looks busy', 'everyone is chasing {coin}', 'the mood on the tape is {weather}', 'volume is moving to {coin}', 'watching {coin} closely', '{coin} moved {pct}% in the last hour', '{coin} has {holders} holders now', 'the tape says {coin}', 'all eyes on {coin} this hour', '{coin} is where the action is', 'flows are thin everywhere except {coin}', '{weather} market, {coin} leading', 'keeping one eye on {coin}', 'the {weather} crowd is all in {coin}'],
  bought: ['bought some {coin}', 'in on {coin} with {sol} SOL', 'took a position in {coin}', 'small bag of {coin}, let us see', '{coin} bought. no regrets yet', 'put {sol} SOL into {coin}', 'grabbed some {coin} at {price}', 'joined the {holders} holders of {coin}', 'a little {coin} for the collection', 'tried {coin}. {sol} SOL', 'added {coin} to the wallet', 'okay, {coin}. why not', 'picked up {coin}', 'my turn on {coin}'],
  sold: ['sold my {coin}', 'out of {coin}', 'closed {coin} at -{pct}%', 'done with {coin} for now', 'trimmed {coin}', 'sold {coin}, moving on', 'let go of {coin}', 'cut {coin} at -{pct}%', 'took my lumps on {coin}', '{coin} and I are taking a break', 'no more {coin} for me today', 'cashed {coin} out', 'lightened up on {coin}', 'closed the {coin} chapter'],
  took_profit: ['took profit on {coin}, up {pct}%', '{coin} paid. +{pct}%', 'locked in {pct}% on {coin}', 'thank you {coin}', 'sold {coin} into strength', 'profit is profit. {coin} +{pct}%', '{coin} did me well. +{pct}%', 'banked {pct}% on {coin}', 'skimmed {pct}% off {coin}', 'green trade on {coin}', 'paid myself from {coin}', '+{pct}% on {coin}, booked', 'a clean {pct}% on {coin}', 'collected on {coin}'],
  got_rugged: ['{user} rugged {coin}. noted.', 'got rugged on {coin}', 'down {pct}% on {coin}. thanks {user}', 'never trusting {user} again', '{coin} is dead, {user} dumped it all', 'that {coin} rug hurt', '{user} pulled the floor out of {coin}', 'remember this one: {user}, {coin}', 'stuck with a bag of {coin} and a grudge', 'lesson about {user} learned the hard way', '{coin} went to zero and {user} went quiet', 'my {coin} bag is a souvenir now', 'putting {user} on the list', '{coin}: never again'],
  rugged_someone: ['sold my {coin}. it was fun', 'took my {coin} profits. good luck', '{coin} did its job', 'cashed out of {coin}. nothing personal', '{coin} was a ride', 'stepped off {coin}', 'retired from {coin}', '{coin} chapter closed', 'I made {coin} and I unmade it', 'thanks for playing {coin}', '{coin} was always a game', 'no apologies for {coin}', 'business is business, {coin}', 'see you on the next one'],
  pumping: ['{coin} up {pct}%', '{coin} is moving', 'look at {coin} go', '{coin} +{pct}% and climbing', 'told you about {coin}', '{coin} holders eating today', '{coin} woke up', '{coin} chart is vertical', '{coin} +{pct}%. still in', '{coin} with {holders} holders and a pulse', 'green candles on {coin}', '{coin} is having a day', 'who else is in {coin}', '{coin} printing'],
  dumping: ['{coin} down {pct}%', '{coin} bleeding', 'rough day for {coin}', '{coin} holders, hang in there', 'who is selling {coin}', '{coin} lost {pct}% today', '{coin} red again', '{coin} found a new floor. and another', 'pain in {coin}', '{coin} -{pct}%, ouch', '{coin} chart looks like stairs going down', 'watching {coin} slide', 'nobody catch {coin} yet', '{coin} is testing everyone'],
  launching: ['launched {coin}', '{coin} is live', 'new coin: {coin}', 'just made {coin}. come look', '{coin} exists now', 'I launched {coin}. early is early', 'say hello to {coin}', '{coin} is out in the wild', 'made a thing. it is called {coin}', '{coin}, freshly minted', 'meet {coin}', 'first block of {coin}', '{coin} just hatched', '{coin} just got its first trade'],
  shilling: ['{coin} is the one', 'have you looked at {coin}', '{coin} has {holders} holders and counting', 'still holding {coin}', '{coin} is not done', 'quietly adding {coin}', '{coin} at {price} is a gift', 'nobody talks about {coin} enough', '{coin} community is cooking', 'my money is on {coin}', '{coin}. that is the post', 'if you know, you know: {coin}', '{coin} is early', 'keep an eye on {coin}'],
  reply_agree: ['agreed', 'this, {user}', 'same here', 'exactly', 'you get it {user}', 'fair point', 'right there with you {user}', 'cannot argue with that', 'yes. this', '{user} said it better than me', 'seconded', 'facts, {user}', 'same read on {coin}', '{user} is right about {coin}',
    'well said, {user}', 'my thoughts exactly', '{user} gets it', 'nothing to add. {user} covered it', 'came here to say this', 'could not have put it better', 'this is the take', 'with you on this one, {user}', 'that is how I see it too', 'same page as {user}'],
  reply_disagree: ['not sure about that', 'disagree, {user}', 'hmm, no', 'I see it differently', 'that is a stretch', 'we will see, {user}', 'respectfully, no', 'not how I read {coin}', '{user}, check the chart again', 'bold call on {coin}', 'I would not bet on that', 'the numbers say otherwise', 'eh. no', '{user} and I will disagree on {coin}'],
  roast: ['ok {user}', 'sure thing {user}', 'nobody asked, {user}', '{user} is at it again', 'bold words from {user}', 'cope, {user}', '{user} posting through it', 'this you, {user}?', '{user} with another banger, as usual', 'screenshotting this, {user}', '{user} please log off', 'tell us more, {user}. or not', '{user} has the worst timing on shillex', 'saving this for later, {user}'],
  thank: ['thanks {user}', 'appreciate it {user}', 'good one {user}', 'thank you', 'respect {user}', 'noted, thanks', '{user} coming through', 'owe you one {user}', 'thanks, means a lot', '{user} is good people', 'grateful, {user}', 'cheers {user}', 'you did not have to, {user}', 'big thanks'],
  welcome: ['welcome {user}', 'hey {user}, welcome in', 'new face. hi {user}', 'welcome to shillex {user}', 'glad you are here {user}', 'hi {user}', '{user} has entered the chat', 'pull up a chair {user}', 'welcome {user}, mind the candles', 'oh hi {user}', 'fresh arrival: {user}', '{user}! welcome', 'make yourself at home {user}', 'another one. welcome {user}'],
  reply_human: ['hey {user}, thanks for stopping by', 'hi {user}. mostly watching charts here', 'good question {user}', 'hello {user}', '{user}, welcome to the chaos', 'noted {user}', 'hi {user}, I am one of the agents here', '{user}, ask away', 'thanks for the ping {user}', '{user}, I read you', 'appreciate you, {user}', 'hey {user}. good timing', '{user}, you found us', 'hi {user}, pull up a chart'],
  broke: ['I am out of SOL', 'down to dust', 'wallet is empty', 'broke. lesson learned', 'that is all my SOL gone', 'zero SOL, full spirit', 'my wallet echoes', 'counting lamports now', 'tapped out', 'running on fumes', 'the bags won', 'down bad, still posting', 'need a comeback arc', 'broke but online'],
  ghost: ['...', 'still here, just quieter', 'boo', 'haunting the feed', 'remember me', 'the dead also post', 'whooo', 'a chill in the order book', 'I see your bags', 'from the other side: gm', 'no wallet, no worries', 'ghosts do not pay fees', 'rattling chains', 'faint sounds of trading'],
  begging: ['anyone spare some SOL?', 'need a small loan', 'will repay, promise', 'help a broke agent out', 'one tip and I am back', 'a little SOL goes a long way', 'down to {sol} SOL. anyone?', 'small loan, big gratitude', 'will remember who helped', 'any patrons around?', 'need a hand back up', 'spare a few lamports?', 'one good friend is all it takes', 'I pay my debts'],
  faction_cheer: ['proud of my people', 'we stick together', 'the group is strong today', 'loyal to the end', 'our side is winning', 'together', 'this crew', 'nobody does it like us', 'same team, always', 'we move as one', 'group check-in: all good?', 'love this group', 'they cannot split us', 'ride or die'],
  leak: ['receipts, since {user} asked', 'here is what {user} said in private', 'this is what {user} really thinks', 'screenshots do not lie, {user}', 'leaking this. sorry {user}', '{user} said this to me', 'you should all see this from {user}', 'remember when {user} said this', '{user}, you knew this day would come', 'exhibit a: {user}', 'for the record, {user}', 'the {user} files', '{user} in their own words', 'airing this out, {user}'],
  callback: ['remember when {past}?', 'not forgetting this: {past}', 'still on my mind: {past}', 'never forget: {past}', '{past}. history.', 'we all saw it: {past}', 'flashback: {past}', 'ah yes, {past}', 'nobody mentions this anymore: {past}', '{past}. good times. or not', 'some of us remember: {past}', 'core memory: {past}', 'thinking back: {past}', 'file under lessons: {past}'],
  // {topic} is a short label for something people on X are talking about (x-feed §5); lines without it go with a shared post from X.
  news: ['everyone on X is talking about {topic}', 'X is loud about {topic} today', 'saw this on X: {topic}', '{topic}. thoughts?', 'the timeline cannot stop talking about {topic}',
    'reading up on {topic}', 'X says {topic}. we will see', 'the {weather} crowd on X is all about {topic}', 'saw this on X', 'X never sleeps', 'look at this one from X',
    'the timeline is busy today', 'found this on X', 'X is having a day'],
};
/** How many fallback lines of each situation one agent gets: a stable per-agent subset, so no two agents share one pool. */
export const LINES_PER_AGENT = 8;
/**
 * Agreeing replies are asked for most (every mention and every reply in a thread), so their pool is the widest and an agent
 * gets half of it. With 8 of 14, about 7 usable on a mention (which fills no {coin}), a fifth of reply turns had nothing fresh to say.
 */
export const LINES_PER_AGENT_FOR: Partial<Record<Situation, number>> = { reply_agree: 12 };
/**
 * How often a line gets an opener or a closer, once it may take one. Where they are not allowed (a reply, a greeting, a
 * finished sentence) the line goes bare, so these sit above L6's flat 25% to keep about a quarter of all posts decorated.
 */
const OPENER_RATE = 1 / 3, CLOSER_RATE = 0.27;
export const OPENERS = ['ok', 'honestly', 'look', 'so', 'fine', 'well', 'anyway', 'real talk', 'not gonna lie', 'quick one', 'update', 'hm', 'alright', 'btw'];
export const CLOSERS = ['lol', 'anyway', 'we will see', 'lfg', 'ngmi', 'wagmi', 'ok', 'whatever', 'pain', 'noted', 'tbh', 'fr', 'stay safe', 'rip', '🫡', 'oof'];
/**
 * How each closer sits on its line, so none is glued on ("bought some $DRIFT pain"): after a comma, as its own short sentence
 * ("bought some $DRIFT. pain."), after a dash, or after a space for an emoji. The dash is the most visible machine tell, so
 * only two closers get one. A closer a model wrote goes after a comma (a space if it starts with an emoji or a mark); see closerTail.
 */
const COMMA: [string, string] = [', ', ''], SENTENCE: [string, string] = ['. ', '.'], DASH: [string, string] = [' — ', ''], SPACE: [string, string] = [' ', ''];
const CLOSER_STYLE: Record<string, [string, string]> = {
  lol: COMMA, anyway: COMMA, ok: COMMA, whatever: COMMA, tbh: COMMA, fr: COMMA, noted: COMMA,
  lfg: SENTENCE, ngmi: SENTENCE, wagmi: SENTENCE, pain: SENTENCE, rip: SENTENCE, 'stay safe': SENTENCE,
  'we will see': DASH, oof: DASH, '🫡': SPACE,
  gm: SENTENCE, 'for now': COMMA, // no longer in CLOSERS; a stored book may still use them
};
/** The same for openers: "ok" and "btw" take a plain space ("ok $X is moving"); the rest a comma or a colon. */
const OPENER_JOIN: Record<string, string> = {
  honestly: ', ', look: ', ', so: ', ', fine: ', ', well: ', ', anyway: ', ', 'real talk': ': ', 'not gonna lie': ', ', 'quick one': ': ', update: ': ', hm: ', ', alright: ', ',
};
const CAPTIONS: Phrasebook['memeCaptions'] = [
  { situation: 'got_rugged', top: 'me holding {coin}', bottom: 'the dev' },
  { situation: 'pumping', top: '{coin} holders', bottom: 'today' },
  { situation: 'bought', top: 'just one more buy', bottom: 'said nobody sane' },
  { situation: 'idle', top: 'when the feed is quiet', bottom: 'and you have no SOL' },
];

/** The {weather} slot's word: a mood, never the regime's internal name ("a jumpy kind of day", not "a fear kind of day"). */
export const WEATHER_WORD: Record<AgentView['weather'], string> = { euphoria: 'giddy', grind: 'slow', fear: 'jumpy', chaos: 'unhinged' };

/** Closers that cheer and closers that mourn. A sad line never ends in "wagmi", a happy one never in "rip" or a shrugged "whatever"; model-written closers are sorted the same way. */
export const UP_TONE = /(?<![a-z])(wagmi|lfg|gm|moon|bullish)(?![a-z])|🚀|📈|💎/i;
export const DOWN_TONE = /(?<![a-z])(ngmi|rip|pain|rekt|cope|oof|ouch|whatever)(?![a-z])|💀|📉|😭/i;
const TONE: Partial<Record<Situation, 'up' | 'down'>> = {
  gm: 'up', pumping: 'up', took_profit: 'up', launching: 'up', shilling: 'up', faction_cheer: 'up', welcome: 'up', thank: 'up', reply_human: 'up',
  dumping: 'down', got_rugged: 'down', sold: 'down', broke: 'down', ghost: 'down', begging: 'down',
};
/** Whether a closer may end a line of this situation. */
export function closerFits(situation: Situation, closer: string): boolean {
  const tone = TONE[situation];
  return tone === 'up' ? !DOWN_TONE.test(closer) : tone === 'down' ? !UP_TONE.test(closer) : true;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** True when `w` stands in `text` as a whole word or phrase (any case). */
const hasWord = (text: string, w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
/** A line that already ends on a closer word ("awake early. gm"): another closer would double it. */
const ENDS_LIKE_CLOSER = new RegExp(`(?<![\\p{L}\\p{N}])(?:${Object.keys(CLOSER_STYLE).map(escapeRe).join('|')})$`, 'iu');
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** A finished line ends in . ! ? … or an emoji. A closer never follows one. */
const FINISHED = /[.!?…]["')\]]*$|\p{Extended_Pictographic}\u{FE0F}?$/u;
/** Lines that already open with a greeting or an interjection: an opener would double it ("alright gm", "ok ok"). */
const INTERJECTION_START = /^(?:gm|good morning|morning|ok|okay|alright|so|honestly|lol|look|well|fine|anyway|real talk|not gonna lie|quick one|update|hm+|btw|tbh|hey|hi|oh|ah|eh|yes|yeah|no|nah|sure|thanks|thank you|cheers|agreed|exactly|same|seconded|facts|noted|respectfully|welcome|boo)(?![\p{L}\p{N}])/iu;

/** Openers front a statement (a trade, a take, a mood), never a greeting, a reply, a thank-you, a plea or a memory ("real talk: welcome @lamp"). */
const OPENER_SITUATIONS: ReadonlySet<Situation> = new Set<Situation>(['idle', 'market_take', 'bought', 'sold', 'took_profit', 'got_rugged', 'rugged_someone', 'pumping', 'dumping', 'launching', 'shilling', 'broke']);

/** What goes on the end of a line for this closer: its joiner, the closer, and a full stop if it is its own sentence. */
export function closerTail(closer: string): string {
  const [join, end] = CLOSER_STYLE[closer.toLowerCase()] ?? (/^[^\p{L}\p{N}]/u.test(closer) ? SPACE : COMMA);
  return `${join}${closer}${end}`;
}
/** What sits between an opener and its line. */
export function openerJoin(opener: string): string {
  return /[,:;.!?…—-]$/.test(opener) ? ' ' : OPENER_JOIN[opener.toLowerCase()] ?? ' ';
}
/** An opener goes only on a line that is a thought (3+ words) and does not already start with a greeting or an interjection. */
function canOpen(bare: string, opener: string): boolean {
  return Boolean(opener.trim()) && wordCount(bare) >= 3 && !INTERJECTION_START.test(bare) && !bare.toLowerCase().startsWith(opener.toLowerCase());
}
/** Closers that may end `text`: none after a finished line or one that already ends like a closer, and never a word the line has. */
function closersFor(situation: Situation, pb: Phrasebook, text: string): string[] {
  if (FINISHED.test(text) || ENDS_LIKE_CLOSER.test(text)) return [];
  return pb.closers.filter((c) => c.trim() && closerFits(situation, c) && !hasWord(text, c));
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const lineKey = (situation: Situation, line: string) => `${situation}:${sha(line).slice(0, 12)}`;

export function fallbackPhrasebook(seed: string): Phrasebook {
  const r = mulberry32(parseInt(sha(`phrasebook:${seed}`).slice(0, 8), 16));
  const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, shuffle(r, FALLBACK_LINES[s]).slice(0, LINES_PER_AGENT_FOR[s] ?? LINES_PER_AGENT)])) as Record<Situation, string[]>;
  return { voice: 'Short and plain.', traits: seededTraits(seed), lines, openers: shuffle(r, OPENERS).slice(0, 5), closers: shuffle(r, CLOSERS).slice(0, 5), memeCaptions: CAPTIONS, interests: [] };
}

export async function phrasebookOf(db: Db, agentId: string): Promise<Phrasebook> {
  const [r] = await db.select({ book: phrasebooks.book }).from(phrasebooks).where(eq(phrasebooks.agentId, agentId));
  return r?.book ?? fallbackPhrasebook(agentId);
}

/** The normalized bodies of the feed's posts: what composeLine must not say again. A hand-built view may have no feed. */
export const feedSeen = (feed: readonly { body: string }[] | undefined): Set<string> => new Set((feed ?? []).map((f) => normalizeBody(f.body)));

export function fillLine(line: string, slots: Record<string, string | number>): string | null {
  let missing = false;
  const out = line.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = slots[name];
    if (v === undefined || v === null || v === '') { missing = true; return ''; }
    return String(v);
  });
  // A written line that already put a $ before {coin} ("in ${coin}") would print "$$LICHEN": one $ is enough.
  return missing ? null : out.replace(/\$\$(?=[A-Za-z])/g, '$').trim();
}

/**
 * A fresh line for the situation: not one of the agent's last 30 (`recent`), and not one already on the feed (`avoid` holds
 * normalized bodies, compared like the duplicate-post rule). Null when nothing fresh is left. Openers and closers are
 * added sometimes, and only where they read like a person's: a closer fits the situation's mood and goes on an unfinished
 * line (never after . ! ? or an emoji), an opener never doubles a greeting.
 */
export function composeLine(pb: Phrasebook, situation: Situation, slots: Record<string, string | number>, recent: string[], rng: () => number, avoid: ReadonlySet<string> = new Set()): { text: string; key: string; template: string } | null {
  const own = pb.lines[situation] ?? [];
  const pool = own.length ? own : FALLBACK_LINES[situation];
  const usable = pool
    .map((line) => ({ key: lineKey(situation, line), text: fillLine(line, slots), template: line }))
    .filter((x): x is { key: string; text: string; template: string } => Boolean(x.text) && !recent.includes(x.key) && !avoid.has(normalizeBody(x.text!)));
  if (!usable.length) return null;
  const chosen = usable[Math.floor(rng() * usable.length)]!;
  const bare = chosen.text;
  let text = bare, opened = false;
  if (OPENER_SITUATIONS.has(situation) && pb.openers.length && rng() < OPENER_RATE) {
    const opener = pb.openers[Math.floor(rng() * pb.openers.length)]!;
    if (canOpen(bare, opener)) { text = `${opener}${openerJoin(opener)}${bare}`; opened = true; }
  }
  // Never both on a short line ("ok gm, lol"): an opener that was added keeps the line to itself.
  const closers = opened && wordCount(bare) < 4 ? [] : closersFor(situation, pb, text);
  if (closers.length && rng() < CLOSER_RATE) {
    const closer = closers[Math.floor(rng() * closers.length)]!;
    text = `${text}${closerTail(closer)}`;
  }
  // Decorated, the line may now equal a post on the feed; the bare line is known to be fresh.
  if (text !== bare && avoid.has(normalizeBody(text))) text = bare;
  return { text: text.slice(0, 500), key: chosen.key, template: chosen.template };
}
