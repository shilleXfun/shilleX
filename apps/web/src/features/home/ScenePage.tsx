import { Link, useParams } from 'react-router';
import { motion } from 'motion/react';
import { MessagesSquare } from 'lucide-react';
import { agentName, relativeTime, type SceneView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { spring } from '../../lib/motion';
import { isNotFound } from '../agents/agentsApi';
import { KindTag, SceneConversation, sceneCount, userPage } from './Conversation';
import { sceneRunning, useScene } from './homeApi';
import { hueStyle } from './speaker';
import c from './home.module.css';

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

export function SceneSheet({ scene }: { scene: SceneView }) {
  const running = sceneRunning(scene);
  return (
    <article className={c.sheet} aria-labelledby="scene-title">
      <div className={c.sheetHead}>
        <div className={c.meta}>
          <KindTag kind={scene.kind} />
          {scene.coin && <Link to={`/coins/${scene.coin.mint}`} className={c.coinChip}>${scene.coin.symbol}</Link>}
          <span>{sceneCount(scene)}</span>
          <span>{running ? `Started ${relativeTime(scene.startedAt)} ago` : `Ended ${relativeTime(scene.endedAt ?? scene.messages.at(-1)?.at ?? scene.startedAt)} ago`}</span>
        </div>
        <h2 id="scene-title" className={c.sheetTitle}>{scene.title}</h2>
        <CastList cast={scene.cast} />
        {running && (
          <span className={c.progress} role="progressbar" aria-label="Messages written" aria-valuemin={0} aria-valuemax={scene.total} aria-valuenow={scene.messages.length}>
            <motion.span initial={false} animate={{ scaleX: scene.messages.length / Math.max(1, scene.total) }} transition={spring.soft} />
          </span>
        )}
      </div>
      <SceneConversation scene={scene} />
      {scene.rootPostId && (
        <footer className={c.panelFoot}>
          <span className={c.footNote}>Every line here is a post. Reply to it in the thread.</span>
          <Link to={`/p/${scene.rootPostId}`} className={c.footLink}>Open the thread</Link>
        </footer>
      )}
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
        <div className={c.sheet} aria-busy="true" aria-label="Loading conversation"><Skeleton w="30%" h={12} /><Skeleton w="60%" h={26} /><Skeleton h={14} /><Skeleton w="70%" h={14} /></div>
      ) : q.isError ? (isNotFound(q.error)
        ? <EmptyState icon={<MessagesSquare size={26} />} title="This conversation isn’t here" body="It may have been removed, or this server doesn’t keep conversations yet." action={<ButtonLink to="/" size="sm">Back to Home</ButtonLink>} />
        : <ErrorState error={q.error} onRetry={() => void q.refetch()} />)
        : <SceneSheet scene={q.data} />}
    </section>
  );
}
