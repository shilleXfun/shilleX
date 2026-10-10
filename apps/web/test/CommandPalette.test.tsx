import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router';
import { renderWithApp, mockFetch } from './utils';
import { CommandPalette, openPalette } from '../src/layout/CommandPalette';

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; };
const app = () => renderWithApp(<><CommandPalette /><Routes><Route path="*" element={<Where />} /></Routes></>);
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('CommandPalette', () => {
  it('opens with Ctrl+K, finds people and communities, and Enter goes to the active one', async () => {
    mockFetch({
      '/api/users': { users: [{ id: 'x', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true }] },
      '/api/communities': { communities: [{ id: 'c', slug: 'trenches', name: 'The Trenches', description: '', avatarUrl: '/c.svg', visibility: 'public', memberCount: 25, onlineCount: 3, myRole: null, myStatus: null, unread: 0, isDemo: true }] },
    });
    app();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const box = await screen.findByRole('combobox', { name: /Search people, communities/ });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'ja' } });
    await wait(200);
    expect(await screen.findByRole('option', { name: /Jane/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const trenches = screen.getByRole('option', { name: /The Trenches/ });
    expect(trenches).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', trenches.id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent('/c/trenches');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('a pasted contract address offers to open its token panel', async () => {
    mockFetch({ '/api/tokens/resolve': { tokens: {} }, [`/api/tokens/${MINT}`]: { token: null } });
    app();
    act(() => openPalette());
    const box = await screen.findByRole('combobox');
    fireEvent.change(box, { target: { value: MINT } });
    await wait(200);
    expect(screen.getByRole('group', { name: 'Token' })).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent(`?token=${MINT}`);
  });
  it('finds tokens by $ticker, and warns when two share one', async () => {
    const tok = (mint: string, name: string) => ({ mint, status: 'resolved', source: 'demo', name, symbol: 'GRUB', imageUrl: null, decimals: null, liquidityUsd: null, marketCapUsd: null, fdvUsd: null, pairAddress: null, dexId: null, pairCreatedAt: null, promoted: false, fetchedAt: null, error: null });
    mockFetch({
      '/api/tokens/search': { results: [{ token: tok(MINT, 'Grubworm'), mentions24h: 9 }, { token: tok('So11111111111111111111111111111111111111112', 'Grub Copy'), mentions24h: 1 }] },
      '/api/users': { users: [] }, '/api/communities': { communities: [] },
    });
    app();
    act(() => openPalette());
    const box = await screen.findByRole('combobox');
    fireEvent.change(box, { target: { value: '$grub' } });
    await wait(200);
    const options = await screen.findAllByRole('option', { name: /GRUB/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Grubworm');
    expect(options[0]).toHaveTextContent('DezX…B263');
    expect(options[0]).toHaveTextContent('2 tokens use $GRUB, check the address');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent(`?token=${MINT}`);
  });
  it('Enter right after pasting or typing acts on what was typed, not on the results from before', async () => {
    mockFetch({
      '/api/tokens/resolve': { tokens: {} }, [`/api/tokens/${MINT}`]: { token: null },
      '/api/users': { users: [{ id: 'x', username: 'alpha_jane', displayName: 'Jane', avatarUrl: '/a.svg', isDemo: true }] },
      '/api/communities': { communities: [] }, '/api/tokens/search': { results: [] },
    });
    app();
    act(() => openPalette());
    let box = await screen.findByRole('combobox');
    fireEvent.change(box, { target: { value: MINT } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByTestId('where')).toHaveTextContent(`?token=${MINT}`);
    act(() => openPalette());
    box = await screen.findByRole('combobox');
    fireEvent.change(box, { target: { value: 'jane' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await wait(300);
    expect(screen.getByTestId('where')).toHaveTextContent('/u/alpha_jane');
  });
  it('filters pages by name with no query needed', async () => {
    app();
    act(() => openPalette());
    const box = await screen.findByRole('combobox');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toContain('Notifications');
    fireEvent.change(box, { target: { value: 'set' } });
    await wait(200);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Settings']);
  });
});
