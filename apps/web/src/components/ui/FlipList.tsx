import { useEffect, useRef, useState } from 'react';
import s from './ui.module.css';

/**
 * Which rows of an ordered list changed places with each other since the last order, for `holdMs` (the ▲/▼ chip). Rows
 * only pushed along by an arrival or a departure keep their place among the others, so they get no chip. The rows
 * themselves slide with motion's `layout` prop (spring.soft); this hook only says which way each one went.
 */
export function useFlipList(ids: string[], holdMs = 3000): ReadonlyMap<string, 'up' | 'down'> {
  const prev = useRef<string[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [moved, setMoved] = useState<ReadonlyMap<string, 'up' | 'down'>>(() => new Map());
  const key = ids.join('\u0000');
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const before = prev.current;
    prev.current = ids;
    if (!before) return;
    const both = new Set(before.filter((id) => ids.includes(id)));
    const was = new Map(before.filter((id) => both.has(id)).map((id, i) => [id, i]));
    const changes = new Map<string, 'up' | 'down'>();
    ids.filter((id) => both.has(id)).forEach((id, i) => { const j = was.get(id)!; if (j !== i) changes.set(id, i < j ? 'up' : 'down'); });
    if (!changes.size) return;
    setMoved(changes);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMoved(new Map()), holdMs);
    // `key` stands for `ids`: a new array with the same order is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, holdMs]);
  return moved;
}

/** ▲ or ▼ next to a row that just moved up or down (nothing otherwise). Decorative: the order itself says the rank. */
export function RankChip({ dir }: { dir?: 'up' | 'down' }) {
  if (!dir) return null;
  return <span className={s.rank} data-dir={dir} aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>;
}
