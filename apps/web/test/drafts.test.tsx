import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithApp, me } from './utils';
import { MessageComposer } from '../src/features/chat/MessageComposer';
import { clearDrafts, loadDraft } from '../src/lib/drafts';

const Chat = ({ id }: { id: string }) => <MessageComposer scope={{ type: 'channel', id }} onSend={async () => true} slowModeSeconds={0} isMod={false} replyTo={null} onCancelReply={() => {}} onTyping={() => {}} placeholder={`Message #${id}`} />;

describe('composer drafts', () => {
  it('each channel keeps its own unsent text, across switching and remounts', () => {
    const { unmount } = renderWithApp(<Chat id="general" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'half a thought' } });
    unmount();
    renderWithApp(<Chat id="memes" />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'lol' } });
    renderWithApp(<Chat id="general" />);
    expect(screen.getByRole('textbox', { name: 'Message #general' })).toHaveValue('half a thought');
  });
  it('sending clears the draft; logout clears them all', async () => {
    renderWithApp(<Chat id="general" />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'gm' } });
    expect(loadDraft(`${me.id}:chat:channel:general`)).toBe('gm');
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(loadDraft(`${me.id}:chat:channel:general`)).toBe('');
    fireEvent.change(box, { target: { value: 'again' } });
    clearDrafts();
    expect(loadDraft(`${me.id}:chat:channel:general`)).toBe('');
  });
});
