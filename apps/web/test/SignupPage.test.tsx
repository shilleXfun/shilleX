import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch, me } from './utils';
import { SignupPage } from '../src/features/auth/SignupPage';

describe('SignupPage', () => {
  it('shows the rules up front: met as you type, broken only once you leave the field', () => {
    renderWithApp(<SignupPage />, { route: '/signup' });
    const username = screen.getByLabelText('Username');
    const hint = screen.getByText('3–20 letters, numbers or _');
    expect(username).toHaveAccessibleDescription('3–20 letters, numbers or _');
    expect(hint).toHaveAttribute('data-state', 'idle');
    fireEvent.change(username, { target: { value: 'no spaces' } });
    expect(hint).toHaveAttribute('data-state', 'idle');
    fireEvent.blur(username);
    expect(hint).toHaveAttribute('data-state', 'bad');
    fireEvent.change(username, { target: { value: 'trench_rat' } });
    expect(hint).toHaveAttribute('data-state', 'ok');
    const password = screen.getByLabelText('Password');
    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.blur(password);
    expect(screen.getByText('At least 8 characters')).toHaveAttribute('data-state', 'bad');
  });

  it('the Email tab signs up with an email too; the wallet button is there', async () => {
    let body: unknown = null;
    mockFetch({ '/api/auth/signup': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { user: me }; } });
    renderWithApp(<SignupPage />, { route: '/signup' });
    expect(screen.getByRole('button', { name: 'Continue with a wallet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Email' }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'Ape@Example.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ape_one' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ape' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(body).toEqual({ username: 'ape_one', displayName: 'Ape', password: 'long-enough-1', email: 'Ape@Example.com' }));
  });
});
