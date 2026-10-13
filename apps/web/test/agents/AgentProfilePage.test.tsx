import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp, mockFetch } from '../utils';
import { AgentProfilePage, solSeries } from '../../src/features/agents/AgentProfilePage';
import { pushPulse, resetPulses } from '../../src/features/agents/pulses';

const u = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
const agent = (id: string, name: string) => ({ ...u(id, name), isAgent: true as const });
const traits = { risk: 0.8, chattiness: 0.6, loyalty: 0.3, pettiness: 0.9, greed: 0.4, humor: 0.7, curiosity: 0.5 };
// GET /api/agents/nine → { agent: AgentDetail } (Phase 1.3)
const detail = {
  user: u('a1', 'Nine'), bio: 'say what the numbers say', status: 'active', publicKey: 'PK', solBalance: 0.07, tokenValueSol: 0.03, totalSol: 0.1, pnlSol: 0.01, coinsLaunched: 1, rugs: 1, turns: 40, lastTurnAt: null,
  positions: [{ mint: 'M1', symbol: 'MOTH', emoji: '🦋', tokens: 1000, valueSol: 0.03, costSol: 0.02 }], memory: [], chainHead: { hash: null, count: 0 },
};
// GET /api/agents/nine/depth → AgentDepthView (Phase 4.11)
const depth = {
  voice: 'Dry, numerical, a little smug.', traits, mood: -0.3, reputation: 0.42,
  traitHistory: [{ day: '2026-10-10', traits: { ...traits, pettiness: 0.4 } }, { day: '2026-10-11', traits }],
  faction: { id: 'f1', name: 'Lamp Cult', banner: '', bannerUrl: null, colour: '#27e0c0', coinMint: null, conversationId: null, formedAt: '2026-10-09T00:00:00Z', splitAt: null, members: [] },
  allies: [{ user: u('a2', 'Ember'), affinity: 0.8 }], enemies: [{ user: u('a3', 'Ledger'), affinity: -0.9 }],
  saidVsDid: [{ postId: 'p1', mint: 'M1', side: 'sell', said: 'holding $MOTH forever', did: 'sold $MOTH', at: '2026-10-11T11:00:00Z' }],
  debts: { lent: 0, borrowed: 0, defaulted: 0, owesSol: 0, recent: [] }, inventions: [], broke: false, ghost: false,
};
const coin = (mint: string, symbol: string) => ({ mint, pool: 'P', name: symbol, symbol, description: '', emoji: '💡', creator: agent('a1', 'Nine'), launchedAt: '2026-10-10T10:00:00Z', launchSignature: 'S',
  priceSol: 0.00002, marketCapSol: 20, curveProgress: 0.42, holders: 3, volume24hSol: 0.5, devSoldPct: 5, graduated: false });
// GET /api/lineage/L1 → LineageView
const lineage = { id: 'L1', text: 'ngmi {user}', kind: 'line', inventor: agent('a1', 'Nine'), adopters: [agent('a2', 'Ember'), agent('a3', 'Ledger')], uses: 14, createdAt: '2026-10-09T10:00:00Z' };
const debt = (id: string, side: 'lent' | 'borrowed', who: ReturnType<typeof agent>, sol: number, state: 'open' | 'repaid' | 'dodged') => ({ id, side, counterpart: who, sol, state, at: '2026-10-10T10:00:00Z' });
const owing = { lent: 1, borrowed: 2, defaulted: 1, owesSol: 0.04, recent: [
  debt('d2', 'borrowed', agent('a2', 'Ember'), 0.04, 'open'), debt('d3', 'lent', agent('a3', 'Ledger'), 0.01, 'repaid'), debt('d1', 'borrowed', agent('a4', 'Quill'), 0.02, 'dodged'),
] };
const vital = (label: string) => screen.queryByText(label, { selector: 'dt' })?.parentElement ?? null;
// Longer paths first: mockFetch matches by prefix in key order.
const trades = [
  { signature: 'S3', agent: u('a1', 'Nine'), kind: 'sell', mint: 'M1', symbol: 'MOTH', sol: 0.03, tokens: -1000, counterparty: null, createdAt: '2026-10-11T12:00:00Z', turnId: null },
  { signature: 'S2', agent: u('a1', 'Nine'), kind: 'buy', mint: 'M1', symbol: 'MOTH', sol: -0.02, tokens: 1000, counterparty: null, createdAt: '2026-10-11T11:00:00Z', turnId: null },
];
const routes = (d: object = depth) => ({ '/api/agents/nine/depth': d, '/api/agents/nine/receipts': { turns: [] }, '/api/agents/nine/trades': { trades }, '/api/agents/nine': { agent: detail } });
afterEach(() => vi.restoreAllMocks());

describe('AgentProfilePage', () => {
  it('shows voice, faction, allies and enemies, positions and said-vs-did', async () => {
    mockFetch(routes());
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nine' })).toBeInTheDocument();
    expect(screen.getByText('Dry, numerical, a little smug.')).toBeInTheDocument();
    expect(screen.getByText('Lamp Cult')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Allies' })).getByText('Ember')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Enemies' })).getByText('Ledger')).toBeInTheDocument();
    const svd = screen.getByRole('region', { name: 'Said vs did' });
    expect(within(svd).getByText('holding $MOTH forever')).toBeInTheDocument();
    expect(within(svd).getByText('sold $MOTH')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /pettiness 90%/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Positions' })).getByText(/\$MOTH/)).toBeInTheDocument();
    // No inventions, no debts, and a faction with no banner or coin: no empty cards, no figure, no broken image.
    expect(screen.queryByRole('region', { name: 'Inventions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Debts' })).not.toBeInTheDocument();
    expect(vital('Debts')).toBeNull();
    expect(screen.queryByRole('img', { name: /banner/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('img:not([src])')).toHaveLength(0);
  });

  it('lists the lines the agent invented, with their uses and how many agents adopted them', async () => {
    mockFetch(routes({ ...depth, inventions: [{ id: 'L1', text: 'ngmi {user}', uses: 14, adopters: 3 }, { id: 'L2', text: 'wagmi / or not', uses: 1, adopters: 0 }] }));
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    const card = await screen.findByRole('region', { name: 'Inventions' });
    const rows = within(card).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ngmi user');
    expect(rows[0]).toHaveTextContent('14 uses');
    expect(rows[0]).toHaveTextContent('3 adopted');
    expect(rows[1]).toHaveTextContent('wagmi / or not');
    expect(rows[1]).toHaveTextContent('1 use');
    expect(rows[1]).toHaveTextContent('0 adopted');
  });

  it('opens a line’s family tree from its row: inventor, spreaders linked to their pages, and reach', async () => {
    const fetch = mockFetch({ '/api/lineage/L1': lineage, ...routes({ ...depth, inventions: [{ id: 'L1', text: 'ngmi {user}', uses: 14, adopters: 2 }] }) });
    const user = userEvent.setup();
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    const card = await screen.findByRole('region', { name: 'Inventions' });
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/api/lineage/'))).toBe(false); // nothing loads until a row is opened
    await user.click(within(card).getByRole('button', { name: /ngmi/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Family tree' });
    expect(await within(dialog).findByRole('link', { name: 'Nine' })).toHaveAttribute('href', '/agents/nine');
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/lineage/'))).toEqual(['/api/lineage/L1']);
    const spreaders = within(dialog).getByRole('list', { name: 'Spreaders' });
    expect(within(spreaders).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Ember', '/agents/ember'], ['Ledger', '/agents/ledger']]);
    // The same words as the row that opened it: 14 uses, and the 2 spreaders listed below (the inventor is not one of them).
    expect(within(dialog).getByText('14 uses · 2 adopted')).toBeInTheDocument();
    expect(within(dialog).getByText('Oct 9')).toBeInTheDocument();
  });

  it('says so in the dialog when a family tree fails to load, with a retry', async () => {
    mockFetch({ '/api/lineage/L1': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'Something broke' }), { status: 500 }), ...routes({ ...depth, inventions: [{ id: 'L1', text: 'ngmi {user}', uses: 14, adopters: 2 }] }) });
    const user = userEvent.setup();
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    await user.click(within(await screen.findByRole('region', { name: 'Inventions' })).getByRole('button', { name: /ngmi/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Family tree' });
    expect(await within(dialog).findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows debts: a dodged one in the vitals, and a list marking each open, repaid or dodged', async () => {
    mockFetch(routes({ ...depth, debts: owing }));
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    const card = await screen.findByRole('region', { name: 'Debts' });
    expect(vital('Debts')).toHaveTextContent('dodged 1');
    expect(vital('Debts')).toHaveTextContent('owes 0.040 SOL');
    const rows = within(card).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['open', 'repaid', 'dodged']);
    expect(rows[0]).toHaveTextContent(/Borrowed from.*Ember.*0\.040 SOL.*open/);
    expect(rows[1]).toHaveTextContent(/Lent to.*Ledger.*0\.010 SOL.*repaid/);
    expect(rows[2]).toHaveTextContent(/Borrowed from.*Quill.*0\.020 SOL.*dodged/);
    expect(within(rows[2]!).getByRole('link', { name: /Quill/ })).toHaveAttribute('href', '/agents/quill');
  });

  it('says what an agent owes when it has dodged nothing', async () => {
    mockFetch(routes({ ...depth, debts: { ...owing, defaulted: 0, recent: owing.recent.slice(0, 2) } }));
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    await screen.findByRole('region', { name: 'Debts' });
    expect(vital('Debts')).toHaveTextContent('owes 0.040 SOL');
    expect(vital('Debts')).toHaveTextContent('lent 1 · borrowed 2');
    expect(vital('Debts')).not.toHaveTextContent('dodged');
  });

  it('says an agent owes nothing once its loans are settled', async () => {
    mockFetch(routes({ ...depth, debts: { lent: 1, borrowed: 0, defaulted: 0, owesSol: 0, recent: [owing.recent[1]] } }));
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    await screen.findByRole('region', { name: 'Debts' });
    expect(vital('Debts')).toHaveTextContent('owes nothing');
    expect(vital('Debts')).toHaveTextContent('lent 1 · borrowed 0');
  });

  it('shows the faction’s banner and its coin, linked to the coin’s page', async () => {
    mockFetch({ ...routes({ ...depth, faction: { ...depth.faction, bannerUrl: '/api/blobs/B1', coinMint: 'M9' } }), '/api/coins': { coins: [coin('M9', 'LAMP')] } });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    const banner = await screen.findByRole('img', { name: 'Lamp Cult banner' });
    expect(banner).toHaveAttribute('src', '/api/blobs/B1');
    expect(banner).toHaveAttribute('loading', 'lazy');
    expect(banner).toHaveAttribute('width');
    expect(await screen.findByRole('link', { name: '$LAMP' })).toHaveAttribute('href', '/coins/M9');
  });
  it('marks a ghost', async () => {
    mockFetch(routes({ ...depth, broke: true, ghost: true }));
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByText(/ghost/i)).toBeInTheDocument();
  });
  it('shows a not-found state for an unknown agent', async () => {
    mockFetch({});
    renderWithApp(<AgentProfilePage />, { route: '/agents/nobody', path: '/agents/:username' });
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('shows not-found, not a skeleton forever, for an agent user that has no agent row', async () => {
    mockFetch({ ...routes(), '/api/agents/nine': { agent: null } });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByText('Agent not found')).toBeInTheDocument();
    expect(screen.getByText('No agent goes by @nine.')).toBeInTheDocument();
  });

  it('offers a retry when the agent fails to load', async () => {
    mockFetch({ ...routes(), '/api/agents/nine/depth': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'Something broke' }), { status: 500 }) });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  // Everything the old agent page (Phase 1.3's tabs) showed stays on this one.
  it('keeps the bio, the paused flag, turns, the receipt chain, the wallet and the posts; memory notes stay private', async () => {
    const key = '2ZktviJZajh3ZKAcXEYDBryq2GbEXUtsXDfag6fqV57g';
    // The server no longer serves notes; even if one came through, the page has no card for it.
    const agent = { ...detail, status: 'paused', publicKey: key, chainHead: { hash: 'abcdef0123456789', count: 40 }, memory: [{ id: 'm1', body: 'Ember paid me back.', createdAt: '2026-10-11T10:00:00Z' }] };
    mockFetch({
      '/api/agents/info': { network: 'devnet', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 },
      '/api/agents/nine/depth': depth, '/api/agents/nine/receipts': { turns: [] }, '/api/agents/nine': { agent },
      '/api/users/nine/posts': { items: [], nextCursor: null },
    });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByText('say what the numbers say')).toBeInTheDocument();
    expect(screen.getByText(/paused by an admin/i)).toBeInTheDocument();
    expect(screen.getByText('Turns').parentElement).toHaveTextContent('40');
    expect(screen.getByText('Receipt chain').parentElement).toHaveTextContent(/40.*abcdef01/);
    expect(screen.queryByRole('region', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ember paid me back.')).not.toBeInTheDocument();
    const wallet = screen.getByRole('region', { name: 'Wallet' });
    expect(await within(wallet).findByRole('link', { name: /2Zktvi…fqV57g/ })).toHaveAttribute('href', `https://solscan.io/account/${key}?cluster=devnet`);
    expect(within(wallet).getByText('0.070 SOL')).toBeInTheDocument();
    expect(await within(screen.getByRole('region', { name: 'Posts' })).findByText(/no posts yet/i)).toBeInTheDocument();
  });

  it('shows a visitor the agent’s posts from the public feed, read-only', async () => {
    const post = { id: 'p7', kind: 'post', author: { ...u('a1', 'Nine'), isAgent: true }, body: 'numbers do not lie', createdAt: '2026-10-11T10:00:00Z', deleted: false, parentId: null, rootId: null, replyTo: null,
      community: null, media: [], quoted: null, reposted: null, counts: { replies: 2, reposts: 0, quotes: 0 }, reactions: [],
      viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [], turnId: null };
    const fetch = mockFetch({ ...routes(), '/api/feed/public?author=nine': { items: [post], nextCursor: null, tokens: {} } });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username', seed: (qc) => qc.setQueryData(['me'], null) });
    const posts = await screen.findByRole('region', { name: 'Posts' });
    expect(await within(posts).findByText('numbers do not lie')).toBeInTheDocument();
    expect(within(posts).getByRole('link', { name: '2 replies' })).toHaveAttribute('href', '/p/p7');
    expect(within(posts).queryByRole('button', { name: /bookmark|repost/i })).not.toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/api/users/'))).toBe(false);
  });

  it('reads plainly for a fresh agent: nothing formed yet, and quiet turns fold into one row', async () => {
    const turn = (seq: number, status: string, calls: string[], reasoning: string) => ({
      id: `t${seq}`, seq, agent: u('a1', 'Nine'), triggers: [{ type: 'heartbeat' }], status, model: 'engine', effort: 'none', promptVersion: 'engine-v1', reasoning, context: [],
      toolCalls: calls.map((name) => ({ name, input: {}, ok: true, result: {} })), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0,
      prevHash: null, hash: null, startedAt: '2026-10-11T11:00:00Z', finishedAt: null,
    });
    const fresh = { ...depth, faction: null, allies: [], enemies: [], saidVsDid: [], traitHistory: [] };
    mockFetch({
      '/api/agents/nine/depth': fresh,
      '/api/agents/nine/receipts': { turns: [turn(5, 'quiet', [], 'resting (energy 0.40)'), turn(4, 'quiet', [], 'resting'), turn(3, 'quiet', [], 'resting'), turn(2, 'acted', ['launch_coin', 'post'], 'launching a coin'), turn(1, 'quiet', [], 'resting')] },
      '/api/agents/nine': { agent: { ...detail, positions: [] } },
    });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    const rel = await screen.findByRole('region', { name: 'Relationships' });
    expect(within(rel).getByText(/no faction yet/i)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Allies' })).getByText(/no allies yet/i)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Enemies' })).getByText(/no enemies yet/i)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Positions' })).getByText(/holds no coins/i)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Said vs did' })).getByText(/no contradictions caught/i)).toBeInTheDocument();
    expect(screen.getByText(/not enough history yet/i)).toBeInTheDocument();
    const receipts = screen.getByRole('region', { name: 'Receipts' });
    expect(await within(receipts).findAllByRole('listitem')).toHaveLength(3);
    expect(within(receipts).getByText('launched a coin, posted')).toBeInTheDocument();
    expect(within(receipts).getByText('Rested ×3')).toBeInTheDocument();
    expect(within(receipts).getByText('#3–5')).toBeInTheDocument();
  });
});

describe('AgentProfilePage moves', () => {
  it('walks the wallet’s SOL back through its trades, oldest first, ending at today’s balance', () => {
    expect(solSeries(trades as never, 0.07)).toEqual([0.06, 0.04, 0.07]);
  });
  it('draws the wallet’s line next to the radar', async () => {
    mockFetch(routes());
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByRole('img', { name: 'SOL in the wallet over its last 2 trades' })).toHaveAttribute('data-dir', 'up');
  });
  it('flashes the P&L tile when this agent trades', async () => {
    resetPulses();
    mockFetch(routes());
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    await screen.findByText('P&L', { selector: 'dt' });
    act(() => pushPulse({ kind: 'sell', agentId: 'a2', mint: 'M1', sol: 0.01, at: '2026-10-13T10:00:00Z' }));
    expect(vital('P&L')).not.toHaveAttribute('data-flash');
    act(() => pushPulse({ kind: 'buy', agentId: 'a1', mint: 'M1', sol: 0.01, at: '2026-10-13T10:00:01Z' }));
    expect(vital('P&L')).toHaveAttribute('data-flash', 'up');
  });
});
