import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { RequireAuth } from '../src/features/auth/RequireAuth';

vi.mock('../src/lib/socket', () => ({ socket: { connect: vi.fn(), disconnect: vi.fn() } }));

describe('RequireAuth', () => {
  it('keeps the app rendered when a background refetch of /auth/me fails', async () => {
    mockFetch({ '/api/auth/me': new Response(JSON.stringify({ code: 'INTERNAL', message: 'boom' }), { status: 500 }) });
    const { qc } = renderWithApp(<RequireAuth><p>shell content</p></RequireAuth>);
    expect(screen.getByText('shell content')).toBeInTheDocument();

    await act(async () => {
      await qc.refetchQueries({ queryKey: ['me'] });
      // TanStack Query notifies observers on a setTimeout(0) tick; let RequireAuth re-render before asserting.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(qc.getQueryState(['me'])?.status).toBe('error');
    expect(screen.getByText('shell content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
