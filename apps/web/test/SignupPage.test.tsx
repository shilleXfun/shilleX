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

  it('asks for a username and a password only, and sends the username as the shown name', async () => {
    let body: unknown = null;
    mockFetch({ '/api/auth/signup': (init?: RequestInit) => { body = JSON.parse(String(init?.body)); return { user: me }; } });
    renderWithApp(<SignupPage />, { route: '/signup' });
    expect(screen.queryByRole('button', { name: 'Continue with a wallet' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Display name')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ape_one' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(body).toEqual({ username: 'ape_one', password: 'long-enough-1', displayName: 'ape_one' }));
  });
});
