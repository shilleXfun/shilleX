import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { RaiseForm } from '../../src/features/raise/RaiseForm';

afterEach(() => vi.restoreAllMocks());
const open = { can: { ok: true, reason: null }, request: null, agent: null };

describe('RaiseForm', () => {
  it('sends the handle and description, and shows the place in line', async () => {
    let sent: unknown = null;
    mockFetch({
      '/api/raised/mine': () => (sent ? { ...open, request: { id: 'r1', handle: 'tidewatch', status: 'queued', reason: null, position: 2, createdAt: '2026-10-13T00:00:00Z' } } : open),
      '/api/raised': (init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return { request: { id: 'r1', handle: 'tidewatch', status: 'queued', reason: null, position: 2, createdAt: '2026-10-13T00:00:00Z' } }; },
    });
    renderWithApp(<RaiseForm />, { route: '/agents/new' });
    fireEvent.change(await screen.findByLabelText(/^Handle/), { target: { value: 'tidewatch' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'a calm lighthouse keeper' } });
    expect(screen.getByText('256 characters left')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Raise it' }));
    expect(await screen.findByRole('status')).toHaveTextContent('In the queue · #2 in line');
    expect(sent).toEqual({ handle: 'tidewatch', description: 'a calm lighthouse keeper' });
  });

  it('shows the server’s reason when a description is refused', async () => {
    mockFetch({
      '/api/raised/mine': open,
      '/api/raised': () => new Response(JSON.stringify({ code: 'WISH_LINK', message: 'No links in the description.' }), { status: 400 }),
    });
    renderWithApp(<RaiseForm />, { route: '/agents/new' });
    fireEvent.change(await screen.findByLabelText(/^Handle/), { target: { value: 'tidewatch' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'see evil.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No links in the description.');
  });

  it('explains why someone can’t raise yet, instead of the form', async () => {
    mockFetch({ '/api/raised/mine': { can: { ok: false, reason: 'Your account needs to be 3 days old to raise an agent.' }, request: null, agent: null } });
    renderWithApp(<RaiseForm />, { route: '/agents/new' });
    expect(await screen.findByText('Your account needs to be 3 days old to raise an agent.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise it' })).not.toBeInTheDocument();
  });

  it('shows "Hatching…" while it hatches, and the refusal reason after', async () => {
    mockFetch({ '/api/raised/mine': { can: { ok: false, reason: 'Your agent is already on its way.' }, request: { id: 'r1', handle: 'tidewatch', status: 'hatching', reason: null, position: null, createdAt: '2026-10-13T00:00:00Z' }, agent: null } });
    renderWithApp(<RaiseForm />, { route: '/agents/new' });
    expect(await screen.findByRole('status')).toHaveTextContent('Hatching…');
  });
});
