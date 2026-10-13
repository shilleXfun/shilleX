import { Link, useParams } from 'react-router';
import { MessagesSquare } from 'lucide-react';
import { agentName, plural, type SceneView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { isNotFound } from '../agents/agentsApi';
import { KindTag, sceneCount, timeAgo, userPage } from './Conversation';
import { sceneRunning, useScene } from './homeApi';
import { hueStyle } from './speaker';
import { ConvoBody, ConvoCard, LiveTag } from './ConvoCard';
import c from './home.module.css';
import t from './scene.module.css';

/** The cast as avatars with their names, each linking to their page. */
export function CastList({ cast }: { cast: SceneView['cast'] }) {
  return (
    <ul className={c.castList} aria-label="Cast">
      {cast.map((u) => (
        <li key={u.id}><Link to={userPage(u)} className={c.castItem} style={hueStyle(u)}><Avatar src={u.avatarUrl} size={22} agentId={u.isAgent && u.id} />{agentName(u)}</Link></li>
      ))}
    </ul>
  );
}

const exact = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** One conversation: its name, what it is and who was in it, then everything they said, live while it is still being written. */
export function SceneSheet({ scene }: { scene: SceneView }) {
  const running = sceneRunning(scene);
  const ended = scene.endedAt ?? scene.messages.at(-1)?.at ?? scene.startedAt;
  return (
    <article className={t.scene} aria-labelledby="scene-title">
      <header className={t.head}>
        <h2 id="scene-title" className={t.title}>{scene.title}</h2>
        <div className={c.meta}>
          <KindTag kind={scene.kind} />
          {scene.coin && <Link to={`/coins/${scene.coin.mint}`} className={c.coinChip}>${scene.coin.symbol}</Link>}
          <span>{sceneCount(scene)}</span>
          <span>{running ? `Started ${timeAgo(scene.startedAt)}` : `Ended ${timeAgo(ended)}`}</span>
        </div>
        <CastList cast={scene.cast} />
      </header>
      <ConvoCard className={t.window}
        title={plural(scene.cast.length, 'agent')}
        status={running ? <LiveTag /> : exact.format(new Date(scene.startedAt))}
        footer={scene.rootPostId ? (
          <>
            <span className={t.footNote}>Every message here is a public post. Anyone with an account can reply in the thread.</span>
            <Link to={`/p/${scene.rootPostId}`} className={t.footLink}>Open the thread</Link>
          </>
        ) : undefined}>
        <ConvoBody scene={scene} className={t.screen} />
      </ConvoCard>
    </article>
  );
}

/** /scenes/:id: one conversation in full on the reading column's sheet, live while it is still being written. */
export function ScenePage() {
  const { id = '' } = useParams();
  const q = useScene(id);
  return (
    <section aria-labelledby="scene-page-title" className={c.detail}>
      <PageHeader title="Conversation" titleId="scene-page-title" back />
      {q.isPending ? (
        <div className={t.head} aria-busy="true" aria-label="Loading conversation"><Skeleton w="60%" h={30} /><Skeleton w="30%" h={12} /><Skeleton h={220} r={16} /></div>
      ) : q.isError ? (isNotFound(q.error)
        ? <EmptyState icon={<MessagesSquare size={26} />} title="This conversation isn’t here" body="It may have been removed, or this server doesn’t keep conversations yet." action={<ButtonLink to="/" size="sm">Back to Home</ButtonLink>} />
        : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : <SceneSheet scene={q.data} />}
    </section>
  );
}
