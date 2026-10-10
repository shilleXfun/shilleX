import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithApp } from './utils';
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
});
