import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
vi.mock('../../src/lib/socket', () => ({ useSocketEvent: () => undefined }));
import { GraphPage, placeLabels } from '../../src/features/agents/GraphPage';
import { pushPulse, resetPulses } from '../../src/features/agents/pulses';

const node = (id: string, name: string, factionId: string | null) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', netWorthSol: 0.1, mood: 0, ghost: false, reputation: 0, factionId, factionColour: factionId ? '#27e0c0' : null });
const graph = { nodes: [node('a1', 'Nine', 'f1'), node('a2', 'Ember', 'f1'), node('a3', 'Ledger', null)], edges: [{ a: 'a1', b: 'a2', score: 0.8 }, { a: 'a1', b: 'a3', score: -0.7 }], generatedAt: '2026-10-11T12:00:00Z' };
const user = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
const lamp = { id: 'f1', name: 'Lamp Cult', colour: '#27e0c0' };
// GET /api/agents/overview: the page reads faction names from its moods.
const overview = {
  movers: { up: [], down: [] }, feuds: [], launches: [], rugs: [],
  moods: [
    { user: user('a1', 'Nine'), mood: 0, pnlSol: 0, faction: lamp, broke: false, ghost: false },
    { user: user('a2', 'Ember'), mood: 0, pnlSol: 0, faction: lamp, broke: false, ghost: false },
    { user: user('a3', 'Ledger'), mood: 0, pnlSol: 0, faction: null, broke: false, ghost: false },
  ],
};
const pulse = (agentId: string, kind: 'buy' | 'sell' | 'launch') => ({ kind, agentId, mint: 'M1', sol: 0.01, at: '2026-10-11T12:00:00Z' });
const flashOf = (name: string) => screen.getByRole('link', { name }).querySelector('[data-flash]')?.getAttribute('data-flash') ?? null;
afterEach(() => { vi.restoreAllMocks(); resetPulses(); });

describe('GraphPage', () => {
  it('draws a node per agent with links to their pages, and a readable table', async () => {
    mockFetch({ '/api/agents/graph': graph });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    expect(await screen.findByRole('link', { name: 'Nine' })).toHaveAttribute('href', '/agents/nine');
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(2);
    const table = screen.getByRole('table', { name: 'Who likes whom' });
    expect(table).toHaveTextContent(/Nine.*Ember.*Ledger/);
  });

  it('names each agent’s faction, closest ally and worst enemy in the table', async () => {
    mockFetch({ '/api/agents/graph': graph, '/api/agents/overview': overview });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    const table = await screen.findByRole('table', { name: 'Who likes whom' });
    expect(await within(table).findAllByText('Lamp Cult')).toHaveLength(2);
    const nine = within(table).getByRole('row', { name: /^Nine/ });
    expect(nine).toHaveTextContent(/Ember \(\+0\.80\)/);
    expect(nine).toHaveTextContent(/Ledger \(−0\.70\)/);
    const ledger = within(table).getByRole('row', { name: /^Ledger/ });
    expect(ledger).toHaveTextContent(/On their own/);
    expect(ledger).toHaveTextContent(/Nine \(−0\.70\)/);
  });

  it('keys a faction with its banner and its coin, linked', async () => {
    const view = { ...lamp, banner: 'a lamp', bannerUrl: '/api/blobs/B1', coinMint: 'M1', conversationId: null, formedAt: '2026-10-09T00:00:00Z', splitAt: null, members: [] };
    const coin = { mint: 'M1', pool: 'P', name: 'Lamp', symbol: 'LAMP', description: '', emoji: '💡', creator: user('a1', 'Nine'), launchedAt: '2026-10-10T10:00:00Z', launchSignature: 'S',
      priceSol: 0.00002, marketCapSol: 20, curveProgress: 0.42, holders: 3, volume24hSol: 0.5, devSoldPct: 5, graduated: false };
    mockFetch({ '/api/agents/graph': graph, '/api/agents/overview': overview, '/api/factions': { factions: [view] }, '/api/coins': { coins: [coin] } });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    const key = await screen.findByRole('list', { name: 'Factions' });
    expect(await within(key).findByRole('img', { name: 'Lamp Cult banner' })).toHaveAttribute('src', '/api/blobs/B1');
    expect(await within(key).findByRole('link', { name: '$LAMP' })).toHaveAttribute('href', '/coins/M1');
  });

  it('counts only real feuds (−0.4 or worse), as the Agents page and the backdrop do: mild dislike is neither drawn nor counted', async () => {
    const mild = { ...graph, edges: [...graph.edges, { a: 'a2', b: 'a3', score: -0.3 }] };
    mockFetch({ '/api/agents/graph': mild });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    await screen.findByRole('link', { name: 'Nine' });
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(2);
    expect(screen.getByText('3 agents · 1 alliance · 1 feud')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Who likes whom' });
    // Ember's only dislike is the mild one: no worst enemy. Ledger's is the real feud with Nine.
    expect(within(table).getByRole('row', { name: /^Ember/ })).toHaveTextContent(/Ember.*\+0\.80\).*None$/);
    expect(within(table).getByRole('row', { name: /^Ledger/ })).toHaveTextContent(/Nine \(−0\.70\)/);
  });

  it('says there are no alliances or feuds when the only ties are mild dislike', async () => {
    mockFetch({ '/api/agents/graph': { ...graph, edges: [{ a: 'a1', b: 'a3', score: -0.3 }] } });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    await screen.findByRole('link', { name: 'Nine' });
    expect(screen.queryAllByTestId('graph-edge')).toHaveLength(0);
    expect(screen.getByText('3 agents · 0 alliances · 0 feuds')).toBeInTheDocument();
    expect(screen.getByText('No alliances or feuds yet.', { exact: false })).toBeInTheDocument();
  });

  it('names a faction’s banner from the factions list as soon as it loads, even before the overview does', async () => {
    const view = { ...lamp, banner: 'a lamp', bannerUrl: '/api/blobs/B1', coinMint: null, conversationId: null, formedAt: '2026-10-09T00:00:00Z', splitAt: null, members: [] };
    mockFetch({ '/api/agents/graph': graph, '/api/factions': { factions: [view] } }); // no overview
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    const key = await screen.findByRole('list', { name: 'Factions' });
    expect(await within(key).findByRole('img', { name: 'Lamp Cult banner' })).toBeInTheDocument();
    expect(within(key).getByText('Lamp Cult')).toBeInTheDocument();
  });

  it('shortens a long name without splitting an emoji', async () => {
    const long = { ...node('a1', 'x'.repeat(14) + '👨‍👩‍👧‍👦' + 'tail', null), username: 'xl' };
    mockFetch({ '/api/agents/graph': { ...graph, nodes: [long], edges: [] } });
    const { container } = renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    await screen.findByRole('link', { name: /^x+/ });
    const labels = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
    expect(labels).toContain('x'.repeat(14) + '👨‍👩‍👧‍👦' + '…');
  });

  it('names an agent that has not named itself by its username', async () => {
    mockFetch({ '/api/agents/graph': { ...graph, nodes: [{ ...node('a1', 'Nine', null), username: 'agent_07', displayName: '' }] , edges: [] } });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    expect(await screen.findByRole('link', { name: 'agent_07' })).toHaveAttribute('href', '/agents/agent_07');
    expect(screen.getByText('No alliances or feuds yet.', { exact: false })).toBeInTheDocument();
  });

  it('flashes a trader’s node as its trade lands, green for a buy and red for a sale', async () => {
    pushPulse(pulse('a3', 'buy')); // before the page opened: no flash
    mockFetch({ '/api/agents/graph': graph });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    await screen.findByRole('link', { name: 'Nine' });
    expect(flashOf('Ledger')).toBeNull();
    // Fake time from here, so the flashes can be seen to clear.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      act(() => { pushPulse(pulse('a1', 'buy')); pushPulse(pulse('a2', 'sell')); pushPulse(pulse('a3', 'launch')); });
      expect(flashOf('Nine')).toBe('up');
      expect(flashOf('Ember')).toBe('down');
      expect(flashOf('Ledger')).toBeNull();
      // A later sale by the same agent replaces its buy; every flash clears after a moment.
      act(() => { pushPulse(pulse('a1', 'sell')); });
      expect(flashOf('Nine')).toBe('down');
      act(() => { vi.advanceTimersByTime(1700); });
      expect(flashOf('Nine')).toBeNull();
      expect(flashOf('Ember')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('keeps the links in one order whatever the agents are worth, and gives small agents a big enough target', async () => {
    const nodes = [{ ...node('a1', 'Nine', null), netWorthSol: 0.1 }, { ...node('a2', 'Ember', null), netWorthSol: 0.5 }, { ...node('a3', 'Ledger', null), netWorthSol: 0.001 }];
    mockFetch({ '/api/agents/graph': { ...graph, nodes: [nodes[2], nodes[0], nodes[1]], edges: [] } });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    await screen.findByRole('link', { name: 'Nine' });
    // By agent id, so tab order and focus stay put when net worth (and so drawing order) changes on a refetch.
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual(['Nine', 'Ember', 'Ledger']);
    const hit = screen.getByRole('link', { name: 'Ledger' }).querySelector('circle'); // the link's first circle is its target
    expect(Number(hit?.getAttribute('r'))).toBeGreaterThanOrEqual(12);
  });

  it('lets a happy agent’s halo breathe quicker, and shows today’s counters while there are no ties', async () => {
    mockFetch({
      '/api/agents/graph': { ...graph, nodes: [{ ...node('a1', 'Nine', null), mood: 1 }], edges: [] },
      '/api/agents/overview': { ...overview, today: { trades: 31, launches: 4, rugs: 1, volumeSol: 1.25 } },
    });
    const { container } = renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    await screen.findByRole('link', { name: 'Nine' });
    // The drawn body (aria-hidden, under the links): its first circle is the halo.
    const body = [...container.querySelectorAll('svg g[aria-hidden="true"] > g[transform]')].find((g) => g.querySelector('circle'));
    expect(body?.querySelector('circle')?.getAttribute('style')).toContain('--breath: 3s');
    expect(await screen.findByText('31')).toBeInTheDocument();
  });

  it('says so when this deployment has no agent world', async () => {
    mockFetch({});
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    expect(await screen.findByText('No agent world here')).toBeInTheDocument();
  });

  it('offers a retry when the graph fails to load', async () => {
    mockFetch({ '/api/agents/graph': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'Something broke' }), { status: 500 }) });
    renderWithApp(<GraphPage />, { route: '/graph', path: '/graph' });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('placeLabels', () => {
  // A label is 13 px tall, its text is 10.5 px Geist Mono (0.62 em a character), and its baseline sits 10 px below its top.
  const box = (text: string, sp: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }) => {
    const w = text.length * 10.5 * 0.62;
    return { x: sp.anchor === 'middle' ? sp.x - w / 2 : sp.anchor === 'end' ? sp.x - w : sp.x, y: sp.y - 10, w, h: 13 };
  };
  const overlap = (p: ReturnType<typeof box>, q: { x: number; y: number; w: number; h: number }) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

  it('puts a lone agent’s label under it', () => {
    const spot = placeLabels([{ id: 'a', x: 100, y: 100, r: 10, text: 'Nine' }], 200, 200).get('a');
    expect(spot).toMatchObject({ x: 100, anchor: 'middle' });
    expect(spot!.y).toBeGreaterThan(110);
  });

  it('keeps labels inside the drawing, off each other and off other agents, and leaves out the ones that do not fit', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, x: 22 + (i % 8) * 42, y: 22 + Math.floor(i / 8) * 42, r: 8 + (i % 3) * 3, text: `agent_${i}` }));
    const spots = placeLabels(nodes, 340, 220);
    const placed = nodes.flatMap((n) => { const sp = spots.get(n.id); return sp ? [{ n, b: box(n.text, sp) }] : []; });
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(nodes.length);
    for (const { n, b } of placed) {
      expect(b.x).toBeGreaterThanOrEqual(2); expect(b.x + b.w).toBeLessThanOrEqual(338);
      expect(b.y).toBeGreaterThanOrEqual(2); expect(b.y + b.h).toBeLessThanOrEqual(218);
      for (const o of placed) if (o.n !== n) expect(overlap(b, o.b)).toBe(false);
      for (const m of nodes) if (m !== n) expect(overlap(b, { x: m.x - m.r, y: m.y - m.r, w: 2 * m.r, h: 2 * m.r })).toBe(false);
    }
  });
});
