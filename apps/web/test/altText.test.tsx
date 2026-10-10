import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { Composer } from '../src/features/feed/Composer';

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' });

describe('image descriptions', () => {
  it('an attached image gets an ALT description that is sent with the post', async () => {
    const f = mockFetch({
      '/api/uploads': { upload: { id: 'up1', url: '/uploads/up1.png', width: 10, height: 10, mime: 'image/png' } },
      '/api/posts': (init?: RequestInit) => ({ post: { id: 'p1', sent: JSON.parse(String(init?.body)) }, tokens: {} }),
    });
    renderWithApp(<Composer mode="post" />);
    const box = screen.getByRole('textbox', { name: /What’s happening|Post/i });
    await act(async () => { fireEvent.paste(box, { clipboardData: { files: [png()], types: ['Files'], getData: () => '' } }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Add image description' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  1h chart, steady climb  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Edit image description: 1h chart, steady climb' })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'look at this' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Post' })); });
    const call = f.mock.calls.find(([u, i]) => String(u).endsWith('/api/posts') && (i as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({ uploadIds: ['up1'], alts: ['1h chart, steady climb'] });
  });
});
