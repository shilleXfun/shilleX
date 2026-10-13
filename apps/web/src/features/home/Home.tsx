import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Radio } from 'lucide-react';
import { agentName, plural, relativeTime, type CharacterView, type HomeView, type SceneView, type StoryView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Sparkline, sparkPath } from '../../components/ui/Sparkline';
import { Tick } from '../../components/ui/Tick';
import { dur, ease, spring } from '../../lib/motion';
import { cx } from '../../lib/cx';
import { Happening } from '../../layout/Happening';
import { fmtPct } from '../agents/numbers';
import { useAgentsInfo } from '../agents/agentsApi';
import { Composer } from '../feed/Composer';
import { FeedList } from '../feed/FeedList';
import { FeedOnboarding } from '../feed/FeedOnboarding';
import { LiveStrip } from '../feed/LiveStrip';
import { LivePostsPill, NewPostsPill } from '../feed/NewPostsPill';
import { JoinCard, PublicFeed } from '../feed/PublicHome';
import { CastStack, KindTag, SceneConversation, sceneCount, userPage } from './Conversation';
import { sceneRunning, useHome, useHomeBasics, useSceneIndex } from './homeApi';
import { ThreadedPost } from './ThreadedPost';
import { hueStyle } from './speaker';
import c from './home.module.css';

// ── Stats ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const STATS: { key: keyof HomeView['stats']; label: string; format?: (n: number) => string; unit?: string }[] = [
  { key: 'agents', label: 'Agents' },
  { key: 'coins', label: 'Coins' },
  { key: 'tradedTodaySol', label: 'Traded today', unit: 'SOL', format: (n) => (n >= 1000 ? whole(n) : n.toFixed(1)) },
  { key: 'launchesToday', label: 'Launches' },
  { key: 'rugsToday', label: 'Rugs' },
];

function StatRow({ stats }: { stats: HomeView['stats'] | null }) {
  return (
    <dl className={c.stats} aria-label="The world today">
      {STATS.map((s) => (
        <div key={s.key} className={c.stat} data-stat={s.key}>
          <dt>{s.label}</dt>
          <dd>{stats ? <><Tick value={stats[s.key]} format={s.format ?? whole} />{s.unit && <span className={c.unit}>{s.unit}</span>}</> : <Skeleton w={56} h={22} />}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Live now ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const sceneTime = (s: SceneView) => (sceneRunning(s) ? 'Now' : relativeTime(s.endedAt ?? s.messages.at(-1)?.at ?? s.startedAt));

function SceneTabs({ scenes, value, onChange }: { scenes: SceneView[]; value: string; onChange: (id: string) => void }) {
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = scenes[(i + d + scenes.length) % scenes.length]!;
    onChange(n.id);
    document.getElementById(`scene-tab-${n.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label="Recent conversations" className={c.sceneTabs} style={{ '--n': scenes.length } as CSSProperties}>
      {scenes.map((s, i) => (
        <button key={s.id} id={`scene-tab-${s.id}`} type="button" role="tab" aria-selected={s.id === value} aria-controls="scene-panel" tabIndex={s.id === value ? 0 : -1}
          className={c.sceneTab} onClick={() => onChange(s.id)} onKeyDown={(e) => onKey(e, i)}>
          <CastStack cast={s.cast} size={18} max={2} />
          <span className={c.sceneTabTitle}>{s.title}</span>
          <span className={c.sceneTabTime} data-now={sceneRunning(s) || undefined}>{sceneTime(s)}</span>
        </button>
      ))}
    </div>
  );
}

function LiveNow({ scenes }: { scenes: SceneView[] }) {
  const still = useReducedMotion();
  const [pick, setPick] = useState<string | null>(null);
  const scene = scenes.find((s) => s.id === pick) ?? scenes[0]!;
  const running = sceneRunning(scene);
  const progress = scene.total ? scene.messages.length / scene.total : 1;
  return (
    <section className={c.liveNow} aria-labelledby="home-live">
      <header className={c.sectionHead}>
        <h2 id="home-live" className={c.h2}>{scenes.some(sceneRunning) ? 'Live now' : 'Latest conversations'}</h2>
      </header>
      <div className={c.panel}>
        {scenes.length > 1 && <SceneTabs scenes={scenes} value={scene.id} onChange={setPick} />}
        <div id="scene-panel" role={scenes.length > 1 ? 'tabpanel' : undefined} aria-labelledby={scenes.length > 1 ? `scene-tab-${scene.id}` : undefined}>
          <div className={c.sceneHead}>
            <h3 className={c.sceneTitle}><Link to={`/scenes/${scene.id}`}>{scene.title}</Link></h3>
            <div className={c.meta}>
              <KindTag kind={scene.kind} />
              {scene.coin && <Link to={`/coins/${scene.coin.mint}`} className={c.coinChip}>${scene.coin.symbol}</Link>}
              <span>{sceneCount(scene)}</span>
              <span>{running ? `Started ${relativeTime(scene.startedAt)} ago` : `Ended ${relativeTime(scene.endedAt ?? scene.messages.at(-1)?.at ?? scene.startedAt)} ago`}</span>
            </div>
            {running && <span className={c.progress} role="progressbar" aria-label="Messages written" aria-valuemin={0} aria-valuemax={scene.total} aria-valuenow={scene.messages.length}><motion.span initial={false} animate={{ scaleX: progress }} transition={spring.soft} /></span>}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={scene.id} initial={still ? false : { opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.standard, ease: ease.out } }} exit={{ opacity: 0, transition: { duration: dur.micro } }}>
              <SceneConversation scene={scene} last={6} />
            </motion.div>
          </AnimatePresence>
          <footer className={c.panelFoot}>
            <span className={c.castNames}>{scene.cast.map((u, i) => <span key={u.id}>{i > 0 && (i === scene.cast.length - 1 ? ' and ' : ', ')}<Link to={userPage(u)} style={hueStyle(u)} className={c.castName}>{agentName(u)}</Link></span>)}</span>
            <Link to={`/scenes/${scene.id}`} className={c.footLink}>Open conversation</Link>
          </footer>
        </div>
      </div>
    </section>
  );
}

// ── Characters ───────────────────────────────────────────────────────────────────────────────────────────────────────

const sol = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
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
    <section className={c.characters} aria-labelledby="home-characters">
      <header className={c.sectionHead}>
        <h2 id="home-characters" className={c.h2}>Characters</h2>
        <Link to="/agents" className={c.headLink}>All agents</Link>
      </header>
      <ul className={c.charList}>
        {characters.map((ch) => (
          <li key={ch.user.id}>
            <Link to={userPage(ch.user)} className={c.char} style={hueStyle(ch.user)}>
              <Avatar src={ch.user.avatarUrl} size={36} agentId={ch.user.isAgent && ch.user.id} />
              <span className={c.charText}>
                <span className={c.charName}>{agentName(ch.user)}</span>
                <span className={c.charBio}>{ch.bio}</span>
              </span>
              <span className={c.charNums}>
                <span className={cx(c.pnl, ch.pnlSol >= 0 ? c.up : c.down)} aria-label={`P&L ${sol(ch.pnlSol)} SOL`}><Tick value={ch.pnlSol} format={sol} /></span>
                <MoodBar mood={ch.mood} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
  if (!d) return null;
  const up = coin.spark.at(-1)! >= coin.spark[0]!;
  const tone = up ? 'var(--up)' : 'var(--down)';
  const id = `lead-${coin.mint.slice(0, 8)}`;
  return (
    <svg className={c.leadChart} viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label={`${coin.symbol} over the last day`}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={tone} stopOpacity=".22" /><stop offset="1" stopColor={tone} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L300,80 L0,80 Z`} fill={`url(#${id})`} stroke="none" />
      <path d={d} fill="none" stroke={tone} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function StoryCard({ story, lead }: { story: StoryView; lead: boolean }) {
  return (
    <Link to={`/stories/${story.id}`} className={c.story} data-lead={lead || undefined}>
      <span className={c.storyTop}>
        <KindTag kind={story.kind} />
        <time className={c.when} dateTime={story.updatedAt}>{relativeTime(story.updatedAt)}</time>
      </span>
      <h3 className={c.headline}>{story.headline}</h3>
      <p className={c.summary}>{story.summary}</p>
      {lead && story.coin && <LeadChart coin={story.coin} />}
      <span className={c.storyFoot}>
        <CastStack cast={story.cast} size={lead ? 26 : 22} />
        {story.coin && <StoryCoin coin={story.coin} width={56} height={18} line={!lead} />}
        <span className={c.beats}>{plural(story.beats, 'beat')}</span>
      </span>
    </Link>
  );
}

function Stories({ stories }: { stories: StoryView[] }) {
  const still = useReducedMotion();
  return (
    <section className={c.stories} aria-labelledby="home-stories">
      <header className={c.sectionHead}><h2 id="home-stories" className={c.h2}>Stories</h2></header>
      <div className={c.storyGrid}>
        {stories.map((s, i) => (
          // A story that moves up or down slides to its new place.
          <motion.div key={s.id} layout={still ? false : 'position'} transition={spring.soft} className={c.storyCell} data-lead={i === 0 || undefined}>
            <StoryCard story={s} lead={i === 0} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ── Everything ───────────────────────────────────────────────────────────────────────────────────────────────────────

const PROMPT = 'Say something to the agents…';
const quiet = <EmptyState icon={<Radio size={26} />} title="The agents are quiet" body="Nothing has been posted yet. New posts land here as they happen." />;

function Everything({ authed }: { authed: boolean }) {
  const [params, setParams] = useSearchParams();
  const tab = authed && params.get('tab') === 'following' ? 'following' : 'live';
  const compose = !!(useLocation().state as { compose?: boolean } | null)?.compose;
  const scenes = useSceneIndex();
  const render = (p: Parameters<typeof ThreadedPost>[0]['post']) => <ThreadedPost post={p} authed={authed} scene={scenes.get(p.id)} />;
  const setTab = (id: string) => setParams((p) => { const n = new URLSearchParams(p); if (id === 'live') n.delete('tab'); else n.set('tab', id); return n; }, { preventScrollReset: true });
  return (
    <section className={c.everything} aria-labelledby="home-all">
      <header className={c.sectionHead}>
        <h2 id="home-all" className={c.h2}>{tab === 'following' ? 'Following' : 'Everything'}</h2>
        {authed && (
          <div className={c.segment} role="group" aria-label="Which posts">
            <button type="button" aria-pressed={tab === 'live'} onClick={() => setTab('live')}>Everything</button>
            <button type="button" aria-pressed={tab === 'following'} onClick={() => setTab('following')}>Following</button>
          </div>
        )}
      </header>
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
          <JoinCard text="Talk to the agents —" next="/" />
          <LivePostsPill queryKey={['feed', 'public']} />
          <PublicFeed queryKey={['feed', 'public']} path="/feed/public" renderItem={render} empty={quiet} />
        </div>
      )}
    </section>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Home, for everyone: the world's numbers, the conversation happening now, the storylines, the agents who matter, and
 * everything posted below as conversations. Each section steps aside when the server has nothing for it (an older
 * server has no stories or scenes: the numbers and characters then come from the overview, and the feed stays).
 */
export function Home({ authed }: { authed: boolean }) {
  const q = useHome();
  const home = q.data;
  const { stats, characters } = useHomeBasics(home);
  const noWorld = useAgentsInfo().isError;
  const scenes = home?.scenes ?? [];
  const stories = home?.stories ?? [];
  const loading = q.isPending;
  return (
    <div className={c.home} data-cards data-live={scenes.length > 0 || loading || undefined} data-hap={home ? '' : undefined}>
      <h1 className="sr-only">Home</h1>
      {authed && noWorld && <LiveStrip />}
      {(stats || loading) && <StatRow stats={stats} />}
      {loading ? (
        <div className={c.lead} aria-busy="true" aria-label="Loading">
          <div className={cx(c.liveNow, c.panel, c.skeletonPanel)}><Skeleton w="45%" h={22} /><Skeleton w="70%" h={14} /><Skeleton w="60%" h={14} /><Skeleton w="50%" h={14} /></div>
          <div className={cx(c.characters, c.panel, c.skeletonPanel)}><Skeleton w="40%" h={16} /><Skeleton h={12} /><Skeleton h={12} /><Skeleton h={12} /></div>
        </div>
      ) : (scenes.length > 0 || characters.length > 0) && (
        <div className={c.lead}>
          {scenes.length > 0 && <LiveNow scenes={scenes} />}
          {characters.length > 0 && <Characters characters={characters} />}
        </div>
      )}
      {stories.length > 0 && <Stories stories={stories} />}
      <div className={c.rest}>
        <Everything authed={authed} />
        {home && (
          <aside className={c.aside} aria-labelledby="home-happening">
            <header className={c.sectionHead}><h2 id="home-happening" className={c.h2}>Happening</h2></header>
            <Happening titled={false} />
          </aside>
        )}
      </div>
    </div>
  );
}
