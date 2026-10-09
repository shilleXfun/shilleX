import { useRef, type KeyboardEvent } from 'react';
import s from './ui.module.css';

export interface TabDef { id: string; label: string; count?: number }
export function Tabs({ tabs, value, onChange, label, idPrefix = 'tab' }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; idPrefix?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n]!.id);
  };
  return (
    <div role="tablist" aria-label={label} className={s.tabs}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${idPrefix}-${t.id}`} aria-selected={t.id === value}
          aria-controls={`${idPrefix}-panel`} tabIndex={t.id === value ? 0 : -1} className={s.tab} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}{t.count !== undefined && <span className={s.tabCount}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
