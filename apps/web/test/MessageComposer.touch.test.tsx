import { describe, it, expect, vi, beforeAll } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithApp } from './utils';
import { MessageComposer } from '../src/features/chat/MessageComposer';

// Its own file: useMediaQuery caches query lists per module, so this touch stub must not leak into other tests.
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', media: query, addEventListener() {}, removeEventListener() {} }));
});

describe('MessageComposer on a touch keyboard', () => {
  it('Enter is a newline, the send button sends, and the desktop hint is gone', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    renderWithApp(<MessageComposer scope={{ type: 'channel', id: 'c1' }} onSend={onSend} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder="Message #general" />);
    const box = screen.getByRole('textbox', { name: 'Message #general' });
    expect(box).toHaveAttribute('enterkeyhint', 'enter');
    expect(screen.queryByText(/Enter to send/)).toBeNull();
    fireEvent.change(box, { target: { value: 'gm' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    expect(onSend).toHaveBeenCalledWith('gm', expect.anything());
  });
});
