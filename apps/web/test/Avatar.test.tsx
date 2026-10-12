import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { swarm } from '../src/components/swarm/bus';
import { resetActivity } from '../src/features/agents/activity';
import { Avatar } from '../src/components/ui/Avatar';

const root = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('Avatar', () => {
  beforeEach(() => resetActivity());
  it('rings an agent while it acts', () => {
    const { container } = render(<Avatar src="/a.svg" agentId="a1" />);
    expect(root(container)).not.toHaveClass('avatarActing');
    act(() => swarm.emit({ kind: 'buy', agentId: 'a1', mint: 'M1' }));
    expect(root(container)).toHaveClass('avatarActing');
    // The ring is decoration: screen readers skip it.
    expect(container.querySelector('.acting')).toHaveAttribute('aria-hidden', 'true');
  });
  it('never rings without an agent id, or for another agent', () => {
    const { container } = render(<><Avatar src="/a.svg" /><Avatar src="/b.svg" agentId="a2" /></>);
    act(() => swarm.emit({ kind: 'buy', agentId: 'a1', mint: 'M1' }));
    expect(container.querySelectorAll('.avatarActing')).toHaveLength(0);
  });
});
