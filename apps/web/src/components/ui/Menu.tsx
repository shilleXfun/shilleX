import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cx } from '../../lib/cx';
import { dur, spring } from '../../lib/motion';
import s from './ui.module.css';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; icon?: ReactNode }
export function Menu({ trigger, items, label, layout = 'list' }: {
  label: string; items: MenuItem[];
  /** `tray`: one horizontal row of compact items (e.g. emoji reactions). */
  layout?: 'list' | 'tray';
  trigger: (p: { ref: (el: HTMLButtonElement | null) => void; onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string; 'aria-label': string }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (e: MouseEvent) => { if (!listRef.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, anchor]);
  const onKey = (e: KeyboardEvent) => {
    const els = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const [next, prev] = layout === 'tray' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp'];
    if (e.key === next) { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === prev) { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); anchor?.focus(); }
  };
  const r = open ? anchor?.getBoundingClientRect() : undefined;
  // Open below the trigger, flipping above it when there is no room (e.g. the account menu at the foot of the nav).
  const tray = layout === 'tray';
  const height = tray ? 50 : items.length * 36 + 10;
  const width = tray ? items.length * 42 + 10 : 200;
  const above = !!r && r.bottom + 4 + height > window.innerHeight - 8;
  const top = r ? (above ? Math.max(8, r.top - 4 - height) : r.bottom + 4) : 0;
  const left = r ? Math.max(8, Math.min(tray ? r.left + r.width / 2 - width / 2 : r.right - width, window.innerWidth - width - 8)) : 0;
  // Pop from the anchor's side: the corner nearest the trigger.
  const origin = r ? `${Math.round(r.left + r.width / 2 - left)}px ${above ? '100%' : '0%'}` : 'top';
  return (
    <>
      {trigger({ ref: setAnchor, onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id, 'aria-label': label })}
      {createPortal(
        <AnimatePresence>
          {open && r && (
            <motion.div ref={listRef} id={id} role="menu" aria-label={label} aria-orientation={tray ? 'horizontal' : undefined} className={cx(s.menu, tray && s.tray)} onKeyDown={onKey}
              style={{ top, left, transformOrigin: origin }}
              initial={{ opacity: 0, scale: 0.92, y: above ? 4 : -4 }} animate={{ opacity: 1, scale: 1, y: 0, transition: spring.snappy }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: dur.micro } }}>
              {items.map((it, i) => (
                <motion.button key={it.label} role="menuitem" type="button" className={cx(s.menuItem, it.danger && s.menuDanger)}
                  initial={tray ? { opacity: 0, y: 6, scale: 0.6 } : false} animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring.bouncy, delay: i * 0.025 } }}
                  whileHover={tray ? { scale: 1.25, y: -2 } : undefined} whileTap={{ scale: tray ? 0.9 : 0.97 }}
                  onClick={() => { setOpen(false); anchor?.focus(); it.onSelect(); }}>{it.icon}{it.label}</motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>, document.body)}
    </>
  );
}
