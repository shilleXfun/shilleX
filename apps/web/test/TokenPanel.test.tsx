import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { TokenPanel } from '../src/features/tokens/TokenPanel';
import { TokenPanelHost } from '../src/features/tokens/TokenPanelHost';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const token = { mint: MINT, status: 'resolved', source: 'demo', name: 'Grubworm', symbol: 'GRUB', imageUrl: null, decimals: null, liquidityUsd: 122000, marketCapUsd: 1450000, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: '2026-10-08T06:00:00Z', promoted: false, fetchedAt: null, error: null };
const links = ['Axiom', 'GMGN', 'Dexscreener', 'Solscan'].map((label) => ({ id: label.toLowerCase(), label, url: null, unavailableReason: 'Fictional demo token — not on-chain' }));
const demoRoutes = {
  [`/api/tokens/${MINT}/posts`]: { items: [], nextCursor: null },
  [`/api/tokens/${MINT}/chat`]: { items: [], nextCursor: null },
  [`/api/tokens/${MINT}`]: { token, links, stats: { mentions24h: 0, posts24h: 0, chat24h: 0, subscribed: false } },
};

describe('TokenPanel', () => {
  it('shows identity, full address, honest provenance, disabled demo links, note and empty discussion', async () => {
    mockFetch(demoRoutes);
    const onClose = vi.fn();
    renderWithApp(<TokenPanel mint={MINT} onClose={onClose} />);
    expect(await screen.findByRole('heading', { name: /Grubworm/ })).toBeInTheDocument();
    expect(screen.getByText(MINT)).toBeInTheDocument();
    expect(screen.getByText(/DEMO data — fictional token, not on-chain/)).toBeInTheDocument();
    for (const l of ['Axiom', 'GMGN', 'Dexscreener', 'Solscan']) {
      const el = screen.getByText(l).closest('[aria-disabled]');
      expect(el).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByText('Mentions measure discussion, not quality. Do your own research.')).toBeInTheDocument();
    expect(await screen.findByText('No public posts mention this exact address yet.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('live tokens get real links that open in a new tab', async () => {
    mockFetch({
      [`/api/tokens/${MINT}/posts`]: { items: [], nextCursor: null },
      [`/api/tokens/${MINT}/chat`]: { items: [], nextCursor: null },
      [`/api/tokens/${MINT}`]: { token: { ...token, source: 'live', fetchedAt: new Date().toISOString() }, links: [{ id: 'dexscreener', label: 'Dexscreener', url: `https://dexscreener.com/solana/${MINT}`, unavailableReason: null }], stats: { mentions24h: 3, posts24h: 2, chat24h: 1, subscribed: true } },
    });
    renderWithApp(<TokenPanel mint={MINT} onClose={() => {}} />);
    const a = await screen.findByRole('link', { name: /Dexscreener/ });
    expect(a).toHaveAttribute('href', `https://dexscreener.com/solana/${MINT}`);
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: /Following discussion/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('error state offers retry', async () => {
    mockFetch({ [`/api/tokens/${MINT}`]: new Response(JSON.stringify({ code: 'INTERNAL', message: 'boom' }), { status: 500 }) });
    renderWithApp(<TokenPanel mint={MINT} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe('TokenPanelHost', () => {
  it('opens from ?token= and closing removes it from the URL', async () => {
    mockFetch(demoRoutes);
    renderWithApp(<TokenPanelHost />, { route: `/?token=${MINT}` });
    expect(await screen.findByRole('complementary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close token panel' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  });
  it('ignores a ?token= that is not a valid address', () => {
    renderWithApp(<TokenPanelHost />, { route: '/?token=not-a-mint' });
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
