import type { ApiErrorBody, UploadView } from '@shillex/shared';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const unauthorized = new Set<() => void>();
export const onUnauthorized = (cb: () => void) => { unauthorized.add(cb); return () => { unauthorized.delete(cb); }; };

async function handle<T>(res: Response, path: string): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const b = (data ?? {}) as Partial<ApiErrorBody>;
    if (res.status === 401 && !path.startsWith('/auth/')) unauthorized.forEach((cb) => cb());
    throw new ApiError(res.status, b.code ?? 'HTTP_ERROR', b.message ?? `Request failed (${res.status})`, b.details);
  }
  return data as T;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (hasBody ? 'POST' : 'GET'), credentials: 'include',
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(opts.body) : undefined, signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Can’t reach Shillex. Check your connection.');
  }
  return handle<T>(res, path);
}
export const get = <T,>(p: string, signal?: AbortSignal) => api<T>(p, { signal });
export const post = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const patch = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'PATCH', body });
export const del = <T,>(p: string) => api<T>(p, { method: 'DELETE' });

export async function uploadImage(file: File): Promise<UploadView> {
  const fd = new FormData();
  fd.append('file', file);
  let res: Response;
  try { res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'include' }); }
  catch { throw new ApiError(0, 'NETWORK', 'Upload failed — check your connection.'); }
  return (await handle<{ upload: UploadView }>(res, '/uploads')).upload;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong';
}
export function retryAfterSec(e: unknown): number | null {
  const d = e instanceof ApiError ? (e.details as { retryAfterSec?: number } | undefined) : undefined;
  return typeof d?.retryAfterSec === 'number' ? d.retryAfterSec : null;
}
