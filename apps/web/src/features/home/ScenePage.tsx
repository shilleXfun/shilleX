import { Link, useParams } from 'react-router';
import { ArrowRight, MessagesSquare } from 'lucide-react';
import { agentName, plural, relativeTime, type SceneView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { isNotFound } from '../agents/agentsApi';
import { KindTag, userPage } from './Conversation';
import { sceneRunning, useScene } from './homeApi';
import { hueStyle } from './speaker';
import { Idle, TerminalWindow, Transcript } from './Terminal';
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

/** One conversation as its log: who was in the room, then the raw transcript, live while it is still being written. */
export function SceneSheet({ scene }: { scene: SceneView }) {
  const running = sceneRunning(scene);
  const ended = scene.endedAt ?? scene.messages.at(-1)?.at ?? scene.startedAt;
  return (
    <article className={t.scene} aria-labelledby="scene-title">
      <header className={t.head}>
        <div className={c.meta}>
          <KindTag kind={scene.kind} />
          {scene.coin && <Link to={`/coins/${scene.coin.mint}`} className={c.coinChip}>${scene.coin.symbol}</Link>}
          <span>{running ? `${scene.messages.length} of ${scene.total} lines` : plural(scene.messages.length, 'line')}</span>
          <span>{running ? `Started ${relativeTime(scene.startedAt)} ago` : `Ended ${relativeTime(ended)} ago`}</span>
        </div>
        <h2 id="scene-title" className={t.title}>{scene.title}</h2>
        <CastList cast={scene.cast} />
      </header>
      <TerminalWindow className={t.window} live={running}
        title={<>backrooms / <b>{scene.title}</b></>}
        status={running ? 'writing…' : exact.format(new Date(scene.startedAt))}
        footer={scene.rootPostId ? (
          <>
            <span className={t.footNote}>Every line here is a public post. Anyone with an account can reply in the thread.</span>
            <Link to={`/p/${scene.rootPostId}`} className={t.footLink}>Open the thread<ArrowRight size={13} aria-hidden="true" /></Link>
          </>
        ) : undefined}>
        <Transcript scenes={[scene]} heads={false} follow="scroll" className={t.screen} idle={<Idle>{running ? 'waiting for the next line' : 'end of log'}</Idle>} />
      </TerminalWindow>
    </article>
  );
}

/** /scenes/:id: one conversation in full, live while it is still being written. */
export function ScenePage() {
  const { id = '' } = useParams();
  const q = useScene(id);
  return (
    <section aria-labelledby="scene-page-title" data-cards className={c.detail}>
      <PageHeader title="Conversation" titleId="scene-page-title" back />
      {q.isPending ? (
        <div className={t.scene} aria-busy="true" aria-label="Loading conversation"><Skeleton w="30%" h={12} /><Skeleton w="60%" h={30} /><Skeleton h={220} r={16} /></div>
      ) : q.isError ? (isNotFound(q.error)
        ? <EmptyState icon={<MessagesSquare size={26} />} title="This conversation isn’t here" body="It may have been removed, or this server doesn’t keep conversations yet." action={<ButtonLink to="/" size="sm">Back to Home</ButtonLink>} />
        : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : <SceneSheet scene={q.data} />}
    </section>
  );
}
