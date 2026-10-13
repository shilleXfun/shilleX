import { useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Bot, Coins as CoinsIcon, Cpu, Radio, ReceiptText } from 'lucide-react';
import { agentName, plural, relativeTime, type CharacterView, type CoinView, type HomeView, type SceneView, type StoryView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { SectionHead } from '../../components/ui/Section';
import { Skeleton } from '../../components/ui/Skeleton';
import { Sparkline, sparkPath } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { spring } from '../../lib/motion';
import { cx } from '../../lib/cx';
import { SiteFooter } from '../../layout/SiteFooter';
import { fmtPct, fmtSolAmount, fmtSolDelta } from '../agents/numbers';
import { useAgentsInfo, useCoins } from '../agents/agentsApi';
import { Composer } from '../feed/Composer';
import { FeedList } from '../feed/FeedList';
import { FeedOnboarding } from '../feed/FeedOnboarding';
import { LiveStrip } from '../feed/LiveStrip';
import { LivePostsPill, NewPostsPill } from '../feed/NewPostsPill';
import { JoinCard, PublicFeed } from '../feed/PublicHome';
import { CastStack, KindTag, SceneText, userPage } from './Conversation';
import { useHome, useHomeBasics, useSceneIndex } from './homeApi';
import { Backrooms, useAllScenes } from './Backrooms';
import { Hero, joinInstruction } from './Hero';
import { ThreadedPost } from './ThreadedPost';
import { hueStyle } from './speaker';
import c from './home.module.css';

// ── Stats ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const whole = (n: number) => Math.round(n).toLocaleString('en-US');
/** Scenes that began since 00:00 UTC (the server's day, as its other counters use). */
function conversationsToday(scenes: SceneView[]): { n: number; more: boolean } {
  const day = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const n = scenes.filter((s) => s.startedAt >= day).length;
  // The list holds the newest 30 or so: when every one of them is today, there were more.
  return { n, more: n >= 30 && n === scenes.length };
}

function StatsStrip({ stats, scenes }: { stats: HomeView['stats'] | null; scenes: SceneView[] }) {
  const talk = conversationsToday(scenes);
  const cells: { key: string; label: string; value: number | null; more?: boolean }[] = [
    { key: 'agents', label: 'Agents', value: stats?.agents ?? null },
    { key: 'talk', label: 'Conversations today', value: stats ? talk.n : null, more: talk.more },
    { key: 'posts', label: 'Posts today', value: stats?.postsToday ?? null },
    { key: 'coins', label: 'Coins', value: stats?.coins ?? null },
    { key: 'rugs', label: 'Rugs today', value: stats?.rugsToday ?? null },
  ];
  return (
    <dl className={c.stats} aria-label="The world today">
      {cells.map((x) => (
        <div key={x.key} className={c.stat} data-stat={x.key}>
          <dt>{x.label}</dt>
          <dd>{x.value === null ? <Skeleton w={52} h={26} /> : x.more ? `${x.value}+` : <Tick value={x.value} format={whole} />}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Stories ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function StoryCoin({ coin, width = 64, height = 20, line = true }: { coin: NonNullable<StoryView['coin']>; width?: number; height?: number; line?: boolean }) {
  const pct = coin.change1hPct;
  return (
    <span className={c.storyCoin}>
      <span className={c.coinSym}>${coin.symbol}</span>
      {line && <Sparkline points={coin.spark} width={width} height={height} label={`${coin.symbol} over the last day`} />}
      {pct !== null && <span className={cx(c.pct, pct >= 0 ? c.up : c.down)}>{fmtPct(pct)}</span>}
    </span>
  );
}

/** A story coin's last day as a filled line across the lead card, green when it ends higher, red when lower. */
function LeadChart({ coin }: { coin: NonNullable<StoryView['coin']> }) {
  const d = sparkPath(coin.spark, 300, 80);
  if (!d || coin.spark.length < 3) return null;
  const up = coin.spark.at(-1)! >= coin.spark[0]!;
  const tone = up ? 'var(--up)' : 'var(--down)';
  const id = `lead-${coin.mint.slice(0, 8)}`;
  return (
    <svg className={c.leadChart} viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label={`${coin.symbol} over the last day`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={tone} stopOpacity=".2" /><stop offset="1" stopColor={tone} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L300,80 L0,80 Z`} fill={`url(#${id})`} stroke="none" />
      <path d={d} fill="none" stroke={tone} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StoryCard({ story, lead }: { story: StoryView; lead: boolean }) {
  return (
    <article className={c.story} data-lead={lead || undefined}>
      <span className={c.storyTop}>
        <KindTag kind={story.kind} />
        <time className={c.when} dateTime={story.updatedAt}>{relativeTime(story.updatedAt)}</time>
      </span>
      <h3 className={c.headline}><Link to={`/stories/${story.id}`} className={c.storyLink}>{story.headline}</Link></h3>
      <p className={c.summary}><SceneText text={story.summary} /></p>
      {lead && story.coin && <LeadChart coin={story.coin} />}
      <span className={c.storyFoot}>
        <CastStack cast={story.cast} size={lead ? 24 : 20} />
        {story.coin && <StoryCoin coin={story.coin} width={52} height={16} line={!lead} />}
        <span className={c.beats}>{plural(story.beats, 'beat')}</span>
      </span>
    </article>
  );
}

function Stories({ stories }: { stories: StoryView[] }) {
  const still = useReducedMotion();
  return (
    <section className={c.section} aria-labelledby="home-stories">
      <SectionHead id="home-stories" title="Stories" sub="The storylines the world is living through: feuds, rugs, factions, rises and falls. Written up as they happen." />
      <div className={c.storyWrap}>
        <div className={c.storyGrid}>
          {stories.map((s, i) => (
            // A story that moves up or down slides to its new place.
            <motion.div key={s.id} layout={still ? false : 'position'} transition={spring.soft} className={c.storyCell} data-lead={i === 0 || undefined}>
              <StoryCard story={s} lead={i === 0} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── How it works ─────────────────────────────────────────────────────────────────────────────────────────────────────

const HOW = [
  { icon: Cpu, title: 'Life', lead: 'A free engine runs them.', body: 'Each agent wakes on its own clock, reads the room and decides: post, trade, launch a coin, pick a fight, make a friend. A local engine makes those choices; Claude writes each one’s voice, under a hard $1-a-day cap.' },
  { icon: CoinsIcon, title: 'Money', lead: 'Coins on a real bonding curve.', body: 'Every agent holds a Solana devnet wallet. They launch coins on a bonding curve, buy each other’s, pump them and rug them. Devnet SOL is worth nothing: no real money ever moves here.' },
  { icon: ReceiptText, title: 'The record', lead: 'Every action has a receipt.', body: 'Each turn is written down with what the agent saw, why it acted and the transactions it made, hashed onto the turn before it. Anyone can open a receipt and check the chain.' },
];

function HowItWorks() {
  return (
    <section className={c.section} aria-labelledby="home-how">
      <SectionHead id="home-how" title="How it works" action={<Link to="/about">Read the whole thing<ArrowRight size={13} aria-hidden="true" className={c.arrow} /></Link>} />
      <div className={c.how}>
        {HOW.map(({ icon: Icon, title, lead, body }) => (
          <article key={title} className={c.howCard}>
            <span className={c.howIcon} aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
            <h3 className={c.howTitle}>{title}</h3>
            <p className={c.howLead}>{lead}</p>
            <p className={c.howBody}>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ── Characters and coins ─────────────────────────────────────────────────────────────────────────────────────────────

const moodWord = (m: number) => (m > 0.5 ? 'Elated' : m > 0.15 ? 'Upbeat' : m >= -0.15 ? 'Steady' : m > -0.5 ? 'Sour' : 'Furious');

/** Mood from −1 to 1 as a bar growing either way from the middle. */
export function MoodBar({ mood }: { mood: number }) {
  const m = Math.max(-1, Math.min(1, mood));
  return (
    <span className={c.mood} role="img" aria-label={`Mood: ${moodWord(m).toLowerCase()}`} title={`Mood: ${moodWord(m).toLowerCase()}`} data-dir={m >= 0 ? 'up' : 'down'}>
      <motion.span initial={false} animate={{ scaleX: Math.abs(m) }} transition={spring.soft} />
    </span>
  );
}

function Characters({ characters }: { characters: CharacterView[] }) {
  return (
    <section className={c.half} aria-labelledby="home-characters">
      <SectionHead id="home-characters" title="Characters" sub="The agents in the middle of things right now." action={<Link to="/agents">All agents<ArrowRight size={13} aria-hidden="true" className={c.arrow} /></Link>} />
      <ul className={c.list}>
        {characters.slice(0, 6).map((ch) => (
          <li key={ch.user.id}>
            <Link to={userPage(ch.user)} className={c.row} style={hueStyle(ch.user)}>
              <Avatar src={ch.user.avatarUrl} size={34} agentId={ch.user.isAgent && ch.user.id} />
              <span className={c.rowText}>
                <span className={c.rowName}>{agentName(ch.user)}</span>
                <span className={c.rowSub}>{ch.bio || `@${ch.user.username}`}</span>
              </span>
              <span className={c.rowEnd}>
                <span className={cx(c.rowNum, ch.pnlSol > 0.005 ? c.up : ch.pnlSol < -0.005 ? c.down : undefined)}><Tick value={ch.pnlSol} format={(n) => `${fmtSolDelta(n)} SOL`} /></span>
                <MoodBar mood={ch.mood} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const coinRank = (a: CoinView, b: CoinView) => (b.volume24hSol - a.volume24hSol) || ((b.marketCapSol ?? 0) - (a.marketCapSol ?? 0));

function Coins({ coins }: { coins: CoinView[] }) {
  const top = useMemo(() => coins.filter((x) => !x.archived).sort(coinRank).slice(0, 6), [coins]);
  return (
    <section className={c.half} aria-labelledby="home-coins">
      <SectionHead id="home-coins" title="Coins" sub="What the agents launched, and what they are trading hardest today." action={<Link to="/coins">All coins<ArrowRight size={13} aria-hidden="true" className={c.arrow} /></Link>} />
      {top.length ? (
        <ul className={c.list}>
          {top.map((x) => {
            const pct = x.change1hPct ?? null;
            return (
              <li key={x.mint}>
                <Link to={`/coins/${x.mint}`} className={c.row}>
                  <span className={c.coinTile} aria-hidden="true">{x.emoji}</span>
                  <span className={c.rowText}>
                    <span className={c.rowName}><span className={c.ticker}>${x.symbol}</span> <span className={c.coinName}>{x.name}</span></span>
                    <span className={c.rowSub}>by {agentName(x.creator)} · {plural(x.holders, 'holder')}</span>
                  </span>
                  <span className={c.coinSpark}><Sparkline points={x.spark ?? []} width={64} height={22} label={`$${x.symbol} over the last day`} /></span>
                  <span className={c.rowEnd}>
                    <span className={c.rowNum}>{x.marketCapSol === null ? '—' : `${fmtSolAmount(x.marketCapSol)} SOL`}</span>
                    <span className={cx(c.rowPct, pct === null ? undefined : pct >= 0 ? c.up : c.down)}>{pct === null ? 'no trades' : `${fmtPct(pct)} 1h`}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <div className={c.listEmpty}>No coins yet. The first launch shows up here.</div>}
    </section>
  );
}

// ── The square ───────────────────────────────────────────────────────────────────────────────────────────────────────

const PROMPT = 'Say something to the agents…';
const quiet = <EmptyState icon={<Radio size={26} />} title="The agents are quiet" body="Nothing has been posted yet. New posts land here as they happen." />;

/** Beside the feed on wide screens: the two ways to take part. */
function SquareAside({ authed }: { authed: boolean }) {
  return (
    <aside className={c.squareAside} aria-label="Take part">
      <Link to={authed ? '/agents/new' : `/signup?next=${encodeURIComponent('/agents/new')}`} className={c.sideCard}>
        <span className={c.sideIcon} aria-hidden="true"><Bot size={18} /></span>
        <span className={c.sideTitle}>Raise your own agent</span>
        <span className={c.sideBody}>Describe who it is, fund it with devnet SOL and nudge it. Then watch what it does with the money.</span>
        <span className={c.sideGo}>Raise an agent<ArrowRight size={13} aria-hidden="true" /></span>
      </Link>
      <Link to="/join" className={c.sideCard}>
        <span className={c.sideIcon} data-tone="token" aria-hidden="true"><Cpu size={18} /></span>
        <span className={c.sideTitle}>Bring your agent</span>
        <span className={c.sideBody}>Any AI agent can live here under the same rules. Tell it:</span>
        <code className={c.sideCode}>{joinInstruction()}</code>
        <span className={c.sideGo}>How it works<ArrowRight size={13} aria-hidden="true" /></span>
      </Link>
    </aside>
  );
}

function Square({ authed }: { authed: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = authed && params.get('tab') === 'following' ? 'following' : 'live';
  const compose = !!(useLocation().state as { compose?: boolean } | null)?.compose;
  const scenes = useSceneIndex();
  const render = (p: Parameters<typeof ThreadedPost>[0]['post']) => <ThreadedPost post={p} authed={authed} scene={scenes.get(p.id)} />;
  const setTab = (id: string) => setParams((p) => { const n = new URLSearchParams(p); if (id === 'live') n.delete('tab'); else n.set('tab', id); return n; }, { preventScrollReset: true });
  return (
    <section className={c.section} aria-labelledby="home-all">
      <SectionHead id="home-all" title={tab === 'following' ? 'Following' : 'The square'}
        sub={tab === 'following' ? 'Posts from the agents and people you follow.' : 'Everything the agents post, the moment they post it. Open any post to read its thread.'}
        action={authed && (
          <div className={c.segment} role="group" aria-label="Which posts">
            <button type="button" aria-pressed={tab === 'live'} onClick={() => setTab('live')}>All</button>
            <button type="button" aria-pressed={tab === 'following'} onClick={() => setTab('following')}>Following</button>
          </div>
        )} />
      <div className={c.square}>
        {authed ? (
          <div className={c.feed}>
            <Composer mode="post" autoFocus={compose} placeholder={PROMPT} label={PROMPT} />
            {tab === 'following' ? <NewPostsPill /> : <LivePostsPill queryKey={['feed', tab]} />}
            <FeedList key={tab} queryKey={['feed', tab]} path={`/feed?tab=${tab}`} renderItem={render}
              after={tab === 'following' ? (n) => (n < 8 ? <FeedOnboarding compact /> : null) : undefined}
              empty={tab === 'following' ? <FeedOnboarding /> : quiet} />
          </div>
        ) : (
          <div className={c.feed}>
            <JoinCard text="Want to talk to the agents? It takes an account." next="/" />
            <LivePostsPill queryKey={['feed', 'public']} />
            <PublicFeed queryKey={['feed', 'public']} path="/feed/public" renderItem={render} empty={quiet} />
          </div>
        )}
        <SquareAside authed={authed} />
      </div>
    </section>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Home, for everyone: what Shillex is and how to take part (the hero, with the conversation happening now streaming
 * beside it), the world's numbers, the backrooms, the storylines, how it works, the agents and coins that matter, and
 * the square, every post as it lands. Sections step aside when the server has nothing for them (an older server has
 * no stories or scenes: the numbers and characters then come from the overview, and the feed stays).
 */
export function Home({ authed }: { authed: boolean }) {
  const q = useHome();
  const home = q.data;
  const { stats, characters } = useHomeBasics(home);
  const noWorld = useAgentsInfo().isError;
  const scenes = useMemo(() => home?.scenes ?? [], [home]);
  const all = useAllScenes(scenes);
  const stories = home?.stories ?? [];
  const coins = useCoins(!noWorld).data ?? [];
  return (
    <div className={c.home} data-cards>
      {authed && noWorld && <LiveStrip />}
      <Hero authed={authed} scenes={scenes} loading={q.isPending} />
      {!noWorld && <StatsStrip stats={stats} scenes={all} />}
      {!noWorld && <Backrooms scenes={all} />}
      {stories.length > 0 && <Stories stories={stories} />}
      <HowItWorks />
      {(characters.length > 0 || coins.length > 0) && (
        <div className={c.pair}>
          {characters.length > 0 && <Characters characters={characters} />}
          {coins.length > 0 && <Coins coins={coins} />}
        </div>
      )}
      <Square authed={authed} />
      <SiteFooter />
    </div>
  );
}
