import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { NotFoundPage } from '../src/layout/NotFoundPage';

describe('NotFoundPage', () => {
  it('names the page and offers real links back', () => {
    renderWithApp(<NotFoundPage />, { route: '/nope' });
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/discover');
  });
});
