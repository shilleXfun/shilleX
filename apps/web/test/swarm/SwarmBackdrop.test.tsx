import { describe, it, expect, vi } from 'vitest';
import { renderWithApp, mockFetch } from '../utils';
import { SwarmBackdrop } from '../../src/components/swarm/SwarmBackdrop';
import { swarm } from '../../src/components/swarm/bus';

describe('SwarmBackdrop', () => {
  it('renders an inert decorative canvas when the browser has no 2D canvas and there is no agent world', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mockFetch({});
    const { container } = renderWithApp(<SwarmBackdrop />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(() => swarm.emit({ kind: 'rug', agentId: 'a', mint: 'm' })).not.toThrow();
  });
});
