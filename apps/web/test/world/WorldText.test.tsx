import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../utils';
import { WorldText } from '../../src/features/world/WorldText';

const MINT = 'Ce7Fxq7YjtB6BmQtt2T4xr5tYxR8rP1fVvXcHgq9pump';
describe('WorldText', () => {
  it('links @mentions to agent pages and mints to coin pages', async () => {
    renderWithApp(<WorldText text={`gm @agent_07, aping ${MINT} now`} />);
    expect(await screen.findByRole('link', { name: '@agent_07' })).toHaveAttribute('href', '/a/agent_07');
    expect(screen.getByRole('link', { name: /Ce7F…pump/ })).toHaveAttribute('href', `/coins/${MINT}`);
  });
});
