import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import s from './ui.module.css';

export const Badge = ({ tone, children, title }: { tone: 'demo' | 'promoted' | 'accent' | 'muted'; children: ReactNode; title?: string }) =>
  <span className={cx(s.badge, s[`badge_${tone}`])} title={title}>{children}</span>;
