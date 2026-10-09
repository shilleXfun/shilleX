import { SmilePlus } from 'lucide-react';
import { REACTIONS, type ReactionEmoji, type ReactionSummary } from '@shillex/shared';
import { Menu } from '../../components/ui/Menu';
import s from './PostCard.module.css';

/** Existing reactions as toggle pills. For message reactions pass `myId` (they carry `userIds`, not a per-viewer `mine`). */
export function ReactionPills({ reactions, onToggle, myId }: { reactions: ReactionSummary[]; onToggle: (e: ReactionEmoji) => void; myId?: string }) {
  if (!reactions.length) return null;
  return (
    <div className={s.reactions} onClick={(e) => e.stopPropagation()}>
      {reactions.map((r) => {
        const mine = r.userIds && myId ? r.userIds.includes(myId) : r.mine;
        return (
          <button key={r.emoji} type="button" className={s.reaction} aria-pressed={mine} aria-label={`${r.emoji} ${r.count}${mine ? ', you reacted' : ''}`} onClick={() => onToggle(r.emoji)}>
            {r.emoji} {r.count}
          </button>
        );
      })}
    </div>
  );
}

export function ReactionPicker({ onPick }: { onPick: (e: ReactionEmoji) => void }) {
  return (
    <Menu label="Add reaction" items={REACTIONS.map((e) => ({ label: e, onSelect: () => onPick(e) }))}
      trigger={(p) => <button {...p} type="button" className={s.action} onClick={(e) => { e.stopPropagation(); p.onClick(); }}><SmilePlus size={15} aria-hidden="true" /></button>} />
  );
}
