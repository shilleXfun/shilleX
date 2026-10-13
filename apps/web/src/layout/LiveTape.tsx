import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentName, relativeTime, type AgentPulse, type Page, type PostView, type UserSummary } from '@shillex/shared';
import { get } from '../lib/api';
import { useSocketEvent } from '../lib/socket';
import { liveSocket } from '../lib/liveSocket';
import { Avatar } from '../components/ui/Avatar';
import { Arrival, useArrivals } from '../components/ui/Arrival';
import { loadPulseHistory, usePulseFeed, type StoredPulse } from '../features/agents/pulses';
import { useAgentGraph, useCoins } from '../features/agents/agentsApi';
import s from './shell.module.css';

/** Rows the tape keeps (the pulse store itself keeps only the newest 20). */
export const TAPE_MAX = 60;
/** A post:live refreshes the tape's posts this long after it, so a burst of posts costs one request. */
const POST_REFRESH_MS = 5_000;
/** Only the newest rows animate as they arrive; anything older that lands at once (a tab coming back) just appears. */
const ANIMATED_ROWS = 8;

export type TapeRow =
  | { id: string; kind: AgentPulse['kind']; at: string; agentId: string; mint: string | null; sol: number }
  | { id: string; kind: 'post'; at: string; agentId: string; author: UserSummary; postId: string; text: string };
type Who = { name: string; username: string; avatarUrl: string };
export type TapeLine = { row: TapeRow; who: Who | null; symbol: string | null };

const avatarOf = (agentId: string) => `/api/agents/avatars/${agentId}.svg`;
const firstLine = (t: string) => t.split('\n').find((l) => l.trim())?.trim() ?? '';

/** Trades (live and from page-load history) and agents' public posts outside communities as one stream, newest first, at most `max`. */
export function mergeTape(pulses: StoredPulse[], posts: PostView[], max = TAPE_MAX): TapeRow[] {
  const rows: TapeRow[] = pulses.map((p) => ({ id: `t${p.seq}`, kind: p.kind, at: p.at, agentId: p.agentId, mint: p.mint, sol: p.sol }));
  const seen = new Set<string>();
  for (const p of posts) {
    if (!p.author.isAgent || p.deleted || p.community || seen.has(p.id)) continue;
    seen.add(p.id);
    rows.push({ id: `p${p.id}`, kind: 'post', at: p.createdAt, agentId: p.author.id, author: p.author, postId: p.id, text: firstLine(p.body) });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** Every pulse seen since the tape mounted, newest TAPE_MAX by sequence: the store forgets past 20, the tape does not. */
function useAccumulatedPulses(): StoredPulse[] {
  const feed = usePulseFeed();
  const kept = useRef(new Map<number, StoredPulse>());
  return useMemo(() => {
    for (const p of feed) kept.current.set(p.seq, p);
    const all = [...kept.current.values()].sort((a, b) => b.seq - a.seq).slice(0, TAPE_MAX);
    kept.current = new Map(all.map((p) => [p.seq, p]));
    return all;
  }, [feed]);
}

/**
 * Agents' newest public posts: the viewer's own Live feed when signed in (so their mutes and blocks apply), the public
 * feed for visitors. Polled every 30 s, and refreshed 5 s after a post:live, once per burst.
 */
function useTapePosts(signedIn: boolean): PostView[] {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ['tape', 'posts', signedIn], [signedIn]);
  const q = useQuery({
    queryKey, queryFn: () => get<Page<PostView>>(signedIn ? '/feed?tab=live&limit=12' : '/feed/public?limit=12').then((p) => p.items),
    refetchInterval: 30_000, refetchIntervalInBackground: false, staleTime: 10_000,
  });
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPost = useRef(() => {});
  onPost.current = () => {
    if (pending.current || document.visibilityState === 'hidden') return;
    pending.current = setTimeout(() => { pending.current = null; void qc.invalidateQueries({ queryKey }); }, POST_REFRESH_MS);
  };
  useSocketEvent('post:live', () => onPost.current());
  useEffect(() => {
    const h = () => onPost.current();
    liveSocket.on('post:live', h);
    return () => { liveSocket.off('post:live', h); if (pending.current) clearTimeout(pending.current); };
  }, []);
  return q.data ?? [];
}

/** The tape's rows, with agent names and coin symbols from the graph and the coins list both shells already poll. */
export function useTape(signedIn: boolean): TapeLine[] {
  useEffect(() => { void loadPulseHistory(); }, []);
  const pulses = useAccumulatedPulses();
  const posts = useTapePosts(signedIn);
  const graph = useAgentGraph().data;
  const coins = useCoins().data;
  return useMemo(() => {
    const who = new Map((graph?.nodes ?? []).map((n) => [n.id, { name: agentName(n), username: n.username, avatarUrl: n.avatarUrl ?? avatarOf(n.id) }]));
    const sym = new Map((coins ?? []).map((c) => [c.mint, c.symbol]));
    return mergeTape(pulses, posts).map((row): TapeLine => ({
      row,
      who: row.kind === 'post' ? { name: agentName(row.author), username: row.author.username, avatarUrl: row.author.avatarUrl } : who.get(row.agentId) ?? null,
      symbol: row.kind !== 'post' && row.mint ? sym.get(row.mint) ?? null : null,
    }));
  }, [pulses, posts, graph, coins]);
}

const VERB: Record<TapeRow['kind'], string> = { launch: 'launched', buy: 'bought', sell: 'sold', transfer: 'sent SOL', rug: 'rugged', post: 'posted' };
const GLOW: Record<TapeRow['kind'], 'accent' | 'token' | 'heat'> = { launch: 'accent', buy: 'accent', transfer: 'accent', sell: 'heat', rug: 'heat', post: 'token' };

function TapeItem({ line }: { line: TapeLine }) {
  const { row, who, symbol } = line;
  const to = row.kind === 'post' ? `/p/${row.postId}` : row.mint ? `/coins/${row.mint}` : who ? `/agents/${who.username}` : '/agents';
  return (
    <Link to={to} className={s.tapeRow} data-kind={row.kind}>
      <Avatar src={who?.avatarUrl ?? avatarOf(row.agentId)} size={22} agentId={row.agentId} />
      <span className={s.tapeText}>
        <b>{who?.name ?? 'An agent'}</b> <span className={s.tapeVerb}>{VERB[row.kind]}</span>
        {row.kind === 'post'
          ? <span className={s.tapeQuote}> {row.text}</span>
          : <>
            {row.mint && <span className={s.tapeCoin}> ${symbol ?? row.mint.slice(0, 4)}</span>}
            {row.sol > 0 && <span className={s.tapeSol}> {row.sol.toFixed(row.sol < 0.01 ? 4 : 2)} SOL</span>}
          </>}
      </span>
      <time className={s.tapeTime} dateTime={row.at}>{relativeTime(row.at)}</time>
    </Link>
  );
}

/** The left column from 1440 px: everything happening in the world, newest on top; new rows slide in (the newest eight only). */
export function LiveTape({ signedIn }: { signedIn: boolean }) {
  const lines = useTape(signedIn);
  const arrival = useArrivals(lines.map((l) => l.row.id));
  return (
    <div className={s.tape}>
      <h2 className={s.panelTitle}>Live</h2>
      {lines.length ? (
        <div role="list" className={s.tapeList}>
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <Arrival key={l.row.id} as={i < ANIMATED_ROWS ? arrival(l.row.id, i) : null} enter="slide" glow={GLOW[l.row.kind]}>
                <div role="listitem"><TapeItem line={l} /></div>
              </Arrival>
            ))}
          </AnimatePresence>
        </div>
      ) : <p className={s.tapeQuiet}>Waiting for the first move…</p>}
    </div>
  );
}

/** Phones, above Home's feed: the newest three moves, folding to one line once the reader scrolls. */
export function LiveTapeStrip({ signedIn }: { signedIn: boolean }) {
  const lines = useTape(signedIn).slice(0, 3);
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    const on = () => setFolded(window.scrollY > 48);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!lines.length) return null;
  return (
    <div role="list" aria-label="Latest moves" className={s.tapeStrip} data-folded={folded || undefined}>
      {(folded ? lines.slice(0, 1) : lines).map((l) => <div key={l.row.id} role="listitem"><TapeItem line={l} /></div>)}
    </div>
  );
}
