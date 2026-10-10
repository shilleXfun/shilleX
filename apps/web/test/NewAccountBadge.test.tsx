import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NewAccountBadge } from '../src/components/ui/NewAccountBadge';

const user = (daysAgo: number | null) => ({ id: 'x', username: 'x', displayName: 'X', avatarUrl: '/x.svg', isDemo: false, ...(daysAgo === null ? {} : { createdAt: new Date(Date.now() - daysAgo * 86_400_000 - 60_000).toISOString() }) });

describe('NewAccountBadge', () => {
  it('flags accounts under a week old, with when they joined for screen readers', () => {
    render(<NewAccountBadge user={user(2)} />);
    expect(screen.getByTitle('New account: joined 2 days ago')).toHaveTextContent('NEW');
    expect(screen.getByText('New account, joined 2 days ago')).toBeInTheDocument();
  });
  it('stays quiet for older accounts and when the join date is unknown', () => {
    const { container } = render(<><NewAccountBadge user={user(7)} /><NewAccountBadge user={user(null)} /></>);
    expect(container).toBeEmptyDOMElement();
  });
});
