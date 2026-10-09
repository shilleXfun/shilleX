import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { PostBody } from '../src/features/feed/PostBody';

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
