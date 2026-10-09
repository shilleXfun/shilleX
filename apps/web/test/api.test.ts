import { describe, it, expect, vi } from 'vitest';
import { api, ApiError, onUnauthorized } from '../src/lib/api';

describe('api client', () => {
  it('parses the server error shape into ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'SLOW_MODE', message: 'wait', details: { retryAfterSec: 9 } }), { status: 429 }));
    await expect(api('/x')).rejects.toMatchObject({ status: 429, code: 'SLOW_MODE', message: 'wait', details: { retryAfterSec: 9 } });
  });
  it('notifies on 401 outside /auth', async () => {
    const cb = vi.fn(); const off = onUnauthorized(cb);
    // A fresh Response per call: a body can only be read once.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ code: 'UNAUTHORIZED', message: 'x' }), { status: 401 }));
    await expect(api('/feed')).rejects.toBeInstanceOf(ApiError);
    await expect(api('/auth/login')).rejects.toBeInstanceOf(ApiError);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
  it('maps network failures to NETWORK', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
  it('returns undefined for 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
