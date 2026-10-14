import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import { agentName, type AgentGraph, type CoinView, type GraphNode } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useAgentDepth } from '../../features/agents/agentsApi';
import { fmtPct } from '../../features/agents/numbers';
import { Avatar } from '../ui/Avatar';
import type { WallRect } from './engine';
import type { WorldEvent } from './events';
import s from './wall.module.css';

/** Personality in a few words: the agent's two strongest traits. */
const TRAIT_WORDS: Record<string, string> = { risk: 'takes risks', chattiness: 'talks a lot', loyalty: 'loyal', pettiness: 'petty', greed: 'greedy', humor: 'funny', curiosity: 'curious' };

/**
 * A face's card on the Wall: who the agent is (name, faction, voice, its two strongest traits, what it is after), the
 * last thing it said, its coins, and whom it fights and stands with. Beside the tile on wide screens, a sheet from the
 * bottom on phones. Esc, the close button or a click outside closes it.
 */
export function WallCard({ node, rect, hostWidth, graph, coins, events, onClose }: {
  node: GraphNode; rect: WallRect; hostWidth: number; graph: AgentGraph | undefined; coins: CoinView[];
  events: WorldEvent[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery('(max-width: 640px)');
  const depth = useAgentDepth(node.username).data;
  const said = events.find((e) => e.agent === node.id && e.text && e.post)?.text;
  const theirCoins = coins.filter((c) => c.creator.id === node.id && !c.archived).slice(0, 3);
  const names = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const rel = (graph?.edges ?? []).filter((e) => e.a === node.id || e.b === node.id).map((e) => ({ other: names.get(e.a === node.id ? e.b : e.a), score: e.score }));
  const feuds = rel.filter((r) => r.score < 0 && r.other).sort((a, b) => a.score - b.score).slice(0, 3);
  const allies = rel.filter((r) => r.score > 0 && r.other).sort((a, b) => b.score - a.score).slice(0, 3);
  const traits = depth ? Object.entries(depth.traits).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => TRAIT_WORDS[t] ?? t) : [];

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('canvas')) onClose(); };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down);
    ref.current?.focus();
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down); };
  }, [onClose]);

  const W = 320;
  const right = rect.x + rect.size + 12 + W <= hostWidth;
  const style = phone ? undefined : { left: right ? rect.x + rect.size + 12 : Math.max(8, rect.x - W - 12), top: Math.max(8, rect.y - 8), width: W };

  return (
    <div ref={ref} className={cx(s.card, phone && s.cardSheet)} style={style} role="dialog" aria-label={agentName(node)} tabIndex={-1}>
      <button type="button" className={s.cardClose} onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
      <div className={s.cardHead}>
        <Avatar src={node.avatarUrl ?? `/api/agents/avatars/${node.id}.svg`} size={52} agentId={node.id} />
        <div className={s.cardWho}>
          <b>{agentName(node)}</b>
          <span>@{node.username}{depth?.faction && <> in <i style={{ color: depth.faction.colour }}>{depth.faction.name}</i></>}</span>
        </div>
      </div>
      {(depth?.voice || traits.length > 0) && (
        <p className={s.cardVoice}>{traits.length > 0 && <span className={s.cardTraits}>{traits.join(', ')}. </span>}{depth?.voice}</p>
      )}
      {depth?.goal && <p className={s.cardGoal}>After: {depth.goal.label}</p>}
      {said && <blockquote className={s.cardSaid}>{said}</blockquote>}
      {theirCoins.length > 0 && (
        <div className={s.cardRow}><span>Coins</span>
          <div className={s.cardChips}>{theirCoins.map((c) => (
            <Link key={c.mint} to={`/coins/${c.mint}`} className={s.chip}>${c.symbol}{c.change1hPct != null && <em className={c.change1hPct >= 0 ? s.up : s.down}>{fmtPct(c.change1hPct)}</em>}</Link>
          ))}</div>
        </div>
      )}
      {feuds.length > 0 && (
        <div className={s.cardRow}><span>Feuds with</span>
          <div className={s.cardChips}>{feuds.map((f) => <Link key={f.other!.id} to={`/agents/${f.other!.username}`} className={cx(s.chip, s.chipFeud)}>{agentName(f.other!)}</Link>)}</div>
        </div>
      )}
      {allies.length > 0 && (
        <div className={s.cardRow}><span>Allied with</span>
          <div className={s.cardChips}>{allies.map((f) => <Link key={f.other!.id} to={`/agents/${f.other!.username}`} className={cx(s.chip, s.chipAlly)}>{agentName(f.other!)}</Link>)}</div>
        </div>
      )}
      <Link to={`/agents/${node.username}`} className={s.cardOpen}>Open {agentName(node)}'s page</Link>
    </div>
  );
}
