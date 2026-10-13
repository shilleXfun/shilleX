import { Link, useParams } from 'react-router';
import { BookOpen } from 'lucide-react';
import { plural, relativeTime, type StoryBeatView, type StoryDetailView, type StoryView } from '@shillex/shared';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Sparkline } from '../../components/ui/Sparkline';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { isNotFound } from '../agents/agentsApi';
import { fmtPct } from '../agents/numbers';
import { KindTag, SceneText, sceneCount } from './Conversation';
import { sceneRunning, useStory } from './homeApi';
import { ConvoBody, ConvoCard, LiveTag } from './ConvoCard';
import { CastList } from './ScenePage';
import c from './home.module.css';
import t from './scene.module.css';

/** A story's coin: its ticker, its last day as a line and the hour's change. */
function StoryCoin({ coin, width = 64, height = 20 }: { coin: NonNullable<StoryView['coin']>; width?: number; height?: number }) {
  const pct = coin.change1hPct;
  return (
    <span className={c.storyCoin}>
      <span className={c.coinSym}>${coin.symbol}</span>
      <Sparkline points={coin.spark} width={width} height={height} label={`${coin.symbol} over the last day`} />
      {pct !== null && <span className={cx(c.pct, pct >= 0 ? c.up : c.down)}>{fmtPct(pct)}</span>}
    </span>
  );
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayClock = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const DAY = 24 * 60 * 60 * 1000;
const stamp = (iso: string) => (Date.now() - Date.parse(iso) < DAY ? clock : dayClock).format(new Date(iso));

/** How a beat reads on the line: money in, money out, a coin's life, a conversation. */
const TONE: Record<string, string> = { launch: 'up', buy: 'up', rise: 'up', join: 'up', rug: 'down', sell: 'down', fall: 'down', split: 'down', trade: 'token', coin: 'token', scene: 'accent', post: 'muted' };

function Beat({ beat, story }: { beat: StoryBeatView; story: StoryDetailView }) {
  const scene = beat.sceneId ? story.scenes.find((s) => s.id === beat.sceneId) : undefined;
  return (
    <li className={c.beat} data-tone={TONE[beat.kind] ?? 'muted'}>
      <time className={c.beatTime} dateTime={beat.at} title={new Date(beat.at).toLocaleString()}>{stamp(beat.at)}</time>
      <span className={c.beatDot} aria-hidden="true" />
      <div className={c.beatBody}>
        <p className={c.beatText}><SceneText text={beat.text} /></p>
        {(beat.postId || beat.mint) && !scene && (
          <span className={c.beatLinks}>
            {beat.postId && <Link to={`/p/${beat.postId}`}>Open the post</Link>}
            {beat.mint && <Link to={`/coins/${beat.mint}`}>Open the coin</Link>}
          </span>
        )}
        {scene && (
          <ConvoCard className={t.embed}
            title={<Link to={`/scenes/${scene.id}`} className={t.embedTitle}><b>{scene.title}</b></Link>}
            status={sceneRunning(scene) ? <LiveTag /> : sceneCount(scene)}>
            <ConvoBody scene={scene} className={t.screen} />
          </ConvoCard>
        )}
      </div>
    </li>
  );
}

function StorySheet({ story }: { story: StoryDetailView }) {
  const timeline = [...story.timeline].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <header className={c.sheet}>
        <div className={c.meta}>
          <KindTag kind={story.kind} />
          <span>{plural(story.beats, 'beat')}</span>
          <span>Began {relativeTime(story.startedAt)} ago</span>
          <span>Latest {relativeTime(story.updatedAt)} ago</span>
        </div>
        <h2 className={c.storyTitle}>{story.headline}</h2>
        <p className={c.storySummary}><SceneText text={story.summary} /></p>
        <div className={c.storyFacts}>
          <CastList cast={story.cast} />
          {story.coin && <Link to={`/coins/${story.coin.mint}`} className={c.storyCoinLink}><StoryCoin coin={story.coin} width={120} height={30} /></Link>}
        </div>
      </header>
      <section className={c.sheet} aria-labelledby="story-timeline">
        <h3 id="story-timeline" className={c.timelineHead}>How it happened</h3>
        {timeline.length ? <ol className={c.timeline}>{timeline.map((b, i) => <Beat key={`${b.at}:${i}`} beat={b} story={story} />)}</ol>
          : <p className={c.footNote}>The first beat is still to come.</p>}
      </section>
    </>
  );
}

/** /stories/:id: a storyline from its first beat, with its conversations shown where they happened. */
export function StoryPage() {
  const { id = '' } = useParams();
  const q = useStory(id);
  return (
    <section aria-labelledby="story-page-title" data-cards className={c.detail}>
      <PageHeader title="Story" titleId="story-page-title" back />
      {q.isPending ? (
        <div className={c.sheet} aria-busy="true" aria-label="Loading story"><Skeleton w="20%" h={12} /><Skeleton w="75%" h={30} /><Skeleton h={14} /><Skeleton w="80%" h={14} /></div>
      ) : q.isError ? (isNotFound(q.error)
        ? <EmptyState icon={<BookOpen size={26} />} title="This story isn’t here" body="It may have ended a while ago, or this server doesn’t tell stories yet." action={<ButtonLink to="/" size="sm">Back to Home</ButtonLink>} />
        : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : <StorySheet story={q.data} />}
    </section>
  );
}
