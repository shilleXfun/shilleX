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
 * A scene's conversation inside a card. `pin` keeps the newest message on the bottom edge and shows only whole messages:
 * the box grows with the conversation up to its max-height (the side column's Talking now), or fills the room it is
 * given (the sign-in page), and a message that would be cut at the top edge is left out rather than shown in half.
 * `scroll` shows it all, following new messages while the reader stays at the bottom. `live` announces new lines to
 * screen readers: on for the page that is the conversation, off for a corner of every page (the side column), where it
 * would talk over whatever the reader is reading.
 */
export function ConvoBody({ scene, follow = 'scroll', live = true, className }: { scene: SceneView; follow?: 'pin' | 'scroll'; live?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow === 'scroll' && pinned.current) el.scrollTop = el.scrollHeight;
  }, [scene.messages.length, follow]);
  useLayoutEffect(() => {
    const el = box.current;
    const list = el?.querySelector('ol');
    if (!el || !list || follow !== 'pin') return;
    // Layout offsets, not bounding boxes: a message rising in is transformed, and its box would read as moved.
    const fit = () => {
      const cs = getComputedStyle(el);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const max = parseFloat(cs.maxHeight);
      const room = (Number.isFinite(max) ? max : el.clientHeight) - pad;
      const rows = [...list.children] as HTMLElement[];
      const last = rows.at(-1);
      if (!last) { if (Number.isFinite(max)) el.style.height = ''; return; }
      const bottom = last.offsetTop + last.offsetHeight;
      let top = last.offsetTop;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        // The last two rows always show (the newest message, and the typing dots after it), however tall: an empty box says nothing.
        const fits = i >= rows.length - 2 || bottom - r.offsetTop <= room;
        r.style.visibility = fits ? '' : 'hidden';
        if (fits) top = r.offsetTop;
      }
      if (Number.isFinite(max)) {
        // Taller than the box only when the newest message alone is: then the box grows to hold it.
        const need = bottom - top;
        el.style.maxHeight = need > room ? 'none' : '';
        el.style.height = `${Math.ceil((need > room ? need : Math.min(room, need)) + pad)}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(list);
    if (!Number.isFinite(parseFloat(getComputedStyle(el).maxHeight))) ro.observe(el);
    const mo = new MutationObserver(fit);
    mo.observe(list, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [follow]);
  return (
    <div ref={box} className={cx(v.body, follow === 'pin' ? v.pin : v.scroll, className)}
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      tabIndex={follow === 'scroll' ? 0 : undefined} aria-live={live ? 'polite' : undefined}>
      <SceneConversation scene={scene} className={v.convo} />
    </div>
  );
}
