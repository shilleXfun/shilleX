import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { SmilePlus } from 'lucide-react';
import { REACTIONS, type ReactionEmoji, type ReactionSummary } from '@shillex/shared';
import { createStore, useStore } from '../../lib/store';
import { press, spring } from '../../lib/motion';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Menu } from '../../components/ui/Menu';
import s from './PostCard.module.css';

/** The last reaction the viewer added, so the matching pill (which may only now mount) can play its burst. */
const bursts = createStore<{ key: string; n: number } | null>(null);
let burstN = 0;
export function fireBurst(scope: string, emoji: ReactionEmoji) {
  const n = ++burstN;
  bursts.set({ key: `${scope}:${emoji}`, n });
  // Clear it afterwards so a pill that remounts later (tab switch, refetch) doesn't replay it.
  setTimeout(() => bursts.set((b) => (b?.n === n ? null : b)), 700);
}

/** 7 copies of the emoji fly outward and fade over 450 ms, then unmount. */
function Burst({ emoji }: { emoji: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDone(true), 520); return () => clearTimeout(t); }, []);
  if (done) return null;
  return (
    <span className={s.burst} aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2 - Math.PI / 2 + (i % 2 ? 0.25 : -0.15);
        const d = 26 + (i % 3) * 7;
        return (
          <motion.span key={i} className={s.particle} initial={{ x: 0, y: 0, scale: 0.4, opacity: 1 }}
            animate={{ x: Math.cos(a) * d, y: Math.sin(a) * d, scale: 1 - (i % 3) * 0.15, opacity: 0, rotate: (i % 2 ? 1 : -1) * 25 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>{emoji}</motion.span>
        );
      })}
    </span>
  );
}

function Pill({ r, mine, scope, onToggle }: { r: ReactionSummary; mine: boolean; scope: string; onToggle: () => void }) {
  const signal = useStore(bursts);
  const reduced = useReducedMotion();
  const firing = !reduced && signal?.key === `${scope}:${r.emoji}` ? signal.n : null;
  return (
    <motion.button type="button" className={s.reaction} aria-pressed={mine} aria-label={`${r.emoji} ${r.count}${mine ? ', you reacted' : ''}`} onClick={onToggle}
      layout="position" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.bouncy} whileTap={press.whileTap}>
      <motion.span key={`emoji-${firing ?? 0}`} className={s.reactionEmoji} initial={firing ? { scale: 1.5 } : false} animate={{ scale: 1 }} transition={spring.bouncy}>{r.emoji}</motion.span>
      <AnimatedNumber value={r.count} />
      {firing && <Burst key={`burst-${firing}`} emoji={r.emoji} />}
    </motion.button>
  );
}

/** Existing reactions as toggle pills. For message reactions pass `myId` (they carry `userIds`, not a per-viewer `mine`). */
export function ReactionPills({ reactions, onToggle, myId, scope }: { reactions: ReactionSummary[]; onToggle: (e: ReactionEmoji) => void; myId?: string; scope: string }) {
  if (!reactions.length) return null;
  return (
    <div className={s.reactions} onClick={(e) => e.stopPropagation()}>
      <AnimatePresence initial={false} mode="popLayout">
        {reactions.map((r) => {
          const mine = (r.userIds && myId ? r.userIds.includes(myId) : r.mine) ?? false;
          return <Pill key={r.emoji} r={r} mine={mine} scope={scope} onToggle={() => { if (!mine) fireBurst(scope, r.emoji); onToggle(r.emoji); }} />;
        })}
      </AnimatePresence>
    </div>
  );
}

/** Horizontal tray of the six reactions. Picking one you haven't used plays its burst on the pill. */
export function ReactionPicker({ onPick, scope, reactions }: { onPick: (e: ReactionEmoji) => void; scope: string; reactions: ReactionSummary[] }) {
  const mineSet = new Set(reactions.filter((r) => r.mine).map((r) => r.emoji));
  return (
    <Menu label="Add reaction" layout="tray" items={REACTIONS.map((e) => ({ label: e, onSelect: () => { if (!mineSet.has(e)) fireBurst(scope, e); onPick(e); } }))}
      trigger={(p) => <motion.button {...p} {...press} type="button" className={s.action} onClick={(e) => { e.stopPropagation(); p.onClick(); }}><SmilePlus size={16} aria-hidden="true" /></motion.button>} />
  );
}
