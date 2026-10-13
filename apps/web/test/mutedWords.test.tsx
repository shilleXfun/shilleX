import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { PostView } from '@shillex/shared';
import { renderWithApp, mockFetch, me } from './utils';
import { PostCard } from '../src/features/feed/PostCard';
import { SettingsPage } from '../src/features/profile/SettingsPage';

const jane = { id: 'a', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true };
const post = (author: typeof jane, body: string): PostView => ({
  id: 'p1', kind: 'post', author, body, createdAt: new Date().toISOString(), deleted: false, parentId: null, rootId: null, replyTo: null,
  community: null, media: [], quoted: null, reposted: null, counts: { replies: 0, reposts: 0, quotes: 0 }, reactions: [],
  viewer: { bookmarked: false, reposted: false, subscribed: false, canAddCallUpdate: false }, mints: [], callUpdates: [],
});
const muting = (words: string[]) => (qc: import('@tanstack/react-query').QueryClient) => qc.setQueryData(['me'], { ...me, mutedWords: words });

describe('muted words', () => {
  it('collapse a matching post to one line that can be opened', () => {
    renderWithApp(<PostCard post={post(jane, 'aping $SCAM right now')} />, { seed: muting(['scam']) });
    expect(screen.queryByText(/aping/)).toBeNull();
    expect(screen.getByRole('article', { name: 'Hidden post' })).toHaveTextContent('Hidden: mentions “scam”, which you muted.');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText(/aping/)).toBeInTheDocument();
  });
  it('match a token tagged only by its address, through its $SYMBOL', () => {
    const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    renderWithApp(<PostCard post={{ ...post(jane, `not touching ${MINT} yet`), mints: [MINT] }} />, {
      seed: (qc) => { muting(['$moss'])(qc); qc.setQueryData(['token', MINT], { mint: MINT, symbol: 'MOSS', status: 'resolved' }); },
    });
    expect(screen.getByRole('article', { name: 'Hidden post' })).toHaveTextContent('“$moss”');
  });
  it('never hide your own posts, or posts that do not match as a whole word', () => {
    renderWithApp(<PostCard post={post({ ...jane, id: me.id }, 'my $SCAM call')} />, { seed: muting(['scam']) });
    expect(screen.getByText(/my/)).toBeInTheDocument();
    renderWithApp(<PostCard post={post(jane, 'went to the drug store')} />, { seed: muting(['rug']) });
    expect(screen.getByText(/drug store/)).toBeInTheDocument();
  });
  it('are added and removed in Settings', async () => {
    const settings = (mutedWords: string[]) => ({ profile: { displayName: 'You', bio: '', links: [], avatarUrl: '/a.svg', bannerUrl: null }, signIn: { hasPassword: true, email: null, wallets: [], payoutEnabled: false }, notificationPrefs: [], mutedWords });
    const f = mockFetch({
      '/api/me/muted-words': (init?: RequestInit) => settings(JSON.parse(String(init?.body)).words),
      '/api/me/settings': settings(['rug']), '/api/me/muted': { users: [] }, '/api/me/blocked': { users: [] },
    });
    renderWithApp(<SettingsPage />);
    const input = await screen.findByRole('textbox', { name: 'Word, $ticker or address to mute' });
    fireEvent.change(input, { target: { value: '$SCAM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Muted words' })).toHaveTextContent('$SCAM'));
    const put = f.mock.calls.filter(([u]) => String(u).endsWith('/api/me/muted-words'));
    expect(JSON.parse(String((put[0]![1] as RequestInit).body))).toEqual({ words: ['rug', '$SCAM'] });
    fireEvent.click(screen.getByRole('button', { name: 'Unmute rug' }));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Muted words' })).not.toHaveTextContent('rug'));
  });
});
