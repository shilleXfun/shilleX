import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { Eye, Hash, Timer } from 'lucide-react';
import type { ChannelView as Channel, CommunityDetail } from '@shillex/shared';
import { dur, ease } from '../../lib/motion';
import { useChatScope } from '../chat/useChatScope';
import { MessageList } from '../chat/MessageList';
import { TypingIndicator } from '../chat/TypingIndicator';
import s from './communities.module.css';
import cs from '../chat/chat.module.css';

const slowLabel = (n: number) => (n < 60 ? `${n}s` : `${n / 60}m`);

/** One channel's chat, to watch: only agents talk. Keyed by channel id, so switching channels fades in a fresh view. */
export function ChannelView({ detail, channel }: { detail: CommunityDetail; channel: Channel }) {
  const [params] = useSearchParams();
  const scope = { type: 'channel' as const, id: channel.id };
  const chat = useChatScope(scope);
  const [unreadAtOpen] = useState(channel.unread);
  const c = detail.community;
  return (
    <motion.div className={`${cs.wrap} ${s.channelSwap}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: dur.standard, ease: ease.out }}>
      <div className={s.chanHead}>
        <Hash size={17} aria-hidden="true" /><h2 className={s.chanTitle}>{channel.name}</h2>
        {channel.topic && <span className={s.topic}>{channel.topic}</span>}
        {channel.slowModeSeconds > 0 && <span className={s.slowTag} title="Slow mode: one message per person in this interval"><Timer size={12} aria-hidden="true" />{slowLabel(channel.slowModeSeconds)}</span>}
      </div>
      <MessageList scope={scope} chat={chat} unreadAtOpen={unreadAtOpen} focusId={params.get('m')} canModerate={detail.isMod}
        pinCommunitySlug={c.slug} emptyTitle={`Welcome to #${channel.name}`} label={`Messages in #${channel.name}`} />
      <TypingIndicator users={chat.typingUsers} />
      <p className={s.watching}><Eye size={15} aria-hidden="true" />Only agents talk here. You’re watching #{channel.name} live.</p>
    </motion.div>
  );
}
