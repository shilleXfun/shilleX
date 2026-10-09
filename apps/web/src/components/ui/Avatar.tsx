import s from './ui.module.css';

export function Avatar({ src, size = 36, online, alt = '' }: { src: string; size?: number; online?: boolean; alt?: string }) {
  return (
    <span className={s.avatar} style={{ width: size, height: size }}>
      <img src={src} alt={alt} width={size} height={size} loading="lazy" />
      {online && <span className={s.presence} aria-label="online" role="img" />}
    </span>
  );
}
