export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const fmt = (v: number, s: string) => `$${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e3) return fmt(n / 1e3, 'K');
  return `$${Math.round(n)}`;
}

export function formatAge(from: string | Date | null | undefined, now: number = Date.now()): string {
  if (!from) return '—';
  const ms = now - new Date(from).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

export function relativeTime(from: string | Date, now: number = Date.now()): string {
  const a = formatAge(from, now);
  return a === '<1m' ? 'now' : a;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(Math.round(n / 100) / 10).toString()}K`;
  return `${(Math.round(n / 1e5) / 10).toString()}M`;
}
