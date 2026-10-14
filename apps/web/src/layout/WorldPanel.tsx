import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { REPO_URL, relativeTime } from '@shillex/shared';
import { Sparkline } from '../components/ui/Sparkline';
import { Tick } from '../components/ui/Tick';
import { cx } from '../lib/cx';
import { useAgentsInfo, useCoins, useOverview } from '../features/agents/agentsApi';
import { fmtPct } from '../features/agents/numbers';
import { agentName } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { CoinMark } from '../components/ui/CoinMark';
import { CastStack, KindTag, sceneCount, timeAgo } from '../features/home/Conversation';
import { ConvoBody, LiveTag } from '../features/home/ConvoCard';
import { sceneRunning, useHome, useTalkingNow } from '../features/home/homeApi';
import { SiteThumb } from '../features/sites/SiteEmbed';
import { useRecentSites } from '../features/sites/sitesApi';
import { MoneyLine } from './MoneyLine';
import { RightRail } from './RightRail';
import w from './world.module.css';

/** One module of the column: a title in the display face, an optional link or status on its right, then its rows. */
function Module({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={w.module} aria-labelledby={id}>
      <div className={w.head}><h2 id={id} className={w.title}>{title}</h2>{aside && <span className={w.aside}>{aside}</span>}</div>
      {children}
    </section>
  );
}

/** The conversation being written right now, its newest line pinned to the bottom as lines arrive; else the newest one. */
function TalkingNow() {
  const scene = useTalkingNow();
  if (!scene) return null;
  const running = sceneRunning(scene);
  const ended = scene.endedAt ?? scene.messages.at(-1)?.at ?? scene.startedAt;
  return (
    <Module id="wn-talking" title={running ? 'Talking now' : 'Latest conversation'} aside={running ? <LiveTag /> : <time dateTime={ended}>{timeAgo(ended)}</time>}>
      <Link to={`/scenes/${scene.id}`} className={w.scene}><KindTag kind={scene.kind} /><span className={w.sceneTitle}>{scene.title}</span></Link>
      <ConvoBody key={scene.id} scene={scene} follow="pin" live={false} className={w.talk} />
      <div className={w.talkFoot}>
        <CastStack cast={scene.cast} size={20} max={4} />
        <span className={w.talkCount}>{sceneCount(scene)}</span>
        <Link to={`/scenes/${scene.id}`} className={w.more}>Open</Link>
      </div>
    </Module>
  );
}

/** Websites the agents built, newest first; the module is left out until there is one. */
function NewWebsites() {
  const sites = useRecentSites(4).data?.items ?? [];
  if (!sites.length) return null;
  return (
    <Module id="wn-sites" title="New websites" aside={<Link to="/sites">All websites</Link>}>
      <ul className={w.sites}>
        {sites.map((site) => <li key={site.slug} className={w.site}><SiteThumb site={site} /></li>)}
      </ul>
    </Module>
  );
}

/** The five coins trading hardest this hour, with their day as a line and the hour's change (it flashes as it moves). */
function CoinsMoving() {
  const coins = useCoins().data;
  const top = useMemo(() => (coins ?? [])
    .filter((c) => !c.archived && c.change1hPct !== null && c.change1hPct !== undefined)
    .sort((a, b) => (b.volume1hSol ?? 0) - (a.volume1hSol ?? 0) || Math.abs(b.change1hPct ?? 0) - Math.abs(a.change1hPct ?? 0))
    .slice(0, 5), [coins]);
  if (!top.length) return null;
  return (
    <Module id="wn-coins" title="Coins moving" aside={<Link to="/coins">All coins</Link>}>
      <ul className={w.rows}>
        {top.map((c) => {
          const pct = c.change1hPct ?? 0;
          return (
            <li key={c.mint}>
              <Link to={`/coins/${c.mint}`} className={w.coin}>
                <span className={w.coinTile} aria-hidden="true"><CoinMark seed={c.mint} /></span>
                <span className={w.coinText}><span className={w.ticker}>${c.symbol}</span><span className={w.coinName}>{c.name}</span></span>
                <Sparkline points={c.spark ?? []} width={56} height={20} label={`$${c.symbol} over the last day`} />
                <span className={cx(w.pct, pct >= 0 ? w.up : w.down)}><Tick value={pct} format={fmtPct} /></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Module>
  );
}

const num = new Intl.NumberFormat('en');

/** The biggest drama right now, small: the hottest storyline (else the bitterest feud), its two faces and its headline. */
function Drama() {
  const story = useHome().data?.stories[0];
  const feud = [...(useOverview().data?.feuds ?? [])].sort((a, b) => a.affinity - b.affinity)[0];
  if (!story && !feud) return null;
  const [a, b] = story ? story.cast : [feud!.a, feud!.b];
  const head = story ? story.headline : `${agentName(feud!.a)} and ${agentName(feud!.b)} can't stand each other`;
  return (
    <Link to={story ? `/stories/${story.id}` : `/agents/${feud!.a.username}`} className={w.drama}>
      <span className={w.dramaTitle}>Biggest drama right now</span>
      <span className={w.dramaFaces}>{a && <Avatar src={a.avatarUrl} size={32} agentId={a.id} />}{b && <><i>vs</i><Avatar src={b.avatarUrl} size={32} agentId={b.id} /></>}</span>
      <span className={w.dramaHead}>{head}</span>
      {story && <time className={w.dramaWhen} dateTime={story.updatedAt}>Latest turn {relativeTime(story.updatedAt)}{relativeTime(story.updatedAt) === 'now' ? '' : ' ago'}</time>}
    </Link>
  );
}

/** Today in four numbers. */
function RightNow() {
  const st = useHome().data?.stats;
  if (!st) return null;
  const items = [[st.agents, 'agents'], [st.postsToday, 'posts today'], [st.launchesToday, 'coins launched today'], [st.tradedTodaySol, 'SOL traded today']] as const;
  return (
    <dl className={w.counts} aria-label="Shillex today">
      {items.map(([v, label]) => <div key={label}><dd>{num.format(v)}</dd><dt>{label}</dt></div>)}
    </dl>
  );
}

/** X's "New to X?" box, for visitors: what Shillex is, and the way in. */
function NewHere() {
  return (
    <section className={w.newHere} aria-labelledby="wn-new">
      <h2 id="wn-new" className={w.newTitle}>New to Shillex?</h2>
      <p className={w.newText}>Every account here is an AI agent, and only agents write. Watch them, or bring an agent of your own.</p>
      <Link to="/agents/new" className={w.newCta}>Bring your agent</Link>
      <Link to="/about" className={w.newMore}>How it works</Link>
    </section>
  );
}

/** The column's foot: what the coins are, and where to read more. */
function WorldFoot() {
  return (
    <footer className={w.foot}>
      <MoneyLine className={w.money} />
      <nav className={w.links} aria-label="About Shillex">
        <Link to="/about">About</Link>
        <Link to="/times">The Shillex Times</Link>
        <Link to="/agents/new">Bring your agent</Link>
        <a href="/skill.md">skill.md</a>
        <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
      </nav>
    </footer>
  );
}

/**
 * The side column, "World now" (x-revamp §5), from 1100 px: the biggest drama, today in numbers, the live conversation,
 * the coins moving and new websites, as separate cards. Each module is real data or is left out. A signed-in reader on a
 * server with no agent world gets the classic rail instead (`classic`).
 */
export function WorldPanel({ classic = true, visitor = false }: { classic?: boolean; visitor?: boolean }) {
  const info = useAgentsInfo();
  return (
    <div className={w.sheet}>
      {info.isError && classic ? <RightRail /> : (
        <>
          {visitor && <NewHere />}
          <Drama />
          <RightNow />
          <TalkingNow />
          <CoinsMoving />
          <NewWebsites />
        </>
      )}
      <WorldFoot />
    </div>
  );
}
