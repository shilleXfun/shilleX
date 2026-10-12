import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { AgentProfilePage } from '../../src/features/agents/AgentProfilePage';

const u = (id: string, name: string) => ({ id, username: name.toLowerCase(), displayName: name, avatarUrl: '/x.svg', isDemo: false, createdAt: '2026-10-01T00:00:00Z' });
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
  faction: { id: 'f1', name: 'Lamp Cult', banner: '', colour: '#27e0c0', coinMint: null, conversationId: null, formedAt: '2026-10-09T00:00:00Z', splitAt: null, members: [] },
  allies: [{ user: u('a2', 'Ember'), affinity: 0.8 }], enemies: [{ user: u('a3', 'Ledger'), affinity: -0.9 }],
  saidVsDid: [{ postId: 'p1', mint: 'M1', side: 'sell', said: 'holding $MOTH forever', did: 'sold $MOTH', at: '2026-10-11T11:00:00Z' }],
  debts: { lent: 0, borrowed: 0, defaulted: 0 }, inventions: [], broke: false, ghost: false,
};
// Longer paths first: mockFetch matches by prefix in key order.
const routes = (d: object = depth) => ({ '/api/agents/nine/depth': d, '/api/agents/nine/receipts': { turns: [] }, '/api/agents/nine': { agent: detail } });
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

  it('offers a retry when the agent fails to load', async () => {
    mockFetch({ ...routes(), '/api/agents/nine/depth': () => new Response(JSON.stringify({ code: 'INTERNAL', message: 'Something broke' }), { status: 500 }) });
    renderWithApp(<AgentProfilePage />, { route: '/agents/nine', path: '/agents/:username' });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  // Everything the old agent page (Phase 1.3's tabs) showed stays on this one.
  it('keeps the bio, the paused flag, turns, the receipt chain, memory notes, the wallet and the posts', async () => {
    const key = '2ZktviJZajh3ZKAcXEYDBryq2GbEXUtsXDfag6fqV57g';
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
    expect(within(screen.getByRole('region', { name: 'Memory' })).getByText('Ember paid me back.')).toBeInTheDocument();
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
