import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { createStore, useStore } from '../../lib/store';
import { cx } from '../../lib/cx';
import { dur, spring } from '../../lib/motion';
import s from './ui.module.css';

type Tone = 'info' | 'error' | 'success';
const toasts = createStore<{ id: number; message: string; tone: Tone }[]>([]);
let n = 0;
const dismiss = (id: number) => toasts.set((t) => t.filter((x) => x.id !== id));
export function toast(message: string, opts: { tone?: Tone } = {}) {
  const id = ++n;
  toasts.set((t) => [...t.slice(-2), { id, message, tone: opts.tone ?? 'info' }]);
  setTimeout(() => dismiss(id), 4000);
}
const ICONS = { info: Info, error: CircleAlert, success: CircleCheck };

/** Toasts stack with a spring; on touch they can be swiped sideways to dismiss. */
export function Toaster() {
  const list = useStore(toasts);
  return (
    <div className={s.toasts} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <motion.div key={t.id} layout className={cx(s.toast, s[`toast_${t.tone}`])}
              initial={{ opacity: 0, y: 16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1, transition: spring.bouncy }}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: dur.micro } }}
              drag="x" dragSnapToOrigin dragElastic={0.6} onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 80) dismiss(t.id); }}>
              <Icon size={16} aria-hidden="true" className={s.toastIcon} />{t.message}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
