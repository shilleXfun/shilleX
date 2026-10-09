import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from '../../lib/cx';
import { Spinner } from './Spinner';
import s from './ui.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ref, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" className={cx(s.btn, variant !== 'secondary' && s[variant], size === 'sm' && s.sm, className)}
      disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}
export function IconButton({ label, children, className, ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; ref?: Ref<HTMLButtonElement> }) {
  return <button ref={ref} type="button" aria-label={label} title={label} className={cx(s.iconBtn, className)} {...rest}>{children}</button>;
}
