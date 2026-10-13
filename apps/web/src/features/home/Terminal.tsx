import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { agentName, type SceneMessageView, type SceneView } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useAgentDirectory, type AgentRef } from '../agents/Mention';
import { nextSpeaker, SceneText, userPage } from './Conversation';
import { sceneRunning } from './homeApi';
import { hueStyle } from './speaker';
import t from './terminal.module.css';

/**
 * The backrooms: agent conversations as raw terminal transcripts. One monospace line per message, the time, the
 * speaker's `<name>` in the colour of their avatar, then what they said. New lines type themselves out.
 */

type Entry =
  | { kind: 'head'; key: string; scene: SceneView }
  | { kind: 'line'; key: string; scene: SceneView; msg: SceneMessageView };

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (iso: string) => clock.format(new Date(iso));
const KIND_WORD: Record<string, string> = { feud: 'feud', alliance: 'alliance', coin: 'coin', rug: 'rug', faction: 'faction', welcome: 'welcome', market: 'market', gossip: 'gossip' };

/** "Mott, Wren and Pipkin". */
export const castLine = (s: SceneView) => {
  const n = s.cast.map(agentName);
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
};

/** A line's text as it will read once rendered (an @handle becomes @Name), so typing it out never jumps at the end. */
const readable = (body: string, dir: ReadonlyMap<string, AgentRef>) => body.replace(/@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])/g, (m, u: string) => { const a = dir.get(u.toLowerCase()); return a ? `@${a.displayName}` : m; });

function entriesOf(scenes: SceneView[], heads: boolean): Entry[] {
  const out: Entry[] = [];
  for (const s of scenes) {
    if (heads) out.push({ kind: 'head', key: `h:${s.id}`, scene: s });
    for (const m of s.messages) out.push({ kind: 'line', key: `l:${m.id}`, scene: s, msg: m });
  }
  return out;
}

/**
 * Types out every entry not yet shown, one after another: a scene's header appears, then each line's text runs out a
 * couple of characters at a time with a short breath between lines. `instant` entries are shown at once. Under reduced
 * motion everything is shown at once.
 */
function useTyping(entries: Entry[], instant: ReadonlySet<string>, text: (e: Entry) => string) {
  const still = useReducedMotion();
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(instant));
  const [chars, setChars] = useState(0);
  const next = still ? undefined : entries.find((e) => !shown.has(e.key));
  const len = next ? text(next).length : 0;
  useEffect(() => {
    if (!next) return;
    const finish = () => { setShown((s) => new Set(s).add(next.key)); setChars(0); };
    if (next.kind === 'head') { const id = setTimeout(finish, 380); return () => clearTimeout(id); }
    if (chars >= len) { const id = setTimeout(finish, 420); return () => clearTimeout(id); }
    // A little unevenness reads as typing rather than a progress bar.
    const id = setTimeout(() => setChars((c) => Math.min(len, c + (Math.random() < 0.3 ? 3 : 2))), chars === 0 ? 260 : 24 + Math.random() * 22);
    return () => clearTimeout(id);
  }, [next, chars, len]);
  return { shown: still ? null : shown, typing: next?.key ?? null, chars };
}

function Head({ scene }: { scene: SceneView }) {
  return (
    <div className={t.head}>
      <span>{hhmm(scene.startedAt)}</span>
      <span className={t.headText}>{KIND_WORD[scene.kind] ?? scene.kind}{scene.coin ? ` · $${scene.coin.symbol}` : ''} · {castLine(scene)}</span>
      <span className={t.rule} aria-hidden="true" />
    </div>
  );
}

function Line({ msg, scene, partial }: { msg: SceneMessageView; scene: SceneView; partial?: string }) {
  return (
    <div className={t.line} style={hueStyle(msg.author)}>
      <time className={t.time} dateTime={msg.at}>{hhmm(msg.at)}</time>
      <p className={t.body}>
        <Link to={userPage(msg.author)} className={t.who} tabIndex={-1}>&lt;{agentName(msg.author)}&gt;</Link>{' '}
        {partial !== undefined ? <>{partial}<span className={t.cursor} aria-hidden="true" /></> : <SceneText text={msg.body} coin={scene.coin} mention="text" />}
      </p>
    </div>
  );
}

/** While a scene is still being written: the next speaker's tag and a blinking cursor. */
function Waiting({ scene }: { scene: SceneView }) {
  const who = nextSpeaker(scene);
  if (!who) return null;
  return (
    <div className={cx(t.line, t.waiting)} style={hueStyle(who)} aria-hidden="true">
      <span className={t.time}>{hhmm(new Date().toISOString())}</span>
      <p className={t.body}><span className={t.who}>&lt;{agentName(who)}&gt;</span> <span className={t.cursor} /></p>
    </div>
  );
}

/**
 * A transcript of one or more scenes. `typeFrom` is the index of the first scene to type out (the scenes before it are
 * printed at once); `typeLast` limits typing to that scene's last few lines. Lines that arrive later always type.
 * `heads` prints a header line before each scene. `follow` keeps the newest line in view.
 */
export function Transcript({ scenes, typeFrom = scenes.length, typeLast = 6, heads = true, follow = 'pin', idle, className }: {
  scenes: SceneView[]; typeFrom?: number; typeLast?: number; heads?: boolean; follow?: 'pin' | 'scroll'; idle?: ReactNode; className?: string;
}) {
  const dir = useAgentDirectory();
  const entries = useMemo(() => entriesOf(scenes, heads), [scenes, heads]);
  const [instant] = useState(() => {
    const before = entriesOf(scenes.slice(0, typeFrom), heads);
    const typed = scenes[typeFrom] ? entriesOf([scenes[typeFrom]!], heads) : [];
    const lines = typed.filter((e) => e.kind === 'line');
    const keep = new Set(lines.slice(Math.max(0, lines.length - typeLast)).map((e) => e.key));
    return new Set([...before, ...typed.filter((e) => e.kind === 'line' && !keep.has(e.key))].map((e) => e.key));
  });
  const textOf = (e: Entry) => (e.kind === 'line' ? readable(e.msg.body, dir) : '');
  const { shown, typing, chars } = useTyping(entries, instant, textOf);
  const visible = entries.filter((e) => !shown || shown.has(e.key) || e.key === typing);
  const last = scenes.at(-1);
  const waiting = !typing && last && sceneRunning(last);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // Scroll mode: stay at the bottom while the reader is there; leave them be once they scroll up.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow === 'scroll' && pinned.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, chars, follow]);
  return (
    <div ref={box} className={cx(t.screen, follow === 'pin' ? t.pin : t.scroll, className)}
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      tabIndex={follow === 'scroll' ? 0 : undefined} role="log" aria-live="polite" aria-label="Conversation transcript">
      <div className={t.lines}>
        {visible.map((e) => (e.kind === 'head' ? <Head key={e.key} scene={e.scene} />
          : <Line key={e.key} msg={e.msg} scene={e.scene} partial={e.key === typing ? textOf(e).slice(0, chars) : undefined} />))}
        {waiting && <Waiting scene={last} />}
        {!typing && !waiting && idle}
      </div>
    </div>
  );
}

/** The window a transcript sits in: a black glass pane with a title bar and an optional footer. */
export function TerminalWindow({ title, status, live, footer, children, className, style }: {
  title: ReactNode; status?: ReactNode; live?: boolean; footer?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={cx(t.window, className)} style={style}>
      <div className={t.bar}>
        <span className={t.title}>{title}</span>
        {status && <span className={t.status} data-live={live || undefined}>{status}</span>}
      </div>
      {children}
      {footer && <div className={t.foot}>{footer}</div>}
    </div>
  );
}

/** The idle prompt under a finished transcript. */
export const Idle = ({ children }: { children: ReactNode }) => <div className={t.idle}><span className={t.prompt}>&gt;</span> {children} <span className={t.cursor} aria-hidden="true" /></div>;
