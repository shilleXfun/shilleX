import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { TokenView } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { TokenMention } from '../src/features/tokens/TokenMention';
import { useTokenPanel } from '../src/features/tokens/useTokenPanel';
import { pendingView, primeTokens, tokenKey } from '../src/features/tokens/tokenCache';
import { provenance } from '../src/features/tokens/TokenPreview';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const base: TokenView = { mint: MINT, status: 'resolved', source: 'live', name: 'Bonk', symbol: 'BONK', imageUrl: null, decimals: 5, liquidityUsd: 380000, marketCapUsd: 295000000, fdvUsd: null, pairAddress: null, dexId: 'orca', pairCreatedAt: '2022-12-25T00:00:00Z', promoted: false, fetchedAt: new Date().toISOString(), error: null };
const seed = (t: Partial<TokenView>) => (qc: any) => qc.setQueryData(['token', MINT], { ...base, ...t });
function PanelProbe() { const { mint } = useTokenPanel(); return <output data-testid="panel">{mint ?? ''}</output>; }

describe('TokenMention', () => {
  it('resolved: shows ticker, abbreviated address, full address accessible', () => {
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    expect(chip).toHaveTextContent('$BONK');
    expect(chip).toHaveTextContent('DezX…B263');
  });
  it('demo tokens carry a DEMO tag', () => {
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ source: 'demo' }) });
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });
  it('unindexed and error states are labeled honestly', () => {
    const { unmount } = renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'unindexed', symbol: null, name: null }) });
    expect(screen.getByRole('button')).toHaveTextContent('Unindexed mint');
    unmount();
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'error', symbol: null, error: 'dexscreener http 429' }) });
    expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load');
  });
  it('not_a_token renders as plain text, not a button', () => {
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'not_a_token' }) });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(MINT)).toBeInTheDocument();
  });
  it('pending: fetches via batch resolve and shows loading', async () => {
    const f = mockFetch({ '/api/tokens/resolve': { tokens: { [MINT]: { ...base, symbol: 'LATE' } } } });
    renderWithApp(<TokenMention mint={MINT} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('$LATE'));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('coalesces chips mounted together into one batch request', async () => {
    const OTHER = 'So11111111111111111111111111111111111111112';
    const f = mockFetch({ '/api/tokens/resolve': (init?: RequestInit) => {
      const { mints } = JSON.parse(String(init!.body)) as { mints: string[] };
      return { tokens: Object.fromEntries(mints.map((m) => [m, { ...base, mint: m, symbol: m === MINT ? 'BONK' : 'SOL' }])) };
    } });
    renderWithApp(<><TokenMention mint={MINT} /><TokenMention mint={OTHER} /><TokenMention mint={MINT} /></>);
    await waitFor(() => expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('$BONK'), expect.stringContaining('$SOL'), expect.stringContaining('$BONK')]));
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toEqual({ mints: [MINT, OTHER] });
  });
  it('a failed lookup becomes an honest error chip instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithApp(<TokenMention mint={MINT} />);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load'));
    expect(screen.getByRole('button', { name: /couldn’t load/ })).toBeInTheDocument();
  });
  it('error preview offers a retry that does a direct lookup', async () => {
    const f = mockFetch({ [`/api/tokens/${MINT}`]: { token: { ...base, symbol: 'BACK' }, links: [], stats: {} } });
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({ status: 'error', symbol: null, error: 'dexscreener http 429' }) });
    fireEvent.focus(screen.getByRole('button'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Couldn’t load: dexscreener http 429');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(MINT) })).toHaveTextContent('$BACK'));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('touch: first tap shows the preview, a second tap opens the panel', async () => {
    renderWithApp(<><TokenMention mint={MINT} /><PanelProbe /></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    const tap = () => { fireEvent.pointerDown(chip, { pointerType: 'touch' }); fireEvent.focus(chip); fireEvent.click(chip); };
    tap();
    expect(await screen.findByRole('dialog')).toHaveTextContent('Open token panel');
    expect(screen.getByTestId('panel')).toHaveTextContent('');
    tap();
    expect(screen.getByTestId('panel')).toHaveTextContent(MINT);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('focus opens the preview; click opens the side panel via the URL', async () => {
    renderWithApp(<><TokenMention mint={MINT} /><PanelProbe /></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    fireEvent.focus(chip);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Live · Dexscreener');
    fireEvent.click(chip);
    expect(screen.getByTestId('panel')).toHaveTextContent(MINT);
  });
});

describe('primeTokens', () => {
  it('never regresses a known token to pending or to older data', () => {
    const qc = new QueryClient();
    const fresh = { ...base, fetchedAt: '2026-10-09T12:00:00Z' };
    primeTokens(qc, { [MINT]: fresh });
    primeTokens(qc, { [MINT]: pendingView(MINT) });
    primeTokens(qc, { [MINT]: { ...base, symbol: 'OLD', fetchedAt: '2026-10-09T11:00:00Z' } });
    expect(qc.getQueryData(tokenKey(MINT))).toEqual(fresh);
    primeTokens(qc, { [MINT]: { ...base, symbol: 'NEW', fetchedAt: '2026-10-09T12:05:00Z' } });
    expect(qc.getQueryData<TokenView>(tokenKey(MINT))?.symbol).toBe('NEW');
  });
});

describe('provenance', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  it('describes each source and state honestly', () => {
    expect(provenance({ ...base, source: 'demo' }, now)).toBe('DEMO data — fictional token, not on-chain');
    expect(provenance({ ...base, fetchedAt: '2026-10-09T11:58:00Z' }, now)).toBe('Live · Dexscreener · fetched 2m ago');
    expect(provenance({ ...base, fetchedAt: '2026-10-09T11:59:45Z' }, now)).toBe('Live · Dexscreener · fetched just now');
    expect(provenance({ ...base, status: 'unindexed' }, now)).toBe('Verified token mint · no trading pair found on Dexscreener');
    expect(provenance({ ...base, status: 'error', error: 'rpc timeout' }, now)).toBe('Couldn’t load: rpc timeout');
    expect(provenance(pendingView(MINT), now)).toBe('Looking up this address…');
  });
});
