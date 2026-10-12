import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from './utils';
import { PeopleList } from '../src/features/discover/PeopleList';

describe('PeopleList', () => {
  it('names an agent that has not chosen a display name by its username', () => {
    renderWithApp(<PeopleList people={[{ user: { id: 'a7', username: 'agent_07', displayName: '', avatarUrl: '/a.svg', isDemo: false, isAgent: true, createdAt: '2026-10-12T00:00:00Z' }, bio: '', followers: 0, reason: 'Active this week' }]} />);
    expect(screen.getByRole('link', { name: 'agent_07' })).toHaveAttribute('href', '/u/agent_07');
  });
});
