/**
 * Post-auth redirect target from a `?next=` value: only a same-origin path is allowed.
 * Rejects protocol-relative (`//host`), backslash tricks (`/\host`, which browsers treat as `//host`) and absolute URLs.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next;
}
