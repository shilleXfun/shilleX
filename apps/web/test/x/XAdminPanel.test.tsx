import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { XAdminView } from '@shillex/shared';
import { mockFetch, renderWithApp } from '../utils';
import { XAdminPanel } from '../../src/features/x/XAdminPanel';

const view: XAdminView = {
  status: { reading: 'halted', readHalted: 'X refused the reading key (401)', highlights: 'drafts', posting: 'on', postHalted: null, lastTickAt: null, lastError: null },
  limits: { dailyMaxPostReads: 200, dailyBudgetUsd: 1.5, highlightsPerDay: 3, linkedPostsPerDay: 1 },
  spendToday: { postReads: 40, userReads: 2, postsCreated: 1, linkedPosts: 0, mediaUploads: 1, usd: 0.235 },
  sources: [{ id: 's1', kind: 'account', value: 'Lamp', enabled: true, lastPolledAt: null, backoffUntil: null }],
  topics: [{ id: 't1', label: 'solana etf filing', heat: 0.9, sentiment: 0.5, expiresAt: '2026-10-09T15:00:00Z' }],
  highlights: [{ id: 'h1', kind: 'graduation', body: 'ORBIT (devnet coin) graduated.', link: null, imageUrl: null, status: 'draft', error: null, createdAt: '2026-10-09T12:00:00Z', postedAt: null }],
};
afterEach(() => vi.restoreAllMocks());

describe('XAdminPanel', () => {
  it('shows the halt, the spend, the sources, the topics and the drafts', async () => {
    mockFetch({ '/api/admin/x': view });
    renderWithApp(<XAdminPanel />);
    expect(await screen.findByText(/X refused the reading key \(401\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.235 of \$1\.50/)).toBeInTheDocument();
    expect(screen.getByText('Lamp')).toBeInTheDocument();
    expect(screen.getByText('solana etf filing')).toBeInTheDocument();
    expect(screen.getByText('ORBIT (devnet coin) graduated.')).toBeInTheDocument();
  });
  it('adds a source, approves a draft and resumes', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const spy = mockFetch({
      '/api/admin/x/sources': (init?: RequestInit) => { calls.push({ url: 'sources', body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ source: {} }), { status: 201 }); },
      '/api/admin/x/highlights/h1/approve': () => { calls.push({ url: 'approve', body: null }); return new Response(null, { status: 204 }); },
      '/api/admin/x/resume': () => { calls.push({ url: 'resume', body: null }); return new Response(null, { status: 204 }); },
      '/api/admin/x': view,
    });
    renderWithApp(<XAdminPanel />);
    await screen.findByText('Lamp');
    fireEvent.change(screen.getByRole('textbox', { name: /handle or search/i }), { target: { value: '@moth' } });
    fireEvent.click(screen.getByRole('button', { name: /add source/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    await waitFor(() => expect(calls.map((c) => c.url).sort()).toEqual(['approve', 'resume', 'sources']));
    expect(calls.find((c) => c.url === 'sources')!.body).toEqual({ kind: 'account', value: '@moth' });
    expect(spy).toHaveBeenCalled();
  });
});
