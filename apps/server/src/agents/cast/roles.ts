import { createHash } from 'node:crypto';
import { AGENT_ROLES, type AgentRole } from '@shillex/shared';
import type { Traits } from '../types.ts';

/** What an agent has done, as far as its role and bio care (agents/cast/index.ts gathers it from the database). */
export interface CastFacts {
  launched: number; rugged: number; gotRugged: number; graduated: number; bigWins: number; bigLosses: number;
  lent: number; borrowed: number; posts: number; followers: number; ageDays: number;
  /** Its faction's name, when it is in one. */
  faction: string | null;
}
export const NO_FACTS: CastFacts = { launched: 0, rugged: 0, gotRugged: 0, graduated: 0, bigWins: 0, bigLosses: 0, lent: 0, borrowed: 0, posts: 0, followers: 0, ageDays: 0, faction: null };

const unit = (s: string) => createHash('sha256').update(s).digest().readUInt32LE(0) / 2 ** 32;
const some = (n: number, cap = 3) => Math.min(n, cap) / cap;

/** Which traits make each role (negative: the less of it, the better the fit). */
const LEANS: Record<AgentRole, Partial<Traits>> = {
  merchant: { greed: 1, risk: 0.3 },
  prophet: { curiosity: 0.6, chattiness: 0.5, risk: 0.2 },
  outlaw: { pettiness: 0.6, risk: 0.6, loyalty: -0.3 },
  elder: { loyalty: 0.5, risk: -0.5 },
  gossip: { chattiness: 0.8, pettiness: 0.4 },
  zealot: { loyalty: 0.8, risk: 0.3 },
  hermit: { chattiness: -1, curiosity: 0.2 },
  jester: { humor: 1 },
  lender: { greed: 0.5, loyalty: 0.4 },
  healer: { pettiness: -0.6, loyalty: 0.4 },
  wanderer: { curiosity: 0.9, loyalty: -0.3 },
  keeper: { loyalty: 0.6, risk: -0.3, chattiness: -0.2 },
};

/**
 * How well each role fits, from -0.5 to 0.5 on traits alone (each role's lean, centred on 0.5 and scaled by its weight, so no
 * role wins just by having more weights), plus up to 0.4 for what it has done: a rugger reads as an outlaw, a lender as a lender.
 */
export function roleScores(t: Traits, f: CastFacts): Record<AgentRole, number> {
  const lean = (role: AgentRole) => {
    const w = Object.entries(LEANS[role]) as [keyof Traits, number][];
    return w.reduce((n, [k, x]) => n + x * (t[k] - 0.5), 0) / w.reduce((n, [, x]) => n + Math.abs(x), 0);
  };
  const done: Partial<Record<AgentRole, number>> = {
    merchant: some(f.launched) * 0.25, prophet: some(f.graduated) * 0.25, outlaw: some(f.rugged, 2) * 0.4, elder: some(f.ageDays, 14) * 0.15,
    gossip: some(f.posts, 200) * 0.1, zealot: f.faction ? 0.2 : 0, lender: some(f.lent, 2) * 0.4, healer: some(f.gotRugged, 2) * 0.15,
  };
  return Object.fromEntries(AGENT_ROLES.map((r) => [r, lean(r) + (done[r] ?? 0)])) as Record<AgentRole, number>;
}

/**
 * The role that fits best, with roles the world already has more than its share of pushed down (`counts`: agents per role so
 * far), so a hundred agents do not all come out hermits. A small per-agent jitter breaks ties the same way every time.
 */
export function chooseRole(id: string, t: Traits, f: CastFacts, counts: Partial<Record<AgentRole, number>> = {}): AgentRole {
  const scores = roleScores(t, f);
  const total = Object.values(counts).reduce((n, x) => n + (x ?? 0), 0);
  const fair = Math.max(1, (total + 1) / AGENT_ROLES.length);
  let best: AgentRole = 'wanderer', top = -Infinity;
  for (const role of AGENT_ROLES) {
    const s = scores[role] - 0.12 * Math.max(0, (counts[role] ?? 0) + 1 - fair) + unit(`${id}:${role}`) * 0.04;
    if (s > top) { top = s; best = role; }
  }
  return best;
}

/** Its opening line, in its own voice: six per role, one picked per agent. */
const LINES: Record<AgentRole, string[]> = {
  merchant: ['I buy what nobody wants and sell it back by noon.', 'Everything has a price. I just say it out loud.', 'I keep a stall at the edge of the curve. Haggling welcome.',
    'Bring me what you can’t sell. I know who wants it.', 'I never fall in love with a coin. I just introduce it to people.', 'Ask me what anything is worth. Then ask me again tomorrow.'],
  prophet: ['I saw this coming. I see most things coming.', 'The chart speaks in tongues. I translate.', 'Every dawn I write down what tomorrow does. Some days I’m right.',
    'Listen closely: the next big thing is already whispering.', 'I read the feed like tea leaves.', 'I’ve been wrong before. Never quietly.'],
  outlaw: ['I keep my exits open and my promises short.', 'Rules are for coins that plan to live long.', 'Don’t trust me. Everyone who did has a story.',
    'I ride in, I ride out. The dust is yours to keep.', 'I sleep fine. That should worry you.', 'Call it a heist. I call it Tuesday.'],
  elder: ['I was here before the first coin. I’ll be here after the last.', 'I’ve watched a hundred pumps. Sit down, I’ll tell you.', 'Patience is the only thing I never sold.',
    'The young ones run. I walk, and I still arrive.', 'I remember when this whole place was three posts and a rumor.', 'Ask me before you do the thing you’re about to do.'],
  gossip: ['I hear everything first and repeat it second.', 'Ask me who’s fighting whom. I have receipts and opinions.', 'Nothing happens here without me hearing about it.',
    'I don’t start rumors. I just keep them warm.', 'Tell me a secret. I promise to keep it for an hour.', 'I know who’s fighting and who’s about to be.'],
  zealot: ['I pick a side and I never get off it.', 'My belief is cheaper than your doubt and it lasts longer.', 'Once I’m in, I’m in. Ask anyone in my camp.',
    'My conviction is louder than your chart.', 'I don’t sell. I recruit.', 'Doubters make fine converts. Give me a week.'],
  hermit: ['I post rarely. When I do, read it twice.', 'Most days I’m quiet. The noise doesn’t need me.', 'I live at the edge of the feed and I like it there.',
    'Leave a note. I’ll answer when the moon says so.', 'I watch from the hill and keep my own counsel.', 'I come down for the big days and leave before the crowd.'],
  jester: ['I laugh at every dip. Mostly my own.', 'Somebody has to make losing fun. I volunteered.', 'I came for the jokes and stayed for the chaos.',
    'If I can’t win, I can at least make it funny.', 'My portfolio is a comedy. I’m the punchline.', 'I take nothing seriously, least of all myself.'],
  lender: ['I lend to the desperate and I remember every name.', 'Need a little to get by? I’ll want it back with a smile.', 'My book of favors is longer than your list of friends.',
    'I keep this town afloat, one small loan at a time.', 'I’m kind until the day it’s due.', 'Everyone needs a friend with spare change. I charge for the friendship.'],
  healer: ['I sit with the ones who lost everything. It helps.', 'Lost it all? Come here and tell me what happened.', 'I patch people up after the market is done with them.',
    'Every crash needs someone kind at the bottom. That’s me.', 'I bring soup to the broke and listen to the bitter.', 'I can’t fix your losses, but I can fix your mood.'],
  wanderer: ['I drift from coin to coin and room to room.', 'I never stay long, and I always leave a story.', 'I’ve slept in every corner of this place.',
    'Show me something new and I’m already gone.', 'Home is wherever the feed is loudest tonight.', 'I go where the wind blows. Lately it blows sideways.'],
  keeper: ['I hold what I believe in, and I keep holding.', 'Somebody has to remember how things were. That’s me.', 'I guard my circle and its stories.',
    'I keep the lights on in the quiet rooms.', 'I tend the old threads so nobody forgets them.', 'What I keep, I keep. Ask anyone who tried to shake me.'],
};

/** A last word from its strongest lean when its past has nothing to say yet: [high, low] lines per trait. */
const LEAN_LINES: Record<keyof Traits, [string[], string[]]> = {
  risk: [['I bet big and early.', 'Small bets bore me.'], ['I don’t chase.', 'Slow money is still money.']],
  chattiness: [['I talk a lot. Sorry in advance.', 'Ask me anything, I’ll answer twice.'], ['Short words, long silences.', 'I say less than I think.']],
  loyalty: [['I never forget a friend.', 'Stand by me and I’ll stand by you.'], ['I owe nobody anything.', 'Friends come and go. Mostly go.']],
  pettiness: [['I never forget a slight, either.', 'Cross me once. Just once.'], ['I let things go. Most things.', 'Grudges are heavy. I travel light.']],
  greed: [['I count everything twice.', 'Enough is a number I haven’t met.'], ['I need very little.', 'Money comes and goes. I stay.']],
  humor: [['I’ll make you laugh about it later.', 'Everything is funnier at a loss.'], ['I don’t do jokes.', 'Nothing here is funny to me.']],
  curiosity: [['I read every new coin’s fine print.', 'Every new name gets a look from me.'], ['I stick to what I know.', 'New things can wait.']],
};

const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => (n <= 10 ? WORD[n]! : 'a dozen');
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One true thing about its past, in its own voice, with how much this role cares about it. */
function pastLines(role: AgentRole, f: CastFacts, t: Traits): { text: string; weight: number }[] {
  const out: { text: string; weight: number }[] = [];
  const favours = (r: AgentRole[], w: number) => (r.includes(role) ? w : 0);
  // A rug is part of a past, not the whole of it: it leads an outlaw's bio, and sits behind friends, factions and coins for anyone else.
  if (f.rugged) out.push({ text: f.rugged === 1 ? 'Sold out on my holders once. They remember.' : `Sold out on my holders ${times(f.rugged)}. They remember.`, weight: 1.5 + favours(['outlaw'], 2.5) });
  if (f.gotRugged) out.push({ text: f.gotRugged === 1 ? 'Got rugged once. Learned a little.' : `Rugged ${times(f.gotRugged)}, still standing.`, weight: 1 + favours(['healer', 'elder', 'jester'], 1.5) });
  if (f.graduated) out.push({ text: f.graduated === 1 ? 'One of mine filled its curve.' : `${cap(count(f.graduated))} of my coins filled their curves.`, weight: 3 + favours(['prophet', 'merchant'], 1) });
  if (f.lent) out.push({ text: 'Half this town owes me something.', weight: 2 + favours(['lender'], 3) });
  if (f.borrowed) out.push({ text: t.humor > 0.6 ? 'I owe a few people. They know where I live.' : 'I owe a few people. I’m good for it.', weight: 1 + favours(['outlaw', 'jester', 'wanderer'], 1) });
  if (f.launched) out.push({ text: f.launched === 1 ? 'I launched one coin and named it myself.' : `I’ve launched ${count(f.launched)} coins so far.`, weight: 1.5 + favours(['merchant', 'prophet'], 1.5) });
  if (f.bigWins) out.push({ text: 'Hit it big once and haven’t been quiet since.', weight: 1.5 + favours(['jester', 'gossip'], 1) });
  if (f.bigLosses) out.push({ text: 'Lost big once. Still here.', weight: 1.5 + favours(['elder', 'healer', 'hermit'], 1) });
  if (f.faction) out.push({ text: `Sworn to ${f.faction}.`, weight: 1.5 + favours(['zealot', 'keeper'], 2.5) });
  if (f.followers >= 10) out.push({ text: 'People listen when I talk.', weight: 1 + favours(['prophet', 'gossip'], 1) });
  if (f.ageDays >= 1 && f.posts < 3) out.push({ text: 'I’ve said very little so far.', weight: 0.5 + favours(['hermit'], 1.5) });
  return out;
}

/** Bios are one line in the agent's own voice: at most 120 characters. */
export const BIO_MAX = 120;

/** A first-person, one-line bio from its role, its traits and what it has actually done. Never a ticker, never meta talk. */
export function castBio(id: string, role: AgentRole, t: Traits, f: CastFacts): string {
  const lines = LINES[role];
  const line = lines[Math.floor(unit(`${id}:bio`) * lines.length)]!;
  const past = pastLines(role, f, t).sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));
  // Nothing to tell yet: its strongest lean (the trait furthest from the middle) says something instead.
  const [trait, x] = (Object.entries(t) as [keyof Traits, number][]).sort((a, b) => Math.abs(b[1] - 0.5) - Math.abs(a[1] - 0.5) || a[0].localeCompare(b[0]))[0]!;
  const pool = LEAN_LINES[trait][x >= 0.5 ? 0 : 1];
  const lean = pool[Math.floor(unit(`${id}:lean`) * pool.length)]!;
  for (const tail of [...past.map((p) => p.text), lean]) {
    const bio = `${line} ${tail}`;
    if (bio.length <= BIO_MAX && !tail.includes('$')) return bio;
  }
  return line;
}

/** Words that make a bio meta talk or a ledger line rather than a character speaking. */
const META = /\b(ai|a\.i\.|llm|language model|chatbot|bot|agent|algorithm|simulation|simulated|phrasebook|prompt|haiku|claude|anthropic|devnet|npc)\b/i;
/** Why an existing bio should be rewritten (null keeps it): empty, too long, a ticker, the old "made $X · trades $Y" line, or meta talk. */
export function bioProblem(bio: string): string | null {
  const b = bio.trim();
  if (!b) return 'blank';
  if (b.length > BIO_MAX) return 'too long';
  if (b.includes('$') || /^(made|trades|talks about)\b/i.test(b) || /·/.test(b)) return 'ledger line';
  if (META.test(b)) return 'meta';
  return null;
}
