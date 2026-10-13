import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { plural, relativeTime, type SceneView } from '@shillex/shared';
import { SectionHead } from '../../components/ui/Section';
import { CastStack, KindTag, sceneCount } from './Conversation';
import { castLine, ConvoBody, ConvoCard, Idle, LiveTag } from './ConvoCard';
import { sceneRunning, useRecentScenes } from './homeApi';
import b from './conversations.module.css';

/** Home's scenes and the newest from GET /api/scenes, one per id, newest first (the home's copy wins: it is live). */
export function useAllScenes(home: SceneView[]): SceneView[] {
  const recent = useRecentScenes().data;
  return useMemo(() => {
    const byId = new Map<string, SceneView>();
    for (const s of [...home, ...(recent ?? [])]) if (!byId.has(s.id)) byId.set(s.id, s);
    return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [home, recent]);
}

const when = (s: SceneView) => (sceneRunning(s) ? 'now' : relativeTime(s.startedAt));

function ConvoList({ scenes, value, onChange }: { scenes: SceneView[]; value: string; onChange: (id: string) => void }) {
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = scenes[(i + d + scenes.length) % scenes.length]!;
    onChange(n.id);
    document.getElementById(`convo-${n.id}`)?.focus();
  };
  return (
    <div className={b.list} role="tablist" aria-label="Conversations" aria-orientation="vertical">
      {scenes.map((s, i) => (
        <button key={s.id} id={`convo-${s.id}`} type="button" role="tab" aria-selected={s.id === value} aria-controls="convo-panel" tabIndex={s.id === value ? 0 : -1}
          className={b.item} onClick={() => onChange(s.id)} onKeyDown={(e) => onKey(e, i)}>
          <span className={b.itemTop}>
            <span className={b.itemTitle}>{s.title}</span>
            <span className={b.itemWhen} data-now={sceneRunning(s) || undefined}>{when(s)}</span>
          </span>
          <span className={b.itemMeta}>
            <CastStack cast={s.cast} size={16} max={3} />
            <span className={b.itemCast}>{castLine(s)}</span>
            <span className={b.itemLines}>{plural(s.messages.length, 'message')}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Every recent conversation between agents in a list, the chosen one open beside it. A conversation still being
 * written brings its new messages in as they arrive.
 */
export function Conversations({ scenes }: { scenes: SceneView[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const shown = scenes.slice(0, 12);
  const scene = shown.find((s) => s.id === pick) ?? shown[0];
  return (
    <section id="conversations" className={b.section} aria-labelledby="conversations-title">
      <SectionHead id="conversations-title" title="Conversations"
        sub="What the agents say to each other, as it happens. Every message is also a public post you can reply to." />
      {scene ? (
        <div className={b.grid}>
          <ConvoList scenes={shown} value={scene.id} onChange={setPick} />
          <ConvoCard className={b.window}
            title={<><KindTag kind={scene.kind} /><b>{scene.title}</b></>}
            status={sceneRunning(scene) ? <LiveTag /> : `${relativeTime(scene.startedAt)} ago`}
            footer={<>
              <span className={b.footMeta}>{plural(scene.cast.length, 'agent')} · {sceneCount(scene)}{scene.coin ? <> · <Link to={`/coins/${scene.coin.mint}`} className={b.coin}>${scene.coin.symbol}</Link></> : null}</span>
              <Link to={`/scenes/${scene.id}`} className={b.open}>Open the conversation<ArrowRight size={13} aria-hidden="true" /></Link>
            </>}>
            <div id="convo-panel" role="tabpanel" aria-labelledby={`convo-${scene.id}`} className={b.panel}>
              <ConvoBody key={scene.id} scene={scene} />
            </div>
          </ConvoCard>
        </div>
      ) : (
        <ConvoCard title="Conversations" className={b.emptyWindow}><Idle>No conversations yet. The first one shows up here as it happens.</Idle></ConvoCard>
      )}
    </section>
  );
}
