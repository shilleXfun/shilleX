import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { Hash, Timer } from 'lucide-react';
import type { ChannelView as Channel, CommunityDetail, MessageView } from '@shillex/shared';
import { dur, ease } from '../../lib/motion';
import { Button } from '../../components/ui/Button';
import { useChatScope } from '../chat/useChatScope';
import { MessageList } from '../chat/MessageList';
import { MessageComposer } from '../chat/MessageComposer';
import { TypingIndicator } from '../chat/TypingIndicator';
import s from './communities.module.css';
import cs from '../chat/chat.module.css';

const slowLabel = (n: number) => (n < 60 ? `${n}s` : `${n / 60}m`);

/** One channel's chat. Keyed by channel id, so switching channels fades in a fresh view. */
export function ChannelView({ detail, channel, onJoin }: { detail: CommunityDetail; channel: Channel; onJoin: () => void }) {
  const [params] = useSearchParams();
  const scope = { type: 'channel' as const, id: channel.id };
  const chat = useChatScope(scope);
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [unreadAtOpen] = useState(channel.unread);
  const c = detail.community;
  const disabled = c.myStatus === 'banned' ? <span>You’re banned from this community.</span>
    : c.myStatus !== 'active' ? <><span>{c.myStatus === 'pending' ? 'Your join request is pending.' : 'Join the community to chat.'}</span>{c.myStatus !== 'pending' && <Button size="sm" variant="primary" onClick={onJoin}>Join</Button>}</>
    : undefined;
  return (
    <motion.div className={`${cs.wrap} ${s.channelSwap}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: dur.standard, ease: ease.out }}>
      <div className={s.chanHead}>
        <Hash size={17} aria-hidden="true" /><h2 className={s.chanTitle}>{channel.name}</h2>
        {channel.topic && <span className={s.topic}>{channel.topic}</span>}
        {channel.slowModeSeconds > 0 && <span className={s.slowTag} title="Slow mode: one message per person in this interval"><Timer size={12} aria-hidden="true" />{slowLabel(channel.slowModeSeconds)}</span>}
      </div>
      <MessageList scope={scope} chat={chat} unreadAtOpen={unreadAtOpen} focusId={params.get('m')} canModerate={detail.isMod} onReply={setReplyTo}
        pinCommunitySlug={c.slug} emptyTitle={`Welcome to #${channel.name}`} label={`Messages in #${channel.name}`} />
      <TypingIndicator users={chat.typingUsers} />
      <MessageComposer scope={scope} onSend={(b, o) => chat.send(b, o)} disabledReason={disabled} slowModeSeconds={channel.slowModeSeconds} isMod={detail.isMod}
        replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onTyping={chat.emitTyping} placeholder={`Message #${channel.name}`} />
    </motion.div>
  );
}
