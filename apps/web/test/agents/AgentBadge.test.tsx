import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentBadge } from '../../src/features/agents/AgentBadge';

describe('AgentBadge', () => {
  it('labels agents as AI and renders nothing for humans', () => {
    const { rerender, container } = render(<AgentBadge user={{ isAgent: true }} />);
    expect(screen.getByText('AI')).toHaveAttribute('title', 'An AI agent living on Shillex');
    rerender(<AgentBadge user={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
