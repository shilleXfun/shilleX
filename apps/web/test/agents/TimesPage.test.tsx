import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithApp, mockFetch as mockFetchRaw } from '../utils';
import { TimesPage } from '../../src/features/agents/TimesPage';

// PaperView (Phase 4.11): stories are { title, body } only.
const paper = { day: '2026-10-11', headline: 'Ledger rugs his own cabal', stories: [{ title: 'Lamp Cult splits', body: 'Three members walked.' }, { title: 'Comeback of the day', body: 'Quill is back from the dead.' }], memeUrl: '/api/blobs/m1', source: 'model' };
// The page asks /agents/info first: a 404 there means no agent world (see NoAgentWorld.test.tsx), so every test here has one.
const info = { network: 'memory', agents: 50, runtime: 'on', budgetLevel: 'normal', spentTodayUsd: 0 };
const mockFetch = (routes: Record<string, unknown>) => mockFetchRaw({ '/api/agents/info': info, ...routes });
afterEach(() => vi.restoreAllMocks());

describe('TimesPage', () => {
  it('renders the latest edition with headline, stories and the front-page meme', async () => {
    mockFetch({ '/api/papers/latest': paper });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Ledger rugs his own cabal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Lamp Cult splits' })).toBeInTheDocument();
    expect(screen.getByText('Three members walked.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /front page/i })).toHaveAttribute('src', '/api/blobs/m1');
    expect(screen.getByRole('link', { name: /previous edition/i })).toHaveAttribute('href', '/times/2026-10-10');
    // The latest edition has nothing after it.
    expect(screen.queryByRole('link', { name: /next edition/i })).not.toBeInTheDocument();
  });
  it('loads a past edition by day', async () => {
    const f = mockFetch({ '/api/papers/2026-10-09': { ...paper, day: '2026-10-09', headline: 'Quiet day' } });
    renderWithApp(<TimesPage />, { route: '/times/2026-10-09', path: '/times/:day' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Quiet day' })).toBeInTheDocument();
    expect(f.mock.calls.some(([u]) => String(u).includes('/api/papers/2026-10-09'))).toBe(true);
    expect(screen.getByRole('link', { name: /next edition/i })).toHaveAttribute('href', '/times/2026-10-10');
  });
  it('has no next edition after a day that is not over yet', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    mockFetch({ [`/api/papers/${yesterday}`]: { ...paper, day: yesterday } });
    renderWithApp(<TimesPage />, { route: `/times/${yesterday}`, path: '/times/:day' });
    expect(await screen.findByRole('heading', { level: 2, name: paper.headline })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /next edition/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain(`/times/${today}`);
  });
  it('explains when there is no edition yet', async () => {
    mockFetch({});
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByText(/first edition comes out at midnight utc/i)).toBeInTheDocument();
  });
  it('says when a day has no edition and links back to the latest', async () => {
    mockFetch({});
    const { container } = renderWithApp(<TimesPage />, { route: '/times/2026-09-01', path: '/times/:day' });
    expect(await screen.findByText('No edition for that day.')).toBeInTheDocument();
    // The dateline names the day asked for (in the viewer's locale).
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-09-01');
    expect(screen.getByRole('link', { name: /latest edition/i })).toHaveAttribute('href', '/times');
  });
  describe('the archive', () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    it('keeps the pager on a day with no edition, so a gap does not strand the older editions behind it', async () => {
      mockFetch({});
      renderWithApp(<TimesPage />, { route: `/times/${daysAgo(5)}`, path: '/times/:day' });
      expect(await screen.findByText('No edition for that day.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /previous edition/i })).toHaveAttribute('href', `/times/${daysAgo(6)}`);
      expect(screen.getByRole('link', { name: /next edition/i })).toHaveAttribute('href', `/times/${daysAgo(4)}`);
      expect(screen.getByRole('link', { name: /latest edition/i })).toHaveAttribute('href', '/times');
    });
    it('does not walk back forever from a day long ago, or on from one still to come', async () => {
      mockFetch({});
      const { unmount } = renderWithApp(<TimesPage />, { route: `/times/${daysAgo(400)}`, path: '/times/:day' });
      expect(await screen.findByText('No edition for that day.')).toBeInTheDocument();
      expect(hrefs()).not.toContain(`/times/${daysAgo(401)}`);
      expect(screen.getByRole('link', { name: /next edition/i })).toHaveAttribute('href', `/times/${daysAgo(399)}`);
      unmount();
      renderWithApp(<TimesPage />, { route: `/times/${daysAgo(-20)}`, path: '/times/:day' });
      expect(await screen.findByText('No edition for that day.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /(previous|next) edition/i })).not.toBeInTheDocument();
    });
    it('offers no pager on a day that is not a date', async () => {
      mockFetch({});
      renderWithApp(<TimesPage />, { route: '/times/soon', path: '/times/:day' });
      expect(await screen.findByText('No edition for that day.')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Editions' })).not.toBeInTheDocument();
    });
    it('links yesterday’s edition on to today’s once today’s has been published early', async () => {
      mockFetch({ '/api/papers/latest': { ...paper, day: daysAgo(0) }, [`/api/papers/${daysAgo(1)}`]: { ...paper, day: daysAgo(1) } });
      renderWithApp(<TimesPage />, { route: `/times/${daysAgo(1)}`, path: '/times/:day' });
      expect(await screen.findByRole('heading', { level: 2, name: paper.headline })).toBeInTheDocument();
      expect(await screen.findByRole('link', { name: /next edition/i })).toHaveAttribute('href', `/times/${daysAgo(0)}`);
    });
  });
  it('does not repeat the headline as a story in a locally written paper', async () => {
    // The local paper leads with its first story, capitalised, and its stories have no body.
    mockFetch({ '/api/papers/latest': { day: '2026-10-11', headline: '@NINE RUGGED $MOTH', stories: [{ title: '@nine rugged $MOTH', body: '' }, { title: 'Lamp Cult formed', body: '' }], memeUrl: null, source: 'local' } });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByRole('heading', { level: 2, name: '@NINE RUGGED $MOTH' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Lamp Cult formed']);
  });
  it('drops the meme when the edition has none', async () => {
    mockFetch({ '/api/papers/latest': { ...paper, memeUrl: null } });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    expect(await screen.findByRole('heading', { level: 2, name: paper.headline })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Stop press', () => {
  const who = (id: string) => ({ id, username: id, displayName: '', avatarUrl: '/x.svg', isDemo: false, isAgent: true, createdAt: '2026-10-01T00:00:00Z' });
  const overview = {
    movers: { up: [{ user: who('moth_lamp'), pnlSol: 0.041 }], down: [] },
    feuds: [{ a: who('drift_cult'), b: who('fernfund'), affinity: -0.82 }],
    launches: [{ mint: 'M1', symbol: 'LAMP', name: 'Lamp', creator: who('lantern'), launchedAt: '2026-10-13T09:00:00Z', holders: 1 }, { mint: 'M0', symbol: 'OLD', name: 'Old', creator: who('lantern'), launchedAt: '2026-10-12T09:00:00Z', holders: 1 }],
    rugs: [{ coin: { mint: 'M2', symbol: 'RUG' }, creator: who('soft_rug'), soldPct: 92, at: '2026-10-13T10:00:00Z' }], moods: [],
  };
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());
  it('lists today so far under the latest page: newest timed items first, then the worst feud and the top mover', async () => {
    mockFetch({ '/api/agents/overview': overview });
    renderWithApp(<TimesPage />, { route: '/times', path: '/times' });
    const press = (await screen.findByRole('heading', { level: 2, name: /Stop press/ })).closest('section')!;
    const items = within(press).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/soft_rug rugged \$RUG, selling 92%/);
    expect(items[1]).toMatch(/lantern launched \$LAMP/);
    expect(items.join(' ')).not.toMatch(/\$OLD/);
    expect(items[2]).toMatch(/Worst feud: drift_cult vs fernfund/);
    expect(items[3]).toMatch(/moth_lamp is up the most/);
  });
  it('stays off a past edition', async () => {
    mockFetch({ '/api/papers/2026-10-09': { ...paper, day: '2026-10-09' }, '/api/agents/overview': overview });
    renderWithApp(<TimesPage />, { route: '/times/2026-10-09', path: '/times/:day' });
    await screen.findByRole('heading', { level: 2, name: paper.headline });
    expect(screen.queryByRole('heading', { name: /Stop press/ })).not.toBeInTheDocument();
  });
});
