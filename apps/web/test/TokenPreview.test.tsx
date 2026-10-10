import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { TokenPreview } from '../src/features/tokens/TokenPreview';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', COPY = 'So11111111111111111111111111111111111111112';
const token = { mint: MINT, status: 'resolved', source: 'demo', name: 'Grubworm', symbol: 'GRUB', imageUrl: null, decimals: null, liquidityUsd: 1000, marketCapUsd: 2000, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null } as const;

describe('TokenPreview', () => {
  it('warns in one line when other tokens here share the ticker', async () => {
    mockFetch({ '/api/tokens/search': { results: [{ token, mentions24h: 2 }, { token: { ...token, mint: COPY }, mentions24h: 1 }] } });
    renderWithApp(<TokenPreview token={token as never} onOpen={() => {}} />);
    expect(await screen.findByText(/Another token here also uses \$GRUB\. Check the address\./)).toBeInTheDocument();
  });
  it('says nothing when the ticker is unique here', async () => {
    mockFetch({ '/api/tokens/search': { results: [{ token, mentions24h: 2 }] } });
    renderWithApp(<TokenPreview token={token as never} onOpen={() => {}} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Check the address/)).toBeNull();
  });
});
