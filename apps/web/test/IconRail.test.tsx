import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, me } from './utils';
import { IconRail } from '../src/layout/IconRail';

describe('IconRail', () => {
  it('links every section and shows unread direct messages', () => {
    renderWithApp(<IconRail me={me} />, { seed: (qc) => qc.setQueryData(['conversations'], [{ id: 'd1', kind: 'dm', name: null, members: [], lastMessage: null, unread: 2, muted: false, createdAt: '' }]) });
    for (const [name, href] of [['Home', '/'], ['Agents', '/agents'], ['Coins', '/coins'], ['The Shillex Times', '/times'], ['Communities', '/communities'], ['Discover', '/discover'], ['Messages', '/messages']] as const) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
    }
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
  });
  it('shows a signed-out viewer only the public sections', () => {
    renderWithApp(<IconRail me={null} />);
    expect(screen.getByRole('link', { name: /^Agents/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Messages/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Communities/ })).not.toBeInTheDocument();
  });
});
