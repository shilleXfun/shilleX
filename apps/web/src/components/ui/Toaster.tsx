import { createStore, useStore } from '../../lib/store';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

type Tone = 'info' | 'error' | 'success';
const toasts = createStore<{ id: number; message: string; tone: Tone }[]>([]);
let n = 0;
export function toast(message: string, opts: { tone?: Tone } = {}) {
  const id = ++n;
  toasts.set((t) => [...t.slice(-2), { id, message, tone: opts.tone ?? 'info' }]);
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), 4000);
}
export function Toaster() {
  const list = useStore(toasts);
  return (
    <div className={s.toasts} role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={cx(s.toast, s[`toast_${t.tone}`])}>{t.message}</div>)}
    </div>
  );
}
