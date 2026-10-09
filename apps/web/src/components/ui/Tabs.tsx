import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { dur, ease, spring } from '../../lib/motion';
import s from './ui.module.css';

export interface TabDef { id: string; label: string; count?: number }
export function Tabs({ tabs, value, onChange, label, idPrefix = 'tab' }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; idPrefix?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const group = useId();
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n]!.id);
  };
  return (
    <LayoutGroup id={group}>
      <div role="tablist" aria-label={label} className={s.tabs}>
        {tabs.map((t, i) => (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${idPrefix}-${t.id}`} aria-selected={t.id === value}
            aria-controls={`${idPrefix}-panel`} tabIndex={t.id === value ? 0 : -1} className={s.tab} onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
            {t.label}{t.count !== undefined && <span className={s.tabCount}>{t.count}</span>}
            {t.id === value && <motion.span layoutId="underline" className={s.tabLine} transition={spring.snappy} />}
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}

const panel = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
  show: { opacity: 1, x: 0, transition: { duration: dur.standard, ease: ease.out } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24, transition: { duration: dur.micro } }),
};

/** Tab content that cross-slides in the direction of the tab change. `order` is the tab ids in display order. */
export function TabPanel({ value, order, children, ...rest }: { value: string; order: string[]; children: ReactNode; id: string; 'aria-labelledby': string }) {
  // Derived state (not a ref) so StrictMode's double render can't lose the direction.
  const [last, setLast] = useState({ value, dir: 1 });
  let dir = last.dir;
  if (last.value !== value) {
    dir = Math.sign(order.indexOf(value) - order.indexOf(last.value)) || 1;
    setLast({ value, dir });
  }
  return (
    <div role="tabpanel" className={s.tabPanel} {...rest}>
      <AnimatePresence mode="popLayout" initial={false} custom={dir}>
        <motion.div key={value} custom={dir} variants={panel} initial="enter" animate="show" exit="exit">{children}</motion.div>
      </AnimatePresence>
    </div>
  );
}
