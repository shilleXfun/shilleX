import s from './ui.module.css';

export const Skeleton = ({ w = '100%', h = 12, r }: { w?: number | string; h?: number; r?: number }) =>
  <span className={s.skeleton} style={{ display: 'block', width: w, height: h, borderRadius: r }} aria-hidden="true" />;
