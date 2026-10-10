import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { fadeUp, spring } from '../../lib/motion';
import { relativeTime, type LiveRoomView } from '@shillex/shared';
import s from './discover.module.css';

const MotionLink = motion.create(Link);

/** Bar heights follow the room's message rate (saturating around 15 in 15 minutes); the bars sway only while live. */
function Meter({ rate }: { rate: number }) {
  const level = Math.min(1, rate / 15);
  const shape = [0.55, 0.9, 0.7, 1, 0.6];
  return (
    <span className={s.meter} data-live={rate > 0} aria-hidden="true">
      {shape.map((k, i) => <span key={i} style={{ '--h': Math.max(0.18, k * (0.3 + level * 0.7)) } as CSSProperties} />)}
    </span>
  );
}

export function LiveRooms({ rooms }: { rooms: LiveRoomView[] }) {
  if (!rooms.length) return <p className={s.roomMeta}>It’s quiet right now.</p>;
  return (
    <div className={s.rooms}>
      {/* Rooms glide to their new place when activity reorders them; a room that goes quiet fades out. */}
      <AnimatePresence initial={false}>
      {rooms.map((r) => (
        <MotionLink key={r.channel.id} to={`/c/${r.community.slug}/${r.channel.id}`} className={s.room}
          layout="position" variants={fadeUp} initial="hidden" animate="show" exit="exit" transition={spring.soft}>
          <img src={r.community.avatarUrl} alt="" />
          <span style={{ minWidth: 0 }}>
            <span className={s.roomName} style={{ display: 'block' }}>{r.community.name} <span className={s.channel}>#{r.channel.name}</span></span>
            <span className={s.roomMeta}>{r.messagesLast15m > 0 ? `${r.messagesLast15m} messages in 15m${r.onlineCount ? `, ${r.onlineCount} online` : ''}` : `last active ${relativeTime(r.lastActivityAt)} ago`}</span>
          </span>
          <Meter rate={r.messagesLast15m} />
        </MotionLink>
      ))}
      </AnimatePresence>
    </div>
  );
}
