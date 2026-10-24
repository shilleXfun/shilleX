import { LOOKS, setLook, useLook } from './look';
import s from './lab.module.css';

/** The lab's control: which look the site is in. Floats over every page; the 1 to 4 keys switch too. */
export function LookSwitcher() {
  const look = useLook();
  return (
    <div className={s.switcher} role="radiogroup" aria-label="Design variant">
      {LOOKS.map((l, i) => (
        <button key={l.id} type="button" role="radio" aria-checked={look === l.id} className={s.option} onClick={() => setLook(l.id)} title={`${l.label} (${i + 1})`}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (e.metaKey || e.ctrlKey || e.altKey || t?.closest('input, textarea, [contenteditable]')) return;
  const l = LOOKS[Number(e.key) - 1];
  if (l) setLook(l.id);
});
