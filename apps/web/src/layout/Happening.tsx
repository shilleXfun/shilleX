import { useMemo } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { plural, relativeTime, type HomeView, type SceneView, type StoryView } from '@shillex/shared';
import { Arrival, useArrivals } from '../components/ui/Arrival';
import { CastStack, KindIcon, sceneCount } from '../features/home/Conversation';
import { sceneRunning, useHome } from '../features/home/homeApi';
import c from '../features/home/home.module.css';

type Row = { key: string; at: string; scene?: SceneView; story?: StoryView };

/** Stories by their latest beat and scenes by when they began, newest first. A story's row is keyed by its beat count, so a new beat brings it to the top. */
function rowsOf(home: HomeView, max: number): Row[] {
  const rows: Row[] = [
    ...home.stories.map((s) => ({ key: `story:${s.id}:${s.beats}`, at: s.updatedAt, story: s })),
    ...home.scenes.map((s) => ({ key: `scene:${s.id}`, at: s.startedAt, scene: s })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

function SceneRow({ scene }: { scene: SceneView }) {
  const now = sceneRunning(scene);
  return (
    <Link to={`/scenes/${scene.id}`} className={c.hapRow}>
      <span className={c.hapLead}><CastStack cast={scene.cast} size={20} max={2} /></span>
      <span className={c.hapText}>
        <span className={c.hapTitle}>{scene.title}</span>
        <span className={c.hapMeta}>{now ? 'Talking now' : 'Conversation'}<span>{sceneCount(scene)}</span></span>
      </span>
      <time className={c.hapTime} dateTime={scene.startedAt} data-now={now || undefined}>{now ? 'Now' : relativeTime(scene.startedAt)}</time>
    </Link>
  );
}

function StoryRow({ story }: { story: StoryView }) {
  return (
    <Link to={`/stories/${story.id}`} className={c.hapRow}>
      <span className={c.hapLead}><KindIcon kind={story.kind} /></span>
      <span className={c.hapText}>
        <span className={c.hapTitle}>{story.headline}</span>
        <span className={c.hapMeta}>Story<span>{plural(story.beats, 'beat')}</span></span>
      </span>
      <time className={c.hapTime} dateTime={story.updatedAt}>{relativeTime(story.updatedAt)}</time>
    </Link>
  );
}

/**
 * Happening: only what moves the world's stories, newest first: a story's new beat, a conversation starting. Nothing
 * on a server without stories (it has none to show). Rows that arrive while it is open slide in.
 */
/** `titled` false leaves the heading to the page (Home sets it above the card, as its other sections are). */
export function Happening({ max = 10, titled = true }: { max?: number; titled?: boolean }) {
  const home = useHome().data;
  const rows = useMemo(() => (home ? rowsOf(home, max) : []), [home, max]);
  const arrival = useArrivals(rows.map((r) => r.key));
  if (!home) return null;
  return (
    <section className={c.happening} aria-labelledby={titled ? 'happening-title' : undefined} aria-label={titled ? undefined : 'Happening'} data-bare={titled ? undefined : ''}>
      {titled && <h2 id="happening-title" className={c.hapHead}>Happening</h2>}
      {rows.length ? (
        <div role="list" className={c.hapList}>
          <AnimatePresence initial={false}>
            {rows.map((r, i) => (
              <Arrival key={r.key} as={arrival(r.key, i)} enter="slide" glow={r.scene ? 'accent' : 'token'}>
                <div role="listitem">{r.scene ? <SceneRow scene={r.scene} /> : <StoryRow story={r.story!} />}</div>
              </Arrival>
            ))}
          </AnimatePresence>
        </div>
      ) : <p className={c.hapQuiet}>Nothing has happened yet. New stories and conversations show up here.</p>}
    </section>
  );
}
