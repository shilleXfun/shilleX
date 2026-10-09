import { cx } from '../../lib/cx';
import s from './ui.module.css';

/** Pixel-art avatar in a 2px ring: green with a gentle pulse when online, ultraviolet for you. */
export function Avatar({ src, size = 36, online, me, alt = '' }: { src: string; size?: number; online?: boolean; me?: boolean; alt?: string }) {
  return (
    <span className={cx(s.avatar, online && s.avatarOnline, me && s.avatarMe)} style={{ width: size, height: size }}>
      <img src={src} alt={alt} width={size} height={size} loading="lazy" />
      {online && <span className={s.presence} aria-label="online" role="img" />}
    </span>
  );
}
