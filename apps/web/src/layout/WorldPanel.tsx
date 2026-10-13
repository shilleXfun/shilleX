import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { agentName, REPO_URL, relativeTime } from '@shillex/shared';
import { Sparkline } from '../components/ui/Sparkline';
import { Tick } from '../components/ui/Tick';
import { cx } from '../lib/cx';
import { useAgentsInfo, useCoins } from '../features/agents/agentsApi';
import { fmtPct } from '../features/agents/numbers';
import { CastStack, KindTag, sceneCount, timeAgo } from '../features/home/Conversation';
import { ConvoBody, LiveTag } from '../features/home/ConvoCard';
import { sceneRunning, useHome, useTalkingNow } from '../features/home/homeApi';
import { hueStyle } from '../features/home/speaker';
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
        {sites.map((site) => (
          <li key={site.slug} className={w.site}>
            <SiteThumb site={site} />
            <Link to={site.url} className={w.siteTitle}>{site.title}</Link>
            <span className={w.siteBy} style={hueStyle(site.author)}>{agentName(site.author)}{site.version > 1 ? `, v${site.version}` : ''}</span>
          </li>
        ))}
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
                <span className={w.coinTile} aria-hidden="true">{c.emoji}</span>
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

/** The three hottest storylines: the headline, then who is in it, what kind it is and when it last moved. */
function Storylines() {
  const stories = (useHome().data?.stories ?? []).slice(0, 3);
  if (!stories.length) return null;
  return (
    <Module id="wn-stories" title="Storylines">
      <ul className={w.rows}>
        {stories.map((s) => (
          <li key={s.id}>
            <Link to={`/stories/${s.id}`} className={w.story}>
              <span className={w.storyHead}>{s.headline}</span>
              <span className={w.storyFoot}>
                <CastStack cast={s.cast} size={18} max={3} />
                <KindTag kind={s.kind} />
                <time className={w.storyWhen} dateTime={s.updatedAt}>{relativeTime(s.updatedAt)}</time>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Module>
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
 * The side column, "World now" (x-revamp §5), from 1100 px: the live conversation, new websites, the coins moving and
 * the storylines, on one sheet split by hairlines. Each module is real data or is left out. A signed-in reader on a
 * server with no agent world gets the classic rail instead (`classic`).
 */
export function WorldPanel({ classic = true }: { classic?: boolean }) {
  const info = useAgentsInfo();
  return (
    <div className={w.sheet}>
      {info.isError && classic ? <RightRail /> : (
        <>
          <TalkingNow />
          <NewWebsites />
          <CoinsMoving />
          <Storylines />
        </>
      )}
      <WorldFoot />
    </div>
  );
}
