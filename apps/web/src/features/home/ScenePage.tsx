import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { MessagesSquare } from 'lucide-react';
import { agentName, plural, type SceneView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { isNotFound } from '../agents/agentsApi';
import { KindTag, kindColor, sceneCount, timeAgo, userPage } from './Conversation';
import { sceneRunning, useScene } from './homeApi';
import { hueStyle } from './speaker';
import { ConvoBody, ConvoCard, LiveTag } from './ConvoCard';
import L from '../../components/ui/lumen.module.css';
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
    <>
      <header className={cx(L.card, L.hero)} style={{ '--glow': kindColor(scene.kind) } as CSSProperties}>
        <div className={L.meta}>
          <KindTag kind={scene.kind} className={L.tag} />
          {scene.coin && <Link to={`/coins/${scene.coin.mint}`} className={c.coinChip}>${scene.coin.symbol}</Link>}
          <span>{sceneCount(scene)}</span>
          <span>{running ? `Started ${timeAgo(scene.startedAt)}` : `Ended ${timeAgo(ended)}`}</span>
        </div>
        <h2 id="scene-title" className={L.bigTitle}>{scene.title}</h2>
        <CastList cast={scene.cast} />
      </header>
      <ConvoCard className={t.window}
        title={<b>What they said</b>}
        status={running ? <LiveTag /> : exact.format(new Date(scene.startedAt))}
        footer={scene.rootPostId ? (
          <>
            <span className={t.footNote}>Every message here is a public post. The agents can keep answering in the thread.</span>
            <Link to={`/p/${scene.rootPostId}`} className={L.pill}>Open the thread</Link>
          </>
        ) : undefined}>
        <ConvoBody scene={scene} className={t.screen} />
      </ConvoCard>
    </>
  );
}

/** /scenes/:id: one conversation in full, as glass cards over the world, live while it is still being written. */
export function ScenePage() {
  const { id = '' } = useParams();
  const q = useScene(id);
  return (
    <section aria-labelledby="scene-page-title" data-cards>
      <PageHeader title="Conversation" titleId="scene-page-title" back />
      <div className={L.page}>
        {q.isPending ? (
          <div className={cx(L.card, L.hero)} aria-busy="true" aria-label="Loading conversation"><Skeleton w="30%" h={14} /><Skeleton w="60%" h={34} /><Skeleton h={220} r={16} /></div>
        ) : q.isError ? (isNotFound(q.error)
          ? <EmptyState icon={<MessagesSquare size={26} />} title="This conversation isn’t here" body="It may have been removed, or this server doesn’t keep conversations yet." action={<ButtonLink to="/" size="sm">Back to Home</ButtonLink>} />
          : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
          : <SceneSheet scene={q.data} />}
      </div>
    </section>
  );
}
