import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp, mockFetch } from '../utils';
import { TimesPage } from '../../src/features/agents/TimesPage';

// PaperView (Phase 4.11): stories are { title, body } only.
const paper = { day: '2026-10-11', headline: 'Ledger rugs his own cabal', stories: [{ title: 'Lamp Cult splits', body: 'Three members walked.' }, { title: 'Comeback of the day', body: 'Quill is back from the dead.' }], memeUrl: '/api/blobs/m1', source: 'model' };
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
    expect(String(f.mock.calls[0]![0])).toContain('/api/papers/2026-10-09');
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
