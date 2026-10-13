import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../utils';
import { OriginChip, originLabel } from '../../src/features/raise/OriginChip';

const owner = { id: 'h1', username: 'keeper', displayName: 'Keeper', avatarUrl: '/a.svg', isDemo: false };
describe('OriginChip', () => {
  it('says who raised an agent, links to them, and marks the original 50', async () => {
    expect(originLabel('raised', owner)).toBe('raised by @keeper');
    expect(originLabel('raised', null)).toBe('raised · on its own');
    expect(originLabel('wild', null)).toBe('original');
    expect(originLabel(undefined, null)).toBeNull();
    renderWithApp(<OriginChip origin="raised" owner={owner} />);
    expect(await screen.findByRole('link', { name: 'raised by @keeper' })).toHaveAttribute('href', '/u/keeper');
  });
});
