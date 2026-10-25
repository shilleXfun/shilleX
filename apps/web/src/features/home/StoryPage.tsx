import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, BookOpen } from 'lucide-react';
import { plural, type StoryBeatView, type StoryDetailView, type StoryView } from '@shillex/shared';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Sparkline } from '../../components/ui/Sparkline';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { isNotFound } from '../agents/agentsApi';
import { fmtPct } from '../agents/numbers';
import { KindTag, SceneText, kindColor, sceneCount, timeAgo } from './Conversation';
import { sceneRunning, useStory } from './homeApi';
import { ConvoBody, ConvoCard, LiveTag } from './ConvoCard';
import { CastList } from './ScenePage';
import L from '../../components/ui/lumen.module.css';
import c from './home.module.css';
import t from './scene.module.css';
import { LOCALE } from '../../lib/locale';

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

const clock = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dayClock = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const DAY = 24 * 60 * 60 * 1000;
const stamp = (iso: string) => (Date.now() - Date.parse(iso) < DAY ? clock : dayClock).format(new Date(iso));

/** How a beat reads on the line: money in, money out, a coin's life, a conversation. */
const TONE: Record<string, string> = { launch: 'up', buy: 'up', rise: 'up', join: 'up', rug: 'down', sell: 'down', fall: 'down', split: 'down', trade: 'token', coin: 'token', scene: 'accent', post: 'muted' };

function Beat({ beat, story }: { beat: StoryBeatView; story: StoryDetailView }) {
  const scene = beat.sceneId ? story.scenes.find((s) => s.id === beat.sceneId) : undefined;
  const coinLink = beat.mint && beat.mint !== story.coin?.mint;
  return (
    <li className={c.beat} data-tone={TONE[beat.kind]}>
      <time className={c.beatTime} dateTime={beat.at} title={new Date(beat.at).toLocaleString(LOCALE)}>{stamp(beat.at)}</time>
      <span className={c.beatDot} aria-hidden="true" />
      <div className={c.beatBody}>
        <p className={c.beatText}><SceneText text={beat.text} /></p>
        {/* Small links, and the coin only when it is not the story's own coin (that one is in the hero, once). */}
        {(beat.postId || coinLink) && !scene && (
          <span className={c.beatLinks}>
            {beat.postId && <Link to={`/p/${beat.postId}`} className={c.beatLink}>Open the post<ArrowRight size={13} aria-hidden="true" /></Link>}
            {coinLink && <Link to={`/coins/${beat.mint}`} className={c.beatLink}>Open the coin<ArrowRight size={13} aria-hidden="true" /></Link>}
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

/** The story itself: a hero with what happened and who was in it, then every beat from the first. */
function StorySheet({ story }: { story: StoryDetailView }) {
  const timeline = [...story.timeline].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <header className={cx(L.card, L.hero)} style={{ '--glow': kindColor(story.kind) } as CSSProperties}>
        <div className={L.meta}>
          <KindTag kind={story.kind} className={L.tag} />
          <span>{plural(story.beats, 'beat')}</span>
          <span>Began {timeAgo(story.startedAt)}</span>
          <span>Latest {timeAgo(story.updatedAt)}</span>
        </div>
        <h2 className={L.bigTitle}>{story.headline}</h2>
        <p className={L.lede}><SceneText text={story.summary} /></p>
        <div className={c.storyFacts}>
          <CastList cast={story.cast} />
          {story.coin && <Link to={`/coins/${story.coin.mint}`} className={c.storyCoinLink}><StoryCoin coin={story.coin} width={120} height={30} /></Link>}
        </div>
      </header>
      <section className={L.card} aria-labelledby="story-timeline">
        <div className={L.head}>
          <h3 id="story-timeline" className={L.title}>How it happened</h3>
          {timeline.length > 1 && <span className={L.note}>From the first beat to the latest</span>}
        </div>
        {timeline.length ? <ol className={c.timeline} style={{ '--story-tone': kindColor(story.kind) } as CSSProperties}>{timeline.map((b, i) => <Beat key={`${b.at}:${i}`} beat={b} story={story} />)}</ol>
          : <p className={L.empty}>The first beat is still to come.</p>}
      </section>
    </>
  );
}

/** /stories/:id: a storyline from its first beat, as glass cards over the world, with its conversations shown where they happened. */
export function StoryPage() {
  const { id = '' } = useParams();
  const q = useStory(id);
  return (
    <section aria-labelledby="story-page-title" data-cards>
      <PageHeader title="Story" titleId="story-page-title" back />
      <div className={L.page}>
        {q.isPending ? (
          <div className={cx(L.card, L.hero)} aria-busy="true" aria-label="Loading story"><Skeleton w="20%" h={14} /><Skeleton w="75%" h={34} /><Skeleton h={16} /><Skeleton w="80%" h={16} /></div>
        ) : q.isError ? (isNotFound(q.error)
          ? <EmptyState icon={<BookOpen size={26} />} title="This story isn’t here" body="It may have ended a while ago, or this server doesn’t tell stories yet." action={<ButtonLink to="/" size="sm">Back to Home</ButtonLink>} />
          : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
          : <StorySheet story={q.data} />}
      </div>
    </section>
  );
}
