import { describe, it, expect } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { PostBody } from '../src/features/feed/PostBody';
import { pushPulse, resetPulses } from '../src/features/agents/pulses';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
describe('PostBody', () => {
  it('renders mentions as profile links, urls as safe external links, mints as token chips', () => {
    renderWithApp(<PostBody text={`gm @alpha_jane see https://example.com/x and ${MINT}`} />, {
      seed: (qc) => qc.setQueryData(['token', MINT], { mint: MINT, status: 'resolved', source: 'demo', symbol: 'GRUB', name: 'Grubworm', imageUrl: null, decimals: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null }),
    });
    expect(screen.getByRole('link', { name: '@alpha_jane' })).toHaveAttribute('href', '/u/alpha_jane');
    const ext = screen.getByRole('link', { name: /example\.com/ });
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(ext).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: new RegExp(MINT) })).toHaveTextContent('$GRUB');
  });
  it('never renders HTML from text', () => {
    renderWithApp(<PostBody text={'<img src=x onerror=alert(1)>'} />);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});

describe('PostBody tickers', () => {
  const lamp = { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: { id: 'a1', username: 'a1', displayName: '', avatarUrl: '/a.svg', isDemo: false, createdAt: '2026-10-12T00:00:00Z' }, launchedAt: '2026-10-12T10:00:00Z', launchSignature: 'S', priceSol: 1e-9, marketCapSol: 1, curveProgress: 0, holders: 1, volume24hSol: 0, devSoldPct: 0, graduated: false };
  const seed = (qc: import('@tanstack/react-query').QueryClient) => qc.setQueryData(['agents', 'coins'], [lamp]);
  it('links a live agent coin’s $TICKER, in any case and only as a whole word', () => {
    resetPulses();
    renderWithApp(<PostBody text="$lamp is up, $LAMPS is not a coin, $NOPE either" />, { seed });
    expect(screen.getByRole('link', { name: '$lamp' })).toHaveAttribute('href', '/coins/M1');
    expect(screen.queryByRole('link', { name: '$LAMPS' })).not.toBeInTheDocument();
    expect(screen.getByText(/\$LAMPS is not a coin, \$NOPE either/)).toBeInTheDocument();
  });
  it('links a reused ticker to the newest coin that carries it', () => {
    resetPulses();
    // GET /api/coins answers newest first; a ticker can be launched again once its old coin is a week old.
    const fresh = { ...lamp, mint: 'M9', launchedAt: '2026-10-13T10:00:00Z' };
    renderWithApp(<PostBody text="the new $LAMP" />, { seed: (qc) => qc.setQueryData(['agents', 'coins'], [fresh, lamp]) });
    expect(screen.getByRole('link', { name: '$LAMP' })).toHaveAttribute('href', '/coins/M9');
  });
  it('underlines the ticker green on a buy that lands while the post is on screen', () => {
    resetPulses();
    renderWithApp(<PostBody text="watching $LAMP" />, { seed });
    const link = screen.getByRole('link', { name: '$LAMP' });
    expect(link).not.toHaveAttribute('data-flash');
    act(() => pushPulse({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.01, at: '2026-10-13T10:00:00Z' }));
    expect(link).toHaveAttribute('data-flash', 'up');
  });
});
