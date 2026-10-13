import { useMemo, type CSSProperties, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AgentGraph, UserSummary } from '@shillex/shared';
import { speakerHue } from '../home/speaker';
import { homeQuery } from '../home/homeApi';
import { graphQuery } from './agentsApi';
import s from './mention.module.css';

/** What a mention needs to name an agent: its handle, the name it goes by and its picture. */
export interface AgentRef { id: string; username: string; displayName: string; avatarUrl: string }

const fromGraph = (g: AgentGraph) => g.nodes.map((n): AgentRef => ({ id: n.id, username: n.username, displayName: n.displayName || n.username, avatarUrl: n.avatarUrl ?? `/api/agents/avatars/${n.id}.svg` }));

/**
 * Every agent a mention can name, by lower-cased username: the world's graph, plus the casts and characters the home
 * page carries (so a story's newest agent resolves before the graph's next refresh).
 */
export function useAgentDirectory(): ReadonlyMap<string, AgentRef> {
  // Read-only observers: the backdrop keeps the graph polled and the shell keeps the home polled, so these never fetch
  // (and a page full of mentions adds no timers).
  const graph = useQuery({ ...graphQuery, enabled: false, select: fromGraph }).data;
  const home = useQuery({ ...homeQuery, enabled: false }).data;
  return useMemo(() => {
    const m = new Map<string, AgentRef>();
    const add = (u: Pick<UserSummary, 'id' | 'username' | 'displayName' | 'avatarUrl'>) => { const k = u.username.toLowerCase(); if (!m.has(k)) m.set(k, { id: u.id, username: u.username, displayName: u.displayName || u.username, avatarUrl: u.avatarUrl }); };
    for (const a of graph ?? []) add(a);
    for (const st of home?.stories ?? []) st.cast.forEach(add);
    for (const sc of home?.scenes ?? []) sc.cast.forEach(add);
    for (const ch of home?.characters ?? []) add(ch.user);
    return m;
  }, [graph, home]);
}

const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * An @mention of an agent, shown by the name it goes by ("@Ember", not "@ember_30"), in the colour of its avatar.
 * `chip` (the default) adds the small avatar on a tinted pill for running text; `text` is the bare coloured name, for
 * transcripts. The handle stays in the tooltip.
 */
export function AgentMention({ agent, variant = 'chip', suffix = '' }: { agent: AgentRef; variant?: 'chip' | 'text'; suffix?: string }) {
  const style = { '--hue': speakerHue(agent) } as CSSProperties;
  return (
    <Link to={`/agents/${agent.username}`} className={variant === 'chip' ? s.chip : s.text} style={style} title={`@${agent.username}`} onClick={stop}>
      {variant === 'chip' && <img src={agent.avatarUrl} alt="" width={16} height={16} className={s.face} loading="lazy" />}
      <span>{variant === 'text' ? '@' : ''}{agent.displayName}{suffix}</span>
    </Link>
  );
}
