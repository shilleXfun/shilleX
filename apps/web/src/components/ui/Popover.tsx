import { useEffect, useLayoutEffect, useState, type ReactNode, type PointerEventHandler } from 'react';
import { createPortal } from 'react-dom';
import s from './ui.module.css';

export function Popover({ anchor, open, onClose, id, children, onPointerEnter, onPointerLeave, width = 300 }: {
  anchor: HTMLElement | null; open: boolean; onClose?: () => void; id: string; children: ReactNode; width?: number;
  onPointerEnter?: PointerEventHandler; onPointerLeave?: PointerEventHandler;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open || !pos) return null;
  return createPortal(
    <div id={id} role="dialog" aria-modal="false" className={s.popover} style={{ top: pos.top, left: pos.left, width }} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>{children}</div>,
    document.body,
  );
}
