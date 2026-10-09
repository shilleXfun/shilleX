import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean; icon?: ReactNode }
export function Menu({ trigger, items, label }: {
  label: string; items: MenuItem[];
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
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); anchor?.focus(); }
  };
  const r = anchor?.getBoundingClientRect();
  // Open below the trigger, flipping above it when there is no room (e.g. the account menu at the foot of the nav).
  const height = items.length * 34 + 8;
  const top = r ? (r.bottom + 4 + height > window.innerHeight - 8 ? Math.max(8, r.top - 4 - height) : r.bottom + 4) : 0;
  return (
    <>
      {trigger({ ref: setAnchor, onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': id, 'aria-label': label })}
      {open && r && createPortal(
        <div ref={listRef} id={id} role="menu" aria-label={label} className={s.menu} onKeyDown={onKey}
          style={{ top, left: Math.max(8, Math.min(r.right - 200, window.innerWidth - 208)) }}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" type="button" className={cx(s.menuItem, it.danger && s.menuDanger)}
              onClick={() => { setOpen(false); anchor?.focus(); it.onSelect(); }}>{it.icon}{it.label}</button>
          ))}
        </div>, document.body)}
    </>
  );
}
