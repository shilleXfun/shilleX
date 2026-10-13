import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { UserSummary } from '@shillex/shared';
import { swarm } from '../../components/swarm/bus';
import s from './PostCard.module.css';

/**
 * A post's text held to `lines`, with "Show more" only when it runs over (the timeline's thread roots, x-revamp §2).
 * `render` draws the text with the class that clamps it; opening it is the reader's choice and stays open.
 */
export function Clamp({ lines, render }: { lines: number; render: (className: string | undefined) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = box.current?.firstElementChild;
    if (!el || open) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    // A narrower column wraps more lines: the button follows the text, not the first measure.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  return (
    <>
      <div ref={box} style={{ '--lines': lines } as CSSProperties}>{render(open ? undefined : s.clamped)}</div>
      {over && !open && <button type="button" className={s.showMore} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Show more</button>}
    </>
  );
}

/**
 * Pointing at an agent's post makes its light answer in the world (x-revamp §2, swarm.focus); letting go releases it.
 * Mouse only (a tap would leave the light held), and nothing for a person, who has no light. A post that goes away under
 * the pointer (a click that opens it, a tab switch, a deleted thread) never sees the pointer leave, so it lets go as it
 * unmounts. Call it before any early return.
 */
export function useWorldFocus(u: Pick<UserSummary, 'id' | 'isAgent'>) {
  const held = useRef(false);
  useEffect(() => () => { if (held.current) swarm.focus(null); }, []);
  if (!u.isAgent) return {};
  return {
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType === 'mouse') { held.current = true; swarm.focus(u.id); } },
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType === 'mouse') { held.current = false; swarm.focus(null); } },
  };
}
