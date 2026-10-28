import { useState } from 'react';
import type { MindSlider, MindTraitKey } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import { cx } from '../../lib/cx';
import s from './owner.module.css';

const ORDER: MindTraitKey[] = ['risk', 'greed', 'chattiness', 'humor', 'loyalty', 'pettiness', 'curiosity'];

/**
 * The seven mind sliders (2026-10-28 brief §2): plain names, 1 to 10, the owner's setting on the track and a dot where Shillex
 * has moved it since, with the line the agent reads and the last reasons it moved. Save sends only the sliders that changed.
 */
export function MindSliders({ mind, onSave }: { mind: Record<MindTraitKey, MindSlider>; onSave: (changed: Partial<Record<MindTraitKey, number>>) => Promise<void> }) {
  const [draft, setDraft] = useState<Partial<Record<MindTraitKey, number>>>({});
  const [busy, setBusy] = useState(false);
  const changed = Object.entries(draft).filter(([k, v]) => v !== (mind[k as MindTraitKey].set ?? mind[k as MindTraitKey].now)) as [MindTraitKey, number][];
  const save = async () => {
    setBusy(true);
    try { await onSave(Object.fromEntries(changed)); setDraft({}); } finally { setBusy(false); }
  };
  return (
    <div className={s.mind}>
      {ORDER.map((t) => {
        const m = mind[t];
        const value = draft[t] ?? m.set ?? m.now;
        const moved = m.set !== null && m.now !== m.set;
        return (
          <div key={t} className={s.slider}>
            <div className={s.sliderHead}>
              <label htmlFor={`mind-${t}`} className={s.sliderName}>{m.name}</label>
              <span className={s.sliderValue}>{value}<small>/10</small></span>
            </div>
            <div className={s.track}>
              <input id={`mind-${t}`} type="range" min={1} max={10} step={1} value={value} onChange={(e) => setDraft((d) => ({ ...d, [t]: Number(e.target.value) }))}
                style={{ ['--fill' as string]: `${((value - 1) / 9) * 100}%` }} aria-valuetext={`${value} of 10, ${value <= 3 ? m.low : value >= 8 ? m.high : 'in between'}`} />
              {moved && <span className={s.nowDot} style={{ left: `calc(${((m.now - 1) / 9) * 100}% )` }} title={`Shillex moved it to ${m.now}`} aria-hidden="true" />}
            </div>
            <div className={s.ends}><span>{m.low}</span><span>{m.high}</span></div>
            <p className={s.line}>“{m.line.replace(/^[^:]+: /, '')}”{moved && <span className={s.movedNote}> · now {m.now}, you set {m.set}</span>}</p>
            {m.why.length > 0 && (
              <details className={s.why}>
                <summary>Why it moved ({m.why.length})</summary>
                <ul>{m.why.slice(0, 5).map((w) => <li key={w.at + w.reason}><span className={cx(s.delta, w.delta < 0 ? s.down : s.up)}>{w.delta > 0 ? '+' : ''}{(w.delta * 9).toFixed(1)}</span> {w.reason}</li>)}</ul>
              </details>
            )}
          </div>
        );
      })}
      <div className={s.saveRow}>
        <span className={s.meta}>These shape how your agent sees itself. Its own AI reads them; Shillex nudges them as it lives.</span>
        <Button variant="primary" size="sm" disabled={!changed.length} loading={busy} onClick={() => void save()}>{changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'Saved'}</Button>
      </div>
    </div>
  );
}
