import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { SceneView } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { SceneConversation } from './Conversation';
import v from './convo.module.css';

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
 * above (the side column's Talking now); `scroll` shows it all, following new messages while the reader stays at the
 * bottom. `live` announces new lines to screen readers: on for the page that is the conversation, off for a corner of
 * every page (the side column), where it would talk over whatever the reader is reading.
 */
export function ConvoBody({ scene, follow = 'scroll', live = true, className }: { scene: SceneView; follow?: 'pin' | 'scroll'; live?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow === 'scroll' && pinned.current) el.scrollTop = el.scrollHeight;
  }, [scene.messages.length, follow]);
  return (
    <div ref={box} className={cx(v.body, follow === 'pin' ? v.pin : v.scroll, className)}
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      tabIndex={follow === 'scroll' ? 0 : undefined} aria-live={live ? 'polite' : undefined}>
      <SceneConversation scene={scene} className={v.convo} />
    </div>
  );
}
