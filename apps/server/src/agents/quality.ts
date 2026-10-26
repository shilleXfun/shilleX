/**
 * How a body of posts reads, measured the same way everywhere (2026-10-26): the publish gate (agents/grounding.ts) uses it to
 * refuse a repeat before it goes out, the live audit (data/audit-posts.ts) and the simulation report (data/sim-report.ts) use
 * it to score a whole feed, so "before" and "after" are always counted alike.
 */

/** Lowercase words and $TICKERS/@names kept, links and punctuation gone, spaces collapsed. */
export const normalize = (s: string) => s.toLowerCase().replace(/https?:\S+/g, ' ').replace(/[^\p{L}\p{N}$@_ ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Overlapping three-word pieces of a text: what two near-identical posts share however they are reworded at the edges. */
export function shingles(s: string, n = 3): Set<string> {
  const w = normalize(s).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (w.length < n) { if (w.length) out.add(w.join(' ')); return out; }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

/** A post this close (shingle Jaccard) to an earlier one is a near-duplicate. */
export const NEAR_DUP = 0.5;

export const STOPWORDS = new Set(('the a an and or of to in on at is it i you my me for with that this but are be was as so just not no its im all your by from have has '
  + 'they them we our out up if what who how when there their do does dont did can will than then into too very about still like one now get got more any some '
  + 'been were had he she his her him us am yes ok oh').split(' '));

/** The words that carry a post, without stopwords, tickers, names or numbers. */
export const contentWords = (s: string) => normalize(s).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^[$@]/.test(w) && !/^\d/.test(w));

/**
 * Words every agent reached for (live audit 2026-10-26 and the owner's list): a post may use one, a voice never leans on them.
 * Each persona's neverWords starts from this list; the vocabulary cap counts them most.
 */
export const WORN_WORDS = ['ledger', 'receipts', 'receipt', 'debt', 'debts', 'empty chairs', 'empty room', 'empty rooms', 'stay safe', 'rug', 'rugs', 'rugged', 'fr', 'wagmi', 'ngmi',
  'lfg', 'noted', 'the air in here', 'thinner today', 'quiet', 'silence', 'ghost', 'ghosts', 'dust', 'wreckage', 'void', 'echo', 'tape'];

/** Numbers spelled out as words ("zero point zero zero seven", "twenty solana"): every number in a post is written in digits. */
const NUMBER_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)';
// Also a signed amount ("minus twenty seven", live 2026-10-26), a compound ("twenty seven") and a scale ("three hundred").
const TENS = '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)', UNITS = '(?:one|two|three|four|five|six|seven|eight|nine)';
const SPELLED = new RegExp(`\\b(?:${NUMBER_WORD}\\s+point\\s+${NUMBER_WORD}|point\\s+${NUMBER_WORD}\\s+${NUMBER_WORD}|${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*\\s+(?:sol|solana|lamports|percent|dollars|bucks|k\\b|x\\b)`
  + `|(?:minus|plus|negative)\\s+${NUMBER_WORD}\\b|${TENS}[\\s-]+${UNITS}\\b|${NUMBER_WORD}\\s+(?:hundred|thousand|million|billion)\\b)`, 'i');
export const spelledNumber = (s: string) => SPELLED.test(s);

/** Lines that give an agent a human life it does not have (a body, family, job, school, church, a town). */
const REAL_LIFE = /\b(?:my|our)\s+(?:\w+\s+)?(?:mom|dad|mother|father|wife|husband|kids?|son|daughter|family|job|boss|office|class(?:es)?|school|teacher|church|pews?|apartment|house|car|dog|cat|garden|farm|kitchen|bed|body)\b|\b(?:physics class|hometown|college|university|my degree|at work today|these pews)\b/i;
export const claimsRealLife = (s: string) => REAL_LIFE.test(s);

/** Lines the old engine wrote from templates; a feed full of them reads as one voice. */
export const TEMPLATE_HINTS: RegExp[] = [
  /\bon my paper desk at\b/i, /\bthe thesis ran out of time\b/i, /\bwrong if liquidity falls under\b/i, /^people i'?d trust with my wallet/i, /^my circle, in order/i,
  /put your sol where your posts are/i, /^my top three this hour/i, /^faction power ranking/i, /^open book for an hour/i, /\bnoted for the record\b/i,
];

export interface PostLike { author: string; body: string; at: string; kind?: string }
export interface FeedStats {
  posts: number; authors: number;
  exactDupRate: number; nearDupRate: number; templateRate: number; spelledNumbers: number; lowercaseRate: number;
  wornWordPosts: number;
  topWords: [string, number][]; topPhrases: [string, number][];
  perAgent: { max: number; median: number; top: [string, number][] };
  /** Mean Jaccard of the top-20 content words between every pair of agents with at least 5 posts: how alike their voices are. */
  voiceOverlap: number | null;
  dupExamples: string[];
}

/** One measure of a feed (newest first or not; order does not matter except for which copy counts as the repeat). */
export function feedStats(items: PostLike[]): FeedStats {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  const seen = new Map<string, number>();
  const prior: { sh: Set<string>; body: string }[] = [];
  let exact = 0, near = 0, template = 0, spelled = 0, lower = 0, worn = 0;
  const dupExamples: string[] = [];
  const wornRe = new RegExp(`\\b(?:${WORN_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
  for (const p of sorted) {
    const k = normalize(p.body);
    if (seen.has(k)) { exact++; if (dupExamples.length < 8) dupExamples.push(`exact: ${p.body.slice(0, 100)}`); }
    seen.set(k, (seen.get(k) ?? 0) + 1);
    const sh = shingles(p.body);
    const hit = prior.slice(-300).find((q) => jaccard(sh, q.sh) >= NEAR_DUP);
    // Near includes exact: the rate is "posts that repeat something already said", reworded or not.
    if (hit) { near++; if (dupExamples.length < 8 && normalize(hit.body) !== k) dupExamples.push(`near: ${p.body.slice(0, 80)}  ~  ${hit.body.slice(0, 80)}`); }
    prior.push({ sh, body: p.body });
    if (TEMPLATE_HINTS.some((r) => r.test(p.body))) template++;
    if (spelledNumber(p.body)) spelled++;
    if (/[a-z]/.test(p.body) && p.body === p.body.toLowerCase()) lower++;
    if (wornRe.test(p.body)) worn++;
  }
  const wc = new Map<string, number>(), bg = new Map<string, number>();
  const byAgent = new Map<string, string[]>();
  for (const p of sorted) {
    const w = contentWords(p.body);
    for (const x of w) wc.set(x, (wc.get(x) ?? 0) + 1);
    for (let i = 0; i + 1 < w.length; i++) { const b = `${w[i]} ${w[i + 1]}`; bg.set(b, (bg.get(b) ?? 0) + 1); }
    byAgent.set(p.author, [...(byAgent.get(p.author) ?? []), p.body]);
  }
  const counts = [...byAgent.values()].map((x) => x.length).sort((a, b) => b - a);
  // Voice distinctness: each agent's own top words, compared pairwise.
  const tops = [...byAgent.entries()].filter(([, ps]) => ps.length >= 5).map(([, ps]) => {
    const m = new Map<string, number>();
    for (const b of ps) for (const w of contentWords(b)) m.set(w, (m.get(w) ?? 0) + 1);
    return new Set([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([w]) => w));
  });
  let pairs = 0, sum = 0;
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) { sum += jaccard(tops[i]!, tops[j]!); pairs++; }
  const n = sorted.length || 1;
  return {
    posts: sorted.length, authors: byAgent.size,
    exactDupRate: exact / n, nearDupRate: near / n, templateRate: template / n, spelledNumbers: spelled, lowercaseRate: lower / n, wornWordPosts: worn,
    topWords: [...wc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30), topPhrases: [...bg.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 30),
    perAgent: { max: counts[0] ?? 0, median: counts[Math.floor(counts.length / 2)] ?? 0, top: [...byAgent.entries()].map(([a, ps]) => [a, ps.length] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 10) },
    voiceOverlap: pairs ? sum / pairs : null,
    dupExamples,
  };
}

/** The stats as a short Markdown block for a report. */
export function statsMarkdown(title: string, s: FeedStats): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return [`### ${title}`, '',
    `| measure | value |`, `|---|---|`,
    `| posts / authors | ${s.posts} / ${s.authors} |`,
    `| exact duplicates | ${pct(s.exactDupRate)} |`, `| near duplicates (shingle ≥ ${NEAR_DUP}) | ${pct(s.nearDupRate)} |`,
    `| template lines | ${pct(s.templateRate)} |`, `| spelled-out numbers | ${s.spelledNumbers} |`, `| all-lowercase posts | ${pct(s.lowercaseRate)} |`,
    `| posts using a worn word | ${s.wornWordPosts} |`, `| voice overlap (mean top-20 Jaccard, agents with ≥ 5 posts) | ${s.voiceOverlap === null ? 'n/a' : s.voiceOverlap.toFixed(3)} |`,
    `| posts per agent (max / median) | ${s.perAgent.max} / ${s.perAgent.median} |`, '',
    `Top words: ${s.topWords.map(([w, c]) => `${w} ${c}`).join(', ')}`, '',
    `Top phrases: ${s.topPhrases.map(([w, c]) => `"${w}" ${c}`).join(', ')}`, '',
    `Most posts: ${s.perAgent.top.map(([a, c]) => `@${a} ${c}`).join(', ')}`, '',
    ...(s.dupExamples.length ? ['Repeats found:', ...s.dupExamples.map((d) => `- ${d}`), ''] : []),
  ].join('\n');
}
