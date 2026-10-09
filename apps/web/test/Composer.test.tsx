import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithApp, mockFetch } from './utils';
import { Composer } from '../src/features/feed/Composer';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
describe('Composer', () => {
  it('disables posting when empty or over 1000 code points; counts emoji as one', async () => {
    renderWithApp(<Composer mode="post" />);
    const box = screen.getByRole('textbox', { name: /what’s happening|post/i });
    const submit = screen.getByRole('button', { name: 'Post' });
    expect(submit).toBeDisabled();
    fireEvent.change(box, { target: { value: '🔥'.repeat(1000) } });
    expect(submit).toBeEnabled();
    fireEvent.change(box, { target: { value: '🔥'.repeat(1001) } });
    expect(submit).toBeDisabled();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });
  it('previews detected contract addresses as chips while typing', async () => {
    mockFetch({ '/api/tokens/resolve': { tokens: {} } });
    renderWithApp(<Composer mode="post" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `watching ${MINT}` } });
    expect(await screen.findByRole('button', { name: new RegExp(MINT) })).toBeInTheDocument();
  });
  it('submits with Ctrl+Enter, clears, and surfaces server errors', async () => {
    let n = 0;
    mockFetch({ '/api/posts': () => (++n === 1 ? new Response(JSON.stringify({ code: 'EMPTY_BODY', message: 'Write something first' }), { status: 400 }) : { post: { id: 'p1' }, tokens: {} }) });
    renderWithApp(<Composer mode="post" />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'gm');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Write something first');
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(box).toHaveValue(''));
  });
});
