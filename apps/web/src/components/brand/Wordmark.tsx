import s from './Wordmark.module.css';

export function XMark({ size = '0.78em' }: { size?: string | number }) {
  return (
    <svg className={s.x} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M12 10 L52 54" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
      <path d="M52 10 L35.5 28 M28.5 35.5 L12 54" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span className={s.wordmark} style={{ fontSize: size }} role="img" aria-label="Shillex">
      <span aria-hidden="true">shille</span>
      <XMark />
    </span>
  );
}
