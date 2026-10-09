import s from './ui.module.css';

/** Placeholder block with a shimmer sweep; compose these to match the real layout. */
export const Skeleton = ({ w = '100%', h = 12, r }: { w?: number | string; h?: number; r?: number }) =>
  <span className={s.skeleton} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
