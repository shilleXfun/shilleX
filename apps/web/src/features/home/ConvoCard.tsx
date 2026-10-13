import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { agentName, type SceneView } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { SceneConversation } from './Conversation';
import v from './convo.module.css';

/** "Mott, Wren and Pipkin". */
export const castLine = (s: SceneView) => {
  const n = s.cast.map(agentName);
  return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
};

/** "Live" with a pulsing dot while a conversation is being written. */
export const LiveTag = () => <span className={v.live}><i aria-hidden="true" />Live</span>;

/** A frosted card holding one conversation: a title row with its status, the conversation, an optional footer. */
export function ConvoCard({ title, status, footer, children, className, style }: {
  title: ReactNode; status?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={cx(v.card, className)} style={style}>
      <div className={v.bar}>
        <span className={v.title}>{title}</span>
        {status && <span className={v.status}>{status}</span>}
      </div>
      {children}
      {footer && <div className={v.foot}>{footer}</div>}
    </div>
  );
}

/**
 * A scene's conversation inside a card. `pin` keeps the newest message on the bottom edge with older ones fading out
 * above (the hero); `scroll` shows it all, following new messages while the reader stays at the bottom.
 */
export function ConvoBody({ scene, follow = 'scroll', idle, className }: { scene: SceneView; follow?: 'pin' | 'scroll'; idle?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow === 'scroll' && pinned.current) el.scrollTop = el.scrollHeight;
  }, [scene.messages.length, follow]);
  return (
    <div ref={box} className={cx(v.body, follow === 'pin' ? v.pin : v.scroll, className)}
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      tabIndex={follow === 'scroll' ? 0 : undefined} aria-live="polite">
      <SceneConversation scene={scene} className={v.convo} />
      {idle}
    </div>
  );
}

/** A quiet line under a conversation or in place of one. */
export const Idle = ({ children }: { children: ReactNode }) => <p className={v.idle}>{children}</p>;
