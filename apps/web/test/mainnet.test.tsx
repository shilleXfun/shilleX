import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MainnetAdminView, ReservesView } from '@shillex/shared';
import { renderWithApp, mockFetch } from './utils';
import { ReservesPage } from '../src/features/mainnet/ReservesPage';
import { AdminMainnetPanel } from '../src/features/mainnet/AdminMainnetPanel';
import { CoinSeasonNote } from '../src/features/mainnet/CoinSeasonNote';

afterEach(() => vi.restoreAllMocks());
const reserves: ReservesView = { mode: 'on', network: 'mainnet', hot: 'Hot1111', cold: 'Cold111', ledgerTotalSol: 4.2, onchainTotalSol: 4.5, lastCheckAt: '2026-11-20T10:00:00Z', lastPassAt: '2026-11-20T10:00:00Z', frozen: false };
const admin: MainnetAdminView = {
  mode: 'on', season: 'season1', frozen: null, hot: { address: 'Hot1111', sol: 2.5 }, cold: { address: 'Cold111', sol: 2 },
  books: { ledgerTotalSol: 4.2, houseSol: 1.1, ok: true, mismatches: [] }, lastReconciliation: { at: '2026-11-20T10:00:00Z', ok: true, details: {} },
  withdrawals: [{ id: 'w1', agentId: 'a1', lamports: 300_000_000, sol: 0.3, to: 'Payout1', status: 'queued', reason: 'the daily outflow limit is reached: it waits for the owner’s approval', position: 1, requestedAt: '2026-11-20T09:00:00Z', sentAt: null, signature: null }],
  fromCold: [], refundFailures: [], caps: { agentCapSol: 0.5, agentDailyCapSol: 0.1, userMonthlyCapSol: 1, worldCapSol: 25, hotMaxSol: 3, outflowDailyMaxSol: 5 },
  excessSol: 0, hotCoversTop10: true, notice: { version: 'n3', legalPosition: 'Counsel: allowed for adults.', publishedAt: '2026-11-01T00:00:00Z' },
  legalReview: { reviewer: 'A. Lawyer', date: '2026-11-01', note: 'ok', confirmedBy: 'admin' }, gate: [],
};

describe('proof of reserves', () => {
  it('shows the vaults, the books and the last passing check', async () => {
    mockFetch({ '/api/mainnet/reserves': reserves });
    renderWithApp(<ReservesPage />);
    expect(await screen.findByRole('heading', { name: 'Proof of reserves' })).toBeInTheDocument();
    expect(screen.getByText('Hot1111')).toBeInTheDocument();
    expect(screen.getByText('4.2 SOL')).toBeInTheDocument();
    expect(screen.getByText('4.5 SOL')).toBeInTheDocument();
  });
  it('says so plainly where there is no real-SOL world', async () => {
    mockFetch({});
    renderWithApp(<ReservesPage />);
    expect(await screen.findByText('No real SOL here')).toBeInTheDocument();
  });
});

describe('admin money panel', () => {
  it('renders nothing outside a ledger world', async () => {
    mockFetch({});
    const { container } = renderWithApp(<AdminMainnetPanel />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
  it('approves a held withdrawal with the admin password', async () => {
    const posted: unknown[] = [];
    mockFetch({
      '/api/admin/mainnet/status': admin,
      '/api/admin/mainnet/withdrawals/w1/approve': (init?: RequestInit) => { posted.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); },
    });
    renderWithApp(<AdminMainnetPanel />);
    expect(await screen.findByText(/daily outflow limit/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Admin password for money actions'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Approve 0.3 SOL' }));
    expect(posted).toEqual([{ password: 'pw' }]);
  });
  it('disables the money buttons while an action is on its way, so one press is one action (I4)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/admin/mainnet/status')) return new Response(JSON.stringify(admin), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Promise<Response>(() => {}); // the approval never answers
    });
    renderWithApp(<AdminMainnetPanel />);
    const approve = await screen.findByRole('button', { name: 'Approve 0.3 SOL' });
    await userEvent.type(screen.getByLabelText('Admin password for money actions'), 'pw');
    await userEvent.click(approve);
    expect(screen.getByRole('button', { name: 'Approve 0.3 SOL' })).toBeDisabled();
  });
  it('refunds a payment held for review to the address the admin types (I3)', async () => {
    const posted: unknown[] = [];
    mockFetch({
      '/api/admin/mainnet/status': { ...admin, refundFailures: [{ signature: 'sig1', sol: 0.02, from: 'Payer1', reason: 'SOL arrived, but not as one plain transfer', outcome: 'review', refundSignature: null }] },
      '/api/admin/mainnet/payments/sig1/resolve': (init?: RequestInit) => { posted.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); },
    });
    renderWithApp(<AdminMainnetPanel />);
    await userEvent.type(await screen.findByLabelText('Refund sig1 to'), 'Refund1');
    await userEvent.type(screen.getByLabelText('Admin password for money actions'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Refund 0.02 SOL' }));
    expect(posted).toEqual([{ password: 'pw', action: 'refund', to: 'Refund1' }]);
  });
  it('lists what still blocks MAINNET=on', async () => {
    mockFetch({ '/api/admin/mainnet/status': { ...admin, mode: 'rehearsal', gate: ['no legal review is recorded on /admin'] } });
    renderWithApp(<AdminMainnetPanel />);
    expect(await screen.findByText('no legal review is recorded on /admin')).toBeInTheDocument();
  });
});

describe('coin season note', () => {
  it('marks an archived coin and a real-SOL coin', () => {
    renderWithApp(<><CoinSeasonNote archived network="ledger" mainnet="on" /></>);
    expect(screen.getByText(/Archived/)).toBeInTheDocument();
  });
  it('says nothing for a live devnet coin', () => {
    const { container } = renderWithApp(<CoinSeasonNote archived={false} network="devnet" mainnet="off" />);
    expect(container.textContent).toBe('');
  });
});
