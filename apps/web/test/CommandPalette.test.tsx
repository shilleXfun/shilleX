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
