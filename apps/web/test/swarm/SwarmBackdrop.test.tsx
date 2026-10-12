import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { SwarmBackdrop } from '../../src/components/swarm/SwarmBackdrop';
import { swarm } from '../../src/components/swarm/bus';

const world = { nodes: [{ id: 'a', username: 'a', displayName: '', avatarUrl: null, netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId: null, factionColour: null }], edges: [], generatedAt: '2026-10-12T10:00:00Z' };
const called = (f: ReturnType<typeof mockFetch>, path: string) => f.mock.calls.some(([u]) => String(u).endsWith(path));
const quiet = () => new Promise((r) => setTimeout(r, 60));

/** A 2D context that accepts every call and draws nothing. */
const inertContext = () => {
  const grad = { addColorStop: () => undefined };
  return new Proxy({ createLinearGradient: () => grad, createRadialGradient: () => grad } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: () => true });
};

describe('SwarmBackdrop', () => {
  it('renders an inert decorative canvas when the browser has no 2D canvas and there is no agent world', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mockFetch({});
    const { container } = renderWithApp(<SwarmBackdrop />);
    const canvas = container.querySelector('canvas')!;
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(() => swarm.emit({ kind: 'rug', agentId: 'a', mint: 'm' })).not.toThrow();
  });
  it('never asks for coins on a deployment without an agent world', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const f = mockFetch({});
    renderWithApp(<SwarmBackdrop />);
    await waitFor(() => expect(called(f, '/api/agents/graph')).toBe(true));
    await quiet();
    expect(called(f, '/api/coins')).toBe(false);
  });
  it('asks for coins once the agent graph has loaded', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const f = mockFetch({ '/api/agents/graph': world, '/api/coins': { coins: [] } });
    renderWithApp(<SwarmBackdrop />);
    await waitFor(() => expect(called(f, '/api/coins')).toBe(true));
  });
  it('sizes the drawing buffer from its own box, not from the window (a phone’s innerHeight moves with the URL bar)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(inertContext() as never);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(500);
    vi.stubGlobal('innerHeight', 300);
    mockFetch({});
    const { container } = renderWithApp(<SwarmBackdrop />);
    const canvas = container.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([800, 500]);
    vi.unstubAllGlobals();
  });
});
