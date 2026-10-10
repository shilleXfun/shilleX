import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithApp, mockFetch } from './utils';
import { MessageComposer } from '../src/features/chat/MessageComposer';
import { Composer } from '../src/features/feed/Composer';

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' });
const clipboard = (files: File[], text = '') => ({ files, types: files.length ? ['Files'] : [], getData: (t: string) => (t === 'text/plain' ? text : '') });
const uploads = () => mockFetch({ '/api/uploads': { upload: { id: 'up1', url: '/uploads/up1.png', width: 10, height: 10 } } });
const chat = () => renderWithApp(<MessageComposer scope={{ type: 'channel', id: 'c1' }} onSend={async () => true} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder="Message #general" />);

describe('pasting and dropping images', () => {
  it('a pasted screenshot uploads and shows as an attachment', async () => {
    const f = uploads();
    chat();
    await act(async () => { fireEvent.paste(screen.getByRole('textbox'), { clipboardData: clipboard([png()]) }); });
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/api/uploads'))).toBe(true);
    expect(await screen.findByRole('button', { name: 'Remove image' })).toBeInTheDocument();
  });
  it('leaves a paste alone when it also carries text (spreadsheets copy both)', async () => {
    const f = uploads();
    chat();
    await act(async () => { fireEvent.paste(screen.getByRole('textbox'), { clipboardData: clipboard([png()], 'A1\tB1') }); });
    expect(f).not.toHaveBeenCalled();
  });
  it('shows a drop target while dragging files and uploads what is dropped', async () => {
    const f = uploads();
    const { container } = renderWithApp(<Composer mode="post" />);
    const root = container.querySelector('[data-shortcut="compose"]')!.closest('div[class*="composer"]')!;
    fireEvent.dragEnter(root, { dataTransfer: { types: ['Files'], files: [] } });
    expect(root).toHaveAttribute('data-drop');
    await act(async () => { fireEvent.drop(root, { dataTransfer: { types: ['Files'], files: [png()] } }); });
    expect(root).not.toHaveAttribute('data-drop');
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/api/uploads'))).toBe(true);
  });
});
