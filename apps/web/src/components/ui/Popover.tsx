import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEventHandler } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { dur, spring } from '../../lib/motion';
import s from './ui.module.css';

export function Popover({ anchor, open, onClose, id, children, onPointerEnter, onPointerLeave, width = 300 }: {
  anchor: HTMLElement | null; open: boolean; onClose?: () => void; id: string; children: ReactNode; width?: number;
  onPointerEnter?: PointerEventHandler; onPointerLeave?: PointerEventHandler;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
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
      const up = below + 220 > window.innerHeight && r.top > 240;
      // Grow out of the anchor: the transform origin sits on the anchor's centre, on the edge facing it.
      setPos({ top: up ? r.top - 6 - 220 : below, left, origin: `${Math.round(r.left + r.width / 2 - left)}px ${up ? '100%' : '0%'}` });
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
  return createPortal(
    <AnimatePresence>
      {open && pos && (
        // React events bubble through portals to the anchor's ancestors (e.g. a post card's open-thread click): stop them here.
        <motion.div ref={root} id={id} role="dialog" aria-modal="false" className={s.popover} style={{ top: pos.top, left: pos.left, width, transformOrigin: pos.origin }}
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: spring.snappy }} exit={{ opacity: 0, scale: 0.96, transition: { duration: dur.micro } }}
          onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onClick={(e) => e.stopPropagation()}>{children}</motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
