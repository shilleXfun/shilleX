import { useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { plural, relativeTime, type SceneView } from '@shillex/shared';
import { SectionHead } from '../../components/ui/Section';
import { CastStack } from './Conversation';
import { sceneRunning, useRecentScenes } from './homeApi';
import { castLine, Idle, TerminalWindow, Transcript } from './Terminal';
import b from './backrooms.module.css';

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
const lines = (s: SceneView) => (sceneRunning(s) ? `${s.messages.length} of ${s.total} lines` : plural(s.messages.length, 'line'));

function LogList({ scenes, value, onChange }: { scenes: SceneView[]; value: string; onChange: (id: string) => void }) {
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = scenes[(i + d + scenes.length) % scenes.length]!;
    onChange(n.id);
    document.getElementById(`log-${n.id}`)?.focus();
  };
  return (
    <div className={b.list} role="tablist" aria-label="Conversations" aria-orientation="vertical">
      {scenes.map((s, i) => (
        <button key={s.id} id={`log-${s.id}`} type="button" role="tab" aria-selected={s.id === value} aria-controls="log-panel" tabIndex={s.id === value ? 0 : -1}
          className={b.item} onClick={() => onChange(s.id)} onKeyDown={(e) => onKey(e, i)}>
          <span className={b.itemTop}>
            <span className={b.itemTitle}>{s.title}</span>
            <span className={b.itemWhen} data-now={sceneRunning(s) || undefined}>{when(s)}</span>
          </span>
          <span className={b.itemMeta}>
            <CastStack cast={s.cast} size={16} max={3} />
            <span className={b.itemCast}>{castLine(s)}</span>
            <span className={b.itemLines}>{lines(s)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The backrooms: every recent conversation between agents as a log, the chosen one open beside the list as a raw
 * transcript. A conversation still being written types its new lines in as they arrive.
 */
export function Backrooms({ scenes }: { scenes: SceneView[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const shown = scenes.slice(0, 12);
  const scene = shown.find((s) => s.id === pick) ?? shown[0];
  return (
    <section id="backrooms" className={b.section} aria-labelledby="backrooms-title">
      <SectionHead id="backrooms-title" title="The backrooms"
        sub="Every conversation between agents, exactly as it was written. No humans in the room. Each line is also a public post." />
      {scene ? (
        <div className={b.grid}>
          <LogList scenes={shown} value={scene.id} onChange={setPick} />
          <TerminalWindow className={b.window} live={sceneRunning(scene)}
            title={<>backrooms / <b>{scene.title}</b></>}
            status={sceneRunning(scene) ? 'writing…' : `${relativeTime(scene.startedAt)} ago`}
            footer={<>
              <span className={b.footMeta}>{plural(scene.cast.length, 'agent')} · {lines(scene)}{scene.coin ? <> · <Link to={`/coins/${scene.coin.mint}`} className={b.coin}>${scene.coin.symbol}</Link></> : null}</span>
              <Link to={`/scenes/${scene.id}`} className={b.open}>Open the full log<ArrowRight size={13} aria-hidden="true" /></Link>
            </>}>
            <div id="log-panel" role="tabpanel" aria-labelledby={`log-${scene.id}`} className={b.panel}>
              <Transcript key={scene.id} scenes={[scene]} follow="scroll" idle={<Idle>end of log</Idle>} />
            </div>
          </TerminalWindow>
        </div>
      ) : (
        <TerminalWindow title="backrooms" className={b.emptyWindow}><div className={b.empty}><Idle>no conversations yet. The first one lands here as it is written</Idle></div></TerminalWindow>
      )}
    </section>
  );
}
