import { useEffect, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { socket } from '../src/lib/socket';
import type { TokenView } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { TokenMention } from '../src/features/tokens/TokenMention';
import { Dialog } from '../src/components/ui/Dialog';
import { useTokenPanel } from '../src/features/tokens/useTokenPanel';
import { pendingView, primeTokens, tokenKey, useTokenEvents } from '../src/features/tokens/tokenCache';
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
    // A real tap gives no focus (iOS) or a non-focus-visible focus (Android), so no focus event is simulated.
    const tap = () => { fireEvent.pointerDown(chip, { pointerType: 'touch' }); fireEvent.pointerUp(chip, { pointerType: 'touch' }); fireEvent.click(chip); };
    tap();
    expect(await screen.findByRole('dialog')).toHaveTextContent('Open token panel');
    expect(screen.getByTestId('panel')).toHaveTextContent('');
    tap();
    expect(screen.getByTestId('panel')).toHaveTextContent(MINT);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('touch: tapping outside dismisses the preview (WebKit gives no blur)', async () => {
    renderWithApp(<><TokenMention mint={MINT} /><p>elsewhere</p></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    fireEvent.pointerDown(chip, { pointerType: 'touch' }); fireEvent.click(chip);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('dialog'), { pointerType: 'touch' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('elsewhere'), { pointerType: 'touch' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('a stale touch press does not hijack a later keyboard activation', () => {
    renderWithApp(<><TokenMention mint={MINT} /><PanelProbe /></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    fireEvent.pointerDown(chip, { pointerType: 'touch' }); fireEvent.pointerCancel(chip, { pointerType: 'touch' });
    fireEvent.keyDown(chip, { key: 'Enter' }); fireEvent.click(chip);
    expect(screen.getByTestId('panel')).toHaveTextContent(MINT);
  });
  it('a focus that is not focus-visible (pointer press, focus returned from the panel) does not open the preview', async () => {
    const matches = HTMLElement.prototype.matches;
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) { return sel === ':focus-visible' ? false : matches.call(this, sel); });
    renderWithApp(<TokenMention mint={MINT} />, { seed: seed({}) });
    act(() => screen.getByRole('button').focus());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('closing the panel returns focus to the chip without reopening its preview (even for keyboard focus)', async () => {
    function Closer() { const { mint, close } = useTokenPanel(); return mint ? <button type="button" onClick={close}>Close panel</button> : null; }
    // Chrome after a keyboard close: the programmatic focus return matches :focus-visible (jsdom's answer is unreliable).
    const matches = HTMLElement.prototype.matches;
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, sel: string) { return sel === ':focus-visible' ? true : matches.call(this, sel); });
    renderWithApp(<><TokenMention mint={MINT} /><Closer /></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(chip).toHaveFocus()); // jsdom: a focused element matches :focus-visible
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keyboard: Tab moves into the preview; Tab past the end, Shift+Tab before the start and Esc return to the chip and close', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TokenMention mint={MINT} /><button type="button">after</button></>, { seed: seed({}) });
    const chip = screen.getByRole('button', { name: new RegExp(MINT) });
    const into = async () => {
      act(() => chip.blur()); await user.tab();
      expect(chip).toHaveFocus();
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Copy full address' })).toHaveFocus();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    };
    const backOnChipClosed = async () => {
      expect(chip).toHaveFocus();
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.queryByRole('dialog')).toBeNull();
    };
    await into();
    await user.tab(); // Open token panel (last)
    expect(screen.getByRole('button', { name: 'Open token panel' })).toHaveFocus();
    await user.tab();
    await backOnChipClosed();
    await into();
    await user.tab({ shift: true });
    await backOnChipClosed();
    await into();
    await user.keyboard('{Escape}');
    await backOnChipClosed();
    // ArrowDown also enters the preview
    act(() => chip.blur()); await user.tab();
    await screen.findByRole('dialog');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Copy full address' })).toHaveFocus();
  });
  it('clicks inside the preview do not bubble to the post card behind the chip', async () => {
    const onCard = vi.fn();
    renderWithApp(<div onClick={onCard}><TokenMention mint={MINT} /></div>, { seed: seed({}) });
    fireEvent.focus(screen.getByRole('button'));
    fireEvent.click(await screen.findByRole('dialog'));
    expect(onCard).not.toHaveBeenCalled();
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

describe('token polling', () => {
  const OTHER = 'So11111111111111111111111111111111111111112';
  const T0 = Date.parse('2026-10-09T12:00:00.000Z'); // a multiple of 4000 ms: a shared poll tick
  const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: T0 });
  // Small act() steps so React commits state set by timers (e.g. a chip mounting mid-way) before time moves on.
  const advance = async (ms: number) => { for (let t = 0; t < ms; t += 50) await act(() => vi.advanceTimersByTimeAsync(Math.min(50, ms - t))); };
  const bodies = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as { mints: string[] }).mints);
  const allPending = (init?: RequestInit) => ({ tokens: Object.fromEntries((JSON.parse(String(init!.body)) as { mints: string[] }).mints.map((m) => [m, pendingView(m)])) });
  afterEach(() => { vi.useRealTimers(); });

  it('stops after 6 failed polls and shows the error, not a silent "Loading"', async () => {
    fake();
    const f = mockFetch({ '/api/tokens/resolve': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'upstream exploded' }), { status: 500 }) });
    renderWithApp(<TokenMention mint={MINT} />);
    await advance(100);
    expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load');
    await advance(120_000);
    expect(f).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load');
  });
  it('an error after a pending answer shows the error view', async () => {
    fake();
    let n = 0;
    mockFetch({ '/api/tokens/resolve': (init?: RequestInit) => (++n === 1 ? allPending(init) : new Response(JSON.stringify({ code: 'INTERNAL', message: 'boom' }), { status: 500 })) });
    renderWithApp(<TokenMention mint={MINT} />);
    await advance(100);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    await advance(4000);
    expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load');
  });
  it('a 429 stops polling for that token', async () => {
    fake();
    const f = mockFetch({ '/api/tokens/resolve': () => new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'Slow down' }), { status: 429 }) });
    renderWithApp(<TokenMention mint={MINT} />);
    await advance(60_000);
    expect(f).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveTextContent('Couldn’t load');
  });
  it('pending chips mounted ~2 s apart poll on one shared tick, in one request', async () => {
    fake();
    const f = mockFetch({ '/api/tokens/resolve': allPending });
    function Staggered() {
      const [late, setLate] = useState(false);
      useEffect(() => { const t = setTimeout(() => setLate(true), 2000); return () => clearTimeout(t); }, []);
      return <><TokenMention mint={MINT} />{late && <TokenMention mint={OTHER} />}</>;
    }
    renderWithApp(<Staggered />);
    await advance(2100);
    expect(bodies(f)).toEqual([[MINT], [OTHER]]); // each chip's first lookup
    await advance(8000);
    const polls = bodies(f).slice(2);
    expect(polls.length).toBe(2);
    for (const p of polls) expect([...p].sort()).toEqual([MINT, OTHER].sort());
  });
  it('socket pushes never regress a token, and a reconnect re-checks tokens still pending', async () => {
    fake();
    function Events() { useTokenEvents(); return null; }
    const f = mockFetch({ '/api/tokens/resolve': allPending });
    const { qc } = renderWithApp(<><Events /><TokenMention mint={MINT} /></>, {
      seed: (c) => { c.setQueryData(tokenKey(MINT), pendingView(MINT)); c.setQueryData(tokenKey(OTHER), { ...base, mint: OTHER, fetchedAt: '2026-10-09T11:59:00Z' }); },
    });
    const push = (token: TokenView) => act(() => { (socket as unknown as { emitEvent(a: unknown[]): void }).emitEvent(['token:resolved', { token }]); });
    push({ ...base, mint: OTHER, symbol: 'OLD', fetchedAt: '2026-10-09T11:00:00Z' });
    expect(qc.getQueryData<TokenView>(tokenKey(OTHER))?.symbol).toBe('BONK');
    act(() => { (socket as unknown as { emitReserved(e: string): void }).emitReserved('connect'); });
    await advance(100);
    expect(bodies(f)).toEqual([[MINT]]);
    push({ ...base, symbol: 'LIVE' });
    await advance(50);
    expect(screen.getByRole('button')).toHaveTextContent('$LIVE');
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
    expect(provenance({ ...base, fetchedAt: null }, now)).toBe('Live · Dexscreener · fetch time unknown');
    expect(provenance({ ...base, status: 'unindexed' }, now)).toBe('Verified token mint · no trading pair found on Dexscreener');
    expect(provenance({ ...base, status: 'error', error: 'rpc timeout' }, now)).toBe('Couldn’t load: rpc timeout');
    expect(provenance(pendingView(MINT), now)).toBe('Looking up this address…');
  });
});

describe('TokenMention inside a modal Dialog', () => {
  // Popovers and the token panel render outside the modal's top layer, so a chip there would open something unusable.
  it('renders a static chip with the same label and no button', () => {
    renderWithApp(<Dialog open onClose={() => {}} title="Quote post"><TokenMention mint={MINT} /></Dialog>, { seed: seed({ source: 'demo' }) });
    expect(screen.queryByRole('button', { name: new RegExp(MINT) })).toBeNull();
    const chip = screen.getByTitle(MINT);
    expect(chip).toHaveTextContent('$BONK');
    expect(chip).toHaveTextContent('DEMO');
  });
});
