import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithApp } from './utils';
import { MessageComposer } from '../src/features/chat/MessageComposer';

const scope = { type: 'channel' as const, id: 'c1' };
describe('MessageComposer', () => {
  it('Enter sends, Shift+Enter inserts a newline', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    renderWithApp(<MessageComposer scope={scope} onSend={onSend} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder="Message #general" />);
    const box = screen.getByRole('textbox', { name: 'Message #general' });
    fireEvent.change(box, { target: { value: 'gm' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(onSend).toHaveBeenCalledWith('gm', expect.anything());
    expect(box).toHaveValue('');
  });
  it('slow mode counts down after sending and blocks non-mods', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn().mockResolvedValue(true);
    renderWithApp(<MessageComposer scope={scope} onSend={onSend} slowModeSeconds={15} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder="Message #general" />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'one' } });
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(screen.getByText(/Slow mode · 15s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(screen.queryByText(/Slow mode · \d+s/)).toBeNull();
    vi.useRealTimers();
  });
  it('shows the disabled reason instead of an input', () => {
    renderWithApp(<MessageComposer scope={scope} onSend={vi.fn()} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} disabledReason={<span>Join to chat</span>} placeholder="x" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Join to chat')).toBeInTheDocument();
  });
});
