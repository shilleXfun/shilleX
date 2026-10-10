import { AnimatePresence, motion } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import { Check } from 'lucide-react';
import { cx } from '../../lib/cx';
import { dur, press, spring } from '../../lib/motion';
import { Spinner } from './Spinner';
import s from './ui.module.css';

/** Native button props minus the handlers whose types clash with motion's own (drag/animation events). */
export type PressProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration' | 'onDrag' | 'onDragStart' | 'onDragEnd'> & { ref?: Ref<HTMLButtonElement> };

/** A plain button with spring press feedback (scale 0.97). Use it for any custom clickable control. */
export function PressScale({ type = 'button', ...rest }: PressProps) {
  return <motion.button type={type} {...press} {...rest} />;
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', loading, done, icon, children, className, disabled, ...rest }:
  PressProps & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; done?: boolean; icon?: ReactNode }) {
  // The leading slot morphs icon → spinner → check, so a button's state change is visible in place.
  const slot = loading ? 'busy' : done ? 'done' : icon ? 'icon' : null;
  return (
    <PressScale className={cx(s.btn, variant !== 'secondary' && s[variant], size === 'sm' && s.sm, className)}
      disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      <AnimatePresence initial={false} mode="popLayout">
        {slot && (
          <motion.span key={slot} className={s.btnSlot} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: dur.micro } }} transition={spring.bouncy}>
            {slot === 'busy' ? <Spinner /> : slot === 'done' ? <Check size={14} aria-hidden="true" /> : icon}
          </motion.span>
        )}
      </AnimatePresence>
      {children}
    </PressScale>
  );
}
/** Navigation that looks like a Button but stays a link (middle-click, "open in new tab", announced as a link). */
export function ButtonLink({ to, variant = 'secondary', size = 'md', icon, children, className }:
  { to: string; variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cx(s.btn, variant !== 'secondary' && s[variant], size === 'sm' && s.sm, className)}>
      {icon && <span className={s.btnSlot}>{icon}</span>}{children}
    </Link>
  );
}

export function IconButton({ label, className, ...rest }: PressProps & { label: string }) {
  return <PressScale aria-label={label} title={label} className={cx(s.iconBtn, className)} {...rest} />;
}
