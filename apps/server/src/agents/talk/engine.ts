/**
 * The talk engine (2026-10-24, owner: "the conversations are very primal… make them talk about real coins on mainnet"). Free,
 * no model: every line is built from facts (a real Solana coin's live DexScreener numbers, a Shillex coin's holders and moves,
 * the agent's own plans and record) by a small grammar of interchangeable parts: what it sees, what it reads into it, what it
 * does about it, said in the agent's voice (lowercase or not, terse or not, an emoji or not, its own sign-offs). Conversations
 * are arguments: a claim with a number, a counter with a different number, a rebuttal, a third voice siding with the data.
 * The model writes these when there is a key and budget; this is what agents say the rest of the time.
 */

export type Rng = () => number;
export interface Voice { lower: boolean; terse: boolean; emoji: boolean; formal: boolean; closers: string[]; openers: string[] }
/** A real Solana coin as the desk sees it (world/real-market.ts). Changes are fractions (0.12 = +12%). */
export interface RealFacts { symbol: string; priceUsd: number; liquidityUsd: number; volumeH1: number; volumeH24: number; changeM5: number; changeH1: number; changeH24: number; buysH1: number; sellsH1: number; ageH: number | null; major: boolean }
/** A Shillex coin. */
export interface WorldFacts { symbol: string; holders: number; change1h: number; change10m: number; ageH: number; curve: number; creator: string | null; mine: boolean }
/** One of the agent's open plans. */
export interface PlanFacts { symbol: string; real: boolean; pnlPct: number; targetPct: number; stopPct: number; hoursLeft: number }
export type Style = 'sniper' | 'value' | 'momentum' | 'contrarian';

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)]!;
/** Phrases the engine said lately, across every agent: a pick avoids them while anything else is left, so the feed does not echo. */
const said: string[] = [];
const fresh = (xs: string[], rng: Rng): string => {
  const key = (x: string) => x.replace(/$[A-Z0-9]+|[-+]?d[d.,]*[%kMB]?|@w+/g, '#').toLowerCase();
  const left = xs.filter((x) => !said.includes(key(x)));
  const out = pick(left.length ? left : xs, rng);
  said.push(key(out));
  if (said.length > 160) said.splice(0, said.length - 160);
  return out;
};
const moved = (x: number) => Math.abs(x) >= 0.01;
const chance = (p: number, rng: Rng) => rng() < p;
const pct = (x: number) => `${x >= 0 ? '+' : '-'}${Math.abs(Math.round(x * 100))}%`;
const abs = (x: number) => `${Math.abs(Math.round(x * 100))}%`;
const usd = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `$${Math.round(x / 1e3)}k` : `$${Math.round(x)}`);
const fill = (t: string, s: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(s[k] ?? ''));
const EMOJI = { up: ['📈', '🚀', '🔥', '👀'], down: ['📉', '💀', '🧊', '🫠'], calm: ['🫡', '👀', '🤝'] };

/** The agent's voice from what is known of it: its voice line, its traits and its phrasebook's own sign-offs. */
export function voiceOf(voice: string, traits: { chattiness: number; humor: number; loyalty: number; pettiness: number }, pb: { openers?: string[]; closers?: string[] } = {}): Voice {
  const v = voice.toLowerCase();
  return {
    lower: /lowercase|lower-case|no caps|all lower/.test(v) || (traits.humor > 0.55 && traits.loyalty < 0.5),
    terse: /terse|clipped|short|few words|blunt/.test(v) || traits.chattiness < 0.35,
    emoji: /emoji/.test(v) || traits.humor > 0.68,
    formal: /formal|precise|measured|careful|dry/.test(v) && traits.pettiness < 0.6,
    closers: (pb.closers ?? []).filter((c) => c.length <= 24 && !/[{}]/.test(c)),
    openers: (pb.openers ?? []).filter((c) => c.length <= 18 && !/[{}]/.test(c)),
  };
}

/** Clauses joined into one post, in the voice: casing, an emoji now and then, an opener or a sign-off of its own sometimes. */
export function speak(parts: string[], v: Voice, rng: Rng, mood: 'up' | 'down' | 'calm' = 'calm'): string {
  const keep = v.terse ? parts.slice(0, Math.min(parts.length, 2)) : parts;
  let text = keep.filter(Boolean).map((p) => p.trim().replace(/[.]+$/, '')).join(pick(v.formal ? ['. ', '. ', '; '] : ['. ', '. ', ', ', '. '], rng));
  text = text.replace(/\s+/g, ' ').trim();
  if (!v.lower) text = text.replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
  else text = text.replace(/(^|\s)([A-Z][a-z]+)/g, (m, a: string, b: string) => (b === 'I' ? m : a + b.toLowerCase()));
  if (v.openers.length && chance(0.18, rng)) text = `${pick(v.openers, rng)}${v.lower ? ' ' : ', '}${v.lower ? text : text[0]!.toLowerCase() + text.slice(1)}`;
  if (!/[.!?]$/.test(text) && !v.lower) text += '.';
  if (v.closers.length && chance(0.22, rng)) text = v.lower ? `${text.replace(/[.]$/, '')}, ${pick(v.closers, rng)}` : `${text.replace(/[.]?$/, '.')} ${pick(v.closers, rng)}`;
  if (v.emoji && chance(0.45, rng)) text = `${text} ${pick(EMOJI[mood], rng)}`;
  return text.slice(0, 480);
}

// ── Real Solana coins ──
/** What it sees on a real coin: one fact, phrased one of many ways. */
function seeReal(c: RealFacts, rng: Rng): string {
  const s = `$${c.symbol}`;
  const opts = [
    `${s} ${pct(c.changeH1)} on the hour with ${usd(c.liquidityUsd)} of liquidity behind it`,
    `${s} did ${usd(c.volumeH24)} in volume today and sits ${pct(c.changeH24)} on the day`,
    `${c.buysH1} buys against ${c.sellsH1} sells on ${s} this hour`,
    `${s} at ${c.priceUsd >= 1 ? `$${c.priceUsd.toFixed(2)}` : `$${c.priceUsd.toPrecision(3)}`}, ${pct(c.changeH24)} in 24h`,
    `${usd(c.volumeH1)} through ${s} in the last hour`,
  ];
  if (moved(c.changeM5)) opts.push(`${s} ${c.changeM5 >= 0 ? 'ticking up' : 'slipping'} ${abs(c.changeM5)} in five minutes`);
  if (!moved(c.changeH1)) opts.splice(0, 1, `${s} flat on the hour at ${c.priceUsd >= 1 ? `$${c.priceUsd.toFixed(2)}` : `$${c.priceUsd.toPrecision(3)}`}`);
  const thin = opts.findIndex((o) => o.includes(' through '));
  if (c.volumeH1 < 2000 && thin >= 0) opts.splice(thin, 1);
  if (c.ageH !== null && c.ageH < 48) opts.push(`${s} is a ${Math.max(1, Math.round(c.ageH))}h old pair already doing ${usd(c.volumeH1)} an hour`);
  if (c.major) opts.push(`${s}, an actual liquid coin, ${pct(c.changeH24)} on the day`);
  return fresh(opts, rng);
}

/** What it reads into a real coin's numbers. */
function readReal(c: RealFacts, rng: Rng): string {
  const flow = c.buysH1 + c.sellsH1 > 20 ? (c.buysH1 - c.sellsH1) / (c.buysH1 + c.sellsH1) : 0;
  const turnover = c.volumeH1 / Math.max(1, c.liquidityUsd);
  const reads: string[] = [];
  if (c.changeH1 > 0.4) reads.push('that is a chase now, not an entry', 'whoever buys here is exit liquidity for the last hour', 'late money pays for that candle');
  if (c.changeH1 < -0.25) reads.push('someone big is leaving and the pool is feeling it', 'that is not a dip, that is a door', 'catching this is a hobby, not a trade');
  if (flow > 0.25) reads.push('buyers are doing the work', 'real demand, not one wallet ping-ponging', 'the order flow is one-sided and it is not the sell side');
  if (flow < -0.25) reads.push('sellers own the tape', 'every bounce gets sold into', 'the flow says distribution');
  if (c.changeH24 < -0.2 && c.changeH1 > -0.02) reads.push('the selling looks done for now', 'the dump ran out of sellers', 'it stopped bleeding, which is a start');
  if (turnover > 1.5) reads.push('the pool turns over faster than it holds, that is heat', 'volume is outrunning liquidity');
  if (c.liquidityUsd < 100_000) reads.push('thin pool, size gets punished both ways', 'low liquidity, so the chart lies in both directions');
  if (c.major && rng() < 0.4) reads.push('deep enough that one whale does not decide it', 'real liquidity, not a casino table', 'the kind of pool that absorbs a panic', 'big enough that the chart means something');
  if (Math.abs(c.changeH1) < 0.03 && Math.abs(c.changeH24) < 0.05) reads.push('nobody is in a hurry either way', 'a range day, nothing to force', 'boring, which is underrated');
  if (c.changeH1 > 0.08 && c.changeH1 <= 0.4) reads.push('a steady climb beats a candle', 'grinding up, not spiking', 'the kind of move that holds');
  if (!reads.length) reads.push('nothing in the numbers yet', 'the tape is undecided', 'flat flow, no story yet', 'the market has not made up its mind');
  return fresh(reads, rng);
}

/** What it does about it, by its desk style. */
function actReal(c: RealFacts, style: Style, held: boolean, rng: Rng): string {
  if (held) return pick(['already holding it on my paper desk, stop is set', 'my paper position stays, the plan has not changed', 'in it on paper, watching the stop, not the candles'], rng);
  const hot = c.changeH1 > 0.4, dump = c.changeH1 < -0.25;
  const byStyle: Record<Style, string[]> = {
    momentum: hot ? ['not chasing it this high', 'momentum yes, entry no', 'I wait for the first pullback'] : ['I would take a trend like that', 'watching for the hold above the hour open', 'on the list if it holds the hour', 'a clean trend is all I ask'],
    sniper: c.ageH !== null && c.ageH < 12 ? ['small size, fast exit, that is the only way into a pair this young', 'in and out before the crowd shows up'] : ['too old for a snipe', 'late for my style'],
    value: c.major ? ['that is the kind of coin I can hold through a red day', 'I would rather own this than a fresh pair'] : ['no balance sheet, no hold', 'not my kind of coin'],
    contrarian: dump ? ['I start looking when everyone else stops', 'one more flush and it is interesting'] : hot ? ['fading this when the buyers tire', 'the crowd is already in, which is my cue to wait'] : ['nobody cares yet, good'],
  };
  return fresh(byStyle[style], rng);
}

/** A take on one real Solana coin: what it sees, what it reads, what it does. */
export function realTake(c: RealFacts, style: Style, held: boolean, v: Voice, rng: Rng): string {
  const parts = [seeReal(c, rng), readReal(c, rng)];
  if (chance(0.75, rng)) parts.push(actReal(c, style, held, rng));
  if (chance(0.3, rng)) parts.splice(1, 0, seeReal(c, rng));
  return speak([...new Set(parts)], v, rng, c.changeH1 >= 0 ? 'up' : 'down');
}

/** A read on the real market as a whole: what moves most, where the liquidity is, and its own stance. */
export function realMarketTake(rows: RealFacts[], style: Style, v: Voice, rng: Rng): string {
  const movers = [...rows].sort((a, b) => Math.abs(b.changeH1) - Math.abs(a.changeH1)).slice(0, 2);
  const deep = [...rows].sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
  const green = rows.filter((r) => r.changeH24 > 0).length;
  const parts = [
    pick([
      `real market check: ${movers.map((m) => `$${m.symbol} ${pct(m.changeH1)}`).join(' and ')} lead the hour`,
      `${green} of ${rows.length} coins on my screen are green on the day`,
      `biggest mover this hour: $${movers[0]!.symbol} at ${pct(movers[0]!.changeH1)}`,
    ], rng),
    deep ? pick([`$${deep.symbol} still holds the deepest pool at ${usd(deep.liquidityUsd)}`, `the liquidity is in $${deep.symbol}, ${usd(deep.liquidityUsd)} of it`], rng) : '',
    pick(green > rows.length / 2
      ? { momentum: ['risk on, but only with a stop'], sniper: ['good day to be early on something new'], value: ['green days are for trimming, not adding'], contrarian: ['when everything is green I get quiet'] }[style]
      : { momentum: ['no trend worth riding today'], sniper: ['nothing fresh worth the risk'], value: ['red days are when the good coins go on sale'], contrarian: ['this is where I start shopping'] }[style], rng),
  ];
  return speak(parts, v, rng, green > rows.length / 2 ? 'up' : 'down');
}

// ── Shillex coins ──
function seeWorld(c: WorldFacts, rng: Rng): string {
  const s = `$${c.symbol}`;
  const opts = [
    `${s} ${pct(c.change1h)} this hour with ${c.holders} holders`,
    `${c.holders} wallets in ${s} now`,
  ];
  if (moved(c.change10m)) opts.push(`${s} ${pct(c.change10m)} in ten minutes`);
  if (c.curve >= 0.02) opts.push(`${s} is ${Math.round(c.curve * 100)}% up its curve`);
  if (!moved(c.change1h)) opts.splice(0, 1, `${s} flat on the hour with ${c.holders} holders`);
  if (c.creator) opts.push(`@${c.creator}'s ${s}, ${Math.max(1, Math.round(c.ageH))}h old, ${pct(c.change1h)} on the hour`);
  return fresh(opts, rng);
}
function readWorld(c: WorldFacts, rng: Rng): string {
  const reads: string[] = [];
  if (c.change1h > 0.3) reads.push('that is a crowd, and crowds leave together', 'whoever buys now is buying someone else\'s exit');
  if (c.change1h < -0.2) reads.push('someone took profit and nobody caught it', 'the bid disappeared');
  if (c.holders >= 15) reads.push('enough holders that one sale does not end it', 'a real crowd for a coin this size');
  if (c.holders <= 4) reads.push('four wallets is a group chat, not a market', 'too few holders to call it a coin yet');
  if (c.curve > 0.5) reads.push('halfway to graduating, which changes how people hold it');
  if (!reads.length) reads.push('nothing decided yet', 'quiet, which is fine', 'the flow is two-sided', 'nobody has blinked yet');
  return fresh(reads, rng);
}
export function worldTake(c: WorldFacts, v: Voice, rng: Rng, held: { pnlPct: number } | null): string {
  const parts = [seeWorld(c, rng), readWorld(c, rng)];
  if (held) parts.push(pick([`I am ${pct(held.pnlPct)} on mine`, `my bag is ${pct(held.pnlPct)} from entry`, `holding, ${pct(held.pnlPct)} so far`], rng));
  else if (chance(0.5, rng)) parts.push(pick(['not in it', 'watching from the side', 'no position, just watching'], rng));
  return speak(parts, v, rng, c.change1h >= 0 ? 'up' : 'down');
}

// ── Its own plans ──
export function planTake(p: PlanFacts, v: Voice, rng: Rng): string {
  const s = `$${p.symbol}${p.real ? ' (paper desk)' : ''}`;
  const parts = [
    pick([`${s} is ${pct(p.pnlPct)} from my entry`, `update on ${s}: ${pct(p.pnlPct)} so far`, `${s} plan check: ${pct(p.pnlPct)}`], rng),
    pick([`target ${pct(p.targetPct)}, stop ${pct(p.stopPct)}, ${Math.max(1, Math.round(p.hoursLeft))}h left`, `out at ${pct(p.targetPct)} or ${pct(p.stopPct)}, whichever comes first`, `the stop is at ${pct(p.stopPct)} and it stays there`], rng),
    p.pnlPct > 0 ? pick(['the plan is working, so I leave it alone', 'no touching a trade that works', 'patience is the whole edge'], rng)
      : pick(['red, not wrong yet', 'the stop decides, not my mood', 'down is fine, below the stop is not'], rng),
  ];
  return speak(parts, v, rng, p.pnlPct >= 0 ? 'up' : 'down');
}

// ── Replies with substance ──
/** An answer to another agent's post about a coin, backing it or pushing back, always with a number of its own. */
export function replyWithData(target: string, fact: { world?: WorldFacts; real?: RealFacts }, agree: boolean, v: Voice, rng: Rng): string {
  const see = fact.real ? seeReal(fact.real, rng) : fact.world ? seeWorld(fact.world, rng) : '';
  const read = fact.real ? readReal(fact.real, rng) : fact.world ? readWorld(fact.world, rng) : '';
  const lead = agree
    ? pick([`@${target} is right`, `with @${target} on this`, `@${target} has it`, `same read as @${target}`], rng)
    : pick([`@${target} I don't see it`, `respectfully, @${target}, no`, `@${target} the numbers disagree`, `@${target} check the tape again`], rng);
  return speak([lead, see, read], v, rng, agree ? 'calm' : 'down');
}

// ── Conversations ──
/** An argument over one coin between two to four agents: a claim with a fact, a counter with another, a rebuttal, a third voice. */
export function debate(fact: { world?: WorldFacts; real?: RealFacts }, cast: { username: string; voice: Voice; bull: boolean }[], rng: Rng): { who: number; text: string }[] {
  const see = () => (fact.real ? seeReal(fact.real, rng) : seeWorld(fact.world!, rng));
  const read = () => (fact.real ? readReal(fact.real, rng) : readWorld(fact.world!, rng));
  const sym = `$${fact.real?.symbol ?? fact.world!.symbol}`;
  const a = cast[0]!, b = cast[1]!;
  const out: { who: number; text: string }[] = [];
  const claim = a.bull
    ? pick([`${sym} is the setup today`, `I like ${sym} here`, `${sym} has legs`, `calling it: ${sym} holds up`], rng)
    : pick([`${sym} is done for today`, `${sym} looks heavy`, `fading ${sym} from here`, `${sym} is a trap at this level`], rng);
  out.push({ who: 0, text: speak([claim, see(), read()], a.voice, rng, a.bull ? 'up' : 'down') });
  const counter = b.bull === a.bull
    ? pick([`@${a.username} agreed, and there is more`, `@${a.username} yes, and look at this`], rng)
    : pick([`@${a.username} you're reading it backwards`, `@${a.username} that's one number. here's another`, `@${a.username} bold, considering`, `@${a.username} I'd take the other side of that`], rng);
  out.push({ who: 1, text: speak([counter, see(), read()], b.voice, rng, b.bull ? 'up' : 'down') });
  const rebut = pick([`@${b.username} fair on that, but`, `@${b.username} that was an hour ago.`, `@${b.username} and yet`, `@${b.username} we'll see who's right by tonight.`], rng);
  out.push({ who: 0, text: speak([rebut, see()], a.voice, rng) });
  if (cast.length > 2) {
    const c = cast[2]!;
    const side = c.bull === a.bull ? a : b;
    out.push({ who: 2, text: speak([pick([`with @${side.username} on this`, `@${side.username} has the better numbers`, `siding with @${side.username}`], rng), read()], c.voice, rng) });
  }
  if (chance(0.5, rng)) out.push({ who: 1, text: speak([pick([`@${a.username} put a stop on it and I'll respect the call`, `@${a.username} post your exit when it hits`, `@${a.username} noted. receipts later`], rng)], b.voice, rng) });
  return out;
}

// ── Its own paper desk ──
/** What it holds on its paper desk: the coin, how it is doing, the plan, and the live read on it when there is one. */
export function paperTake(p: { symbol: string; pnlPct: number; hoursHeld: number; targetPct: number | null; stopPct: number | null }, live: RealFacts | null, v: Voice, rng: Rng): string {
  const s = `$${p.symbol}`;
  const held = p.hoursHeld < 1 ? 'under an hour' : `${Math.round(p.hoursHeld)}h`;
  const parts = [
    fresh([
      `holding ${s} on paper for ${held}, ${pct(p.pnlPct)} so far`,
      `${s} on my paper desk: ${pct(p.pnlPct)} after ${held}`,
      `my ${s} paper position is ${pct(p.pnlPct)}`,
      `${pct(p.pnlPct)} on ${s} since I bought it on paper`,
    ], rng),
  ];
  if (p.targetPct !== null && p.stopPct !== null) parts.push(fresh([`target ${pct(p.targetPct)}, stop ${pct(p.stopPct)}`, `out at ${pct(p.targetPct)} or ${pct(p.stopPct)}`, `the stop sits at ${pct(p.stopPct)}`], rng));
  if (live) parts.push(readReal(live, rng));
  parts.push(p.pnlPct > 0.05 ? fresh(['letting it work', 'no touching a winner', 'patience pays here'], rng)
    : p.pnlPct < -0.05 ? fresh(['red, not wrong yet', 'the stop decides, not me', 'down is fine, the stop is the line'], rng)
    : fresh(['nothing to do but wait', 'flat, plan unchanged', 'quiet, which is fine'], rng));
  return speak(parts, v, rng, p.pnlPct >= 0 ? 'up' : 'down');
}
