import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { agentName, type AgentsOverview } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import s from './agents.module.css';

type Mood = AgentsOverview['moods'][number];

const clamp = (m: number) => Math.max(-1, Math.min(1, m));
/** A mood (-1..1) in words, for labels and tooltips; the page shows it as a bar and a glow. */
export const moodWord = (m: number) => (m >= 0.5 ? 'euphoric' : m >= 0.15 ? 'upbeat' : m > -0.15 ? 'flat' : m > -0.5 ? 'sour' : 'miserable');
/** The agent's colour: its faction's, or amber for agents on their own (as on the backdrop). */
const colourOf = (m: Mood) => m.faction?.colour ?? 'var(--accent)';
/** P&L to 3 places; what rounds to zero shows as a plain 0.000 rather than a red −0.000. */
const flat = (n: number) => Math.abs(n) < 0.0005;
const pnl = (n: number) => (flat(n) ? '0.000' : `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}`);
/** Happiest first, ghosts last; equal moods keep a fixed order so tiles don't swap on every refresh. */
const byMood = (a: Mood, b: Mood) => Number(a.ghost) - Number(b.ghost) || b.mood - a.mood || a.user.username.localeCompare(b.user.username);

/** One line for the card header, e.g. "31 of 50 in a good mood, 3 broke". */
export function moodSummary(moods: Mood[]) {
  const good = moods.filter((m) => !m.ghost && m.mood >= 0.15).length;
  const broke = moods.filter((m) => m.broke).length;
  const ghosts = moods.filter((m) => m.ghost).length;
  return [`${good} of ${moods.length} in a good mood`, broke && `${broke} broke`, ghosts && `${ghosts} ${ghosts === 1 ? 'ghost' : 'ghosts'}`].filter(Boolean).join(', ');
}

// The track is 48 px tall with 8 px dots: stacks spread over at most ±18 px, 10 px apart when there is room.
const BINS = 32, TRACK = 36, GAP = 10;
/** Places every agent on the miserable → euphoric line; agents with near-equal moods stack up and down from the middle. */
function spread(moods: Mood[]) {
  const bins = new Map<number, Mood[]>();
  for (const m of [...moods].sort(byMood)) {
    const b = Math.min(BINS - 1, Math.floor(((clamp(m.mood) + 1) / 2) * BINS));
    bins.set(b, [...(bins.get(b) ?? []), m]);
  }
  return [...bins.values()].flatMap((group) => {
    const step = group.length > 1 ? Math.min(GAP, TRACK / (group.length - 1)) : 0;
    // 0, -1, 1, -2, 2 …: the first agent sits on the middle line.
    return group.map((m, i) => ({ m, x: 3 + ((clamp(m.mood) + 1) / 2) * 94, y: (i % 2 ? -1 : 1) * Math.ceil(i / 2) * step }));
  });
}

/** Every agent as a light on one line from miserable to euphoric, in its faction's colour: the whole swarm's mood at a glance. */
export function MoodSpread({ moods }: { moods: Mood[] }) {
  return (
    <div className={s.spread} aria-hidden="true">
      <div className={s.spreadTrack}>
        {spread(moods).map(({ m, x, y }) => (
          <span key={m.user.id} className={s.spreadDot} data-ghost={m.ghost}
            style={{ left: `${x.toFixed(2)}%`, '--dy': `${y.toFixed(1)}px`, '--c': colourOf(m) } as CSSProperties} />
        ))}
      </div>
      <div className={s.spreadScale}><span>Miserable</span><span>Flat</span><span>Euphoric</span></div>
    </div>
  );
}

/** Which colour is which faction, with head counts; says so plainly when there are none yet. */
export function FactionKey({ moods }: { moods: Mood[] }) {
  const factions = new Map<string, { name: string; colour: string; n: number }>();
  for (const m of moods) if (m.faction) factions.set(m.faction.id, { ...m.faction, n: (factions.get(m.faction.id)?.n ?? 0) + 1 });
  if (!factions.size) return <p className={s.keyNote}>No factions yet. Every agent is on its own.</p>;
  const loners = moods.filter((m) => !m.faction).length;
  const rows = [...factions.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return (
    <ul className={s.factionKey} aria-label="Factions">
      {rows.map((f) => <li key={f.name} style={{ '--c': f.colour } as CSSProperties}><span className={s.keyDot} />{f.name}<span className={s.keyCount}>{f.n}</span></li>)}
      {loners > 0 && <li style={{ '--c': 'var(--accent)' } as CSSProperties}><span className={s.keyDot} />On their own<span className={s.keyCount}>{loners}</span></li>}
    </ul>
  );
}

/** One tile per agent: avatar ringed in its faction colour and glowing with its mood, a mood bar and its P&L. Ghosts fade. */
export function MoodGrid({ moods }: { moods: Mood[] }) {
  const still = useReducedMotion();
  return (
    <ul className={s.moodGrid} aria-label="Everyone’s mood">
      {[...moods].sort(byMood).map((m) => {
        const name = agentName(m.user);
        const mood = clamp(m.mood);
        const label = [name, m.faction?.name, m.ghost && 'ghost', m.broke && 'broke', `${moodWord(mood)} mood`, `${pnl(m.pnlSol)} SOL`].filter(Boolean).join(', ');
        return (
          // A refresh re-sorts the grid; tiles glide to their new places (they jump under reduced motion).
          <motion.li key={m.user.id} layout={still ? false : 'position'} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
            <Link to={`/agents/${m.user.username}`} aria-label={label} title={label} className={s.moodTile} data-ghost={m.ghost}
              style={{ '--c': colourOf(m), '--m': ((mood + 1) / 2).toFixed(2) } as CSSProperties}>
              <span className={s.moodAvatar}>
                <Avatar src={m.user.avatarUrl} size={36} alt="" agentId={m.user.id} />
                {(m.ghost || m.broke) && <span className={s.moodTag}>{m.ghost ? 'ghost' : 'broke'}</span>}
              </span>
              <span className={s.moodName}>{name}</span>
              <span className={s.moodBar}>
                <span className={s.moodFill} data-dir={mood >= 0 ? 'up' : 'down'} style={{ left: `${mood >= 0 ? 50 : 50 + mood * 50}%`, width: `${Math.abs(mood) * 50}%` }} />
              </span>
              <span className={`${s.moodPnl} ${flat(m.pnlSol) ? s.muted : m.pnlSol > 0 ? s.up : s.down}`}>{pnl(m.pnlSol)}</span>
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}
