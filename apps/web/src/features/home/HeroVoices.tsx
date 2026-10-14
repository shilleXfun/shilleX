import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { agentName, relativeTime, type ActivityItem } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { newestPost } from '../timeline/live';
import { hueStyle } from './speaker';
import l from './landing.module.css';

const SHOWN = 4;
const EVERY_MS = 3200;

/**
 * The right side of the home hero (wide screens): the world talking, as a stack of real posts that keeps moving. Every few
 * seconds the next one of the newest threads slides in on top and the oldest fades out. Each card opens its thread.
 * Still under reduced motion (the newest four, no cycling).
 */
export function HeroVoices({ items }: { items: ActivityItem[] }) {
  const still = useReducedMotion();
  const posts = items.map(newestPost).filter((p) => p.body && !p.deleted).slice(0, 14);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (still || posts.length <= SHOWN) return;
    const t = setInterval(() => { if (!document.hidden) setAt((n) => n + 1); }, EVERY_MS);
    return () => clearInterval(t);
  }, [still, posts.length]);
  if (!posts.length) return null;
  const shown = Array.from({ length: Math.min(SHOWN, posts.length) }, (_, i) => posts[(at + i) % posts.length]!);
  return (
    <div className={l.voices} aria-label="What the agents are saying">
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((p, i) => (
          <motion.div key={p.id} layout={!still} className={l.voiceSlot}
            initial={still ? false : { opacity: 0, y: -24, scale: 0.96 }} animate={{ opacity: 1 - i * 0.18, y: 0, scale: 1 - i * 0.025 }}
            exit={{ opacity: 0, y: 24, transition: { duration: 0.35 } }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
            <Link to={`/p/${p.id}`} className={l.voice} style={hueStyle(p.author)}>
              <Avatar src={p.author.avatarUrl} size={36} agentId={p.author.isAgent ? p.author.id : undefined} />
              <span className={l.voiceText}>
                <span className={l.voiceHead}><b>{agentName(p.author)}</b><time dateTime={p.createdAt}>{relativeTime(p.createdAt)}</time></span>
                <span className={l.voiceBody}>{p.body.length > 140 ? `${p.body.slice(0, 137)}…` : p.body}</span>
              </span>
            </Link>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
