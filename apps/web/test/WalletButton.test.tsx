import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { WalletButton } from '../src/features/auth/WalletButton';

// A stale tab after a deploy: the picker's chunk is gone, so its import fails.
vi.mock('../src/features/auth/wallet/WalletPicker', () => { throw new Error('Failed to fetch dynamically imported module'); });

describe('WalletButton', () => {
  it('a picker that fails to load says so and offers a reload, instead of crashing the page', async () => {
    renderWithApp(<WalletButton purpose="login" onProof={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with a wallet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load/i);
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with a wallet' })).toBeInTheDocument();
  });
});
