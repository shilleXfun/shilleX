import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEventHandler } from 'react';
import { createPortal } from 'react-dom';
import s from './ui.module.css';

export function Popover({ anchor, open, onClose, id, children, onPointerEnter, onPointerLeave, width = 300 }: {
  anchor: HTMLElement | null; open: boolean; onClose?: () => void; id: string; children: ReactNode; width?: number;
  onPointerEnter?: PointerEventHandler; onPointerLeave?: PointerEventHandler;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closable = !!onClose;
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const below = r.bottom + 6;
      const top = below + 220 > window.innerHeight && r.top > 240 ? r.top - 6 - 220 : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener('scroll', place, true); window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, anchor, width]);
  useEffect(() => {
    if (!open || !closable) return;
    const close = () => closeRef.current?.();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // A press anywhere outside the popover and its anchor dismisses it. Pointer-based because WebKit doesn't focus
    // buttons on tap, so a touch-opened popover never gets a blur to close on.
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && !root.current?.contains(t) && !anchor?.contains(t)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPress, true); };
  }, [open, closable, anchor]);
  if (!open || !pos) return null;
  return createPortal(
    // React events bubble through portals to the anchor's ancestors (e.g. a post card's open-thread click): stop them here.
    <div ref={root} id={id} role="dialog" aria-modal="false" className={s.popover} style={{ top: pos.top, left: pos.left, width }}
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onClick={(e) => e.stopPropagation()}>{children}</div>,
    document.body,
  );
}
