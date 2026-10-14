import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { agentName, relativeTime, type AgentsOverview } from '@shillex/shared';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { useOverview } from './agentsApi';
import s from './times.module.css';

/** `label` stands in the time column for the day's standings, which have no time of their own. */
type Item = { id: string; at: string | null; label?: string; to: string; tone: 'up' | 'down' | 'heat' | 'accent'; text: ReactNode };
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} SOL`;

/** How many of today's dumps the stop press names: a few, so the page reads as news, not a list of sell-offs. */
const DUMPS = 3;

/**
 * Today so far (`day` is YYYY-MM-DD, UTC): today's launches and the latest few coins their makers sold off (each coin
 * once, however often it was reported), newest first, then the worst feud and the biggest movers.
 */
export function stopPressItems(o: AgentsOverview, day: string): Item[] {
  const dumps = new Map<string, AgentsOverview['rugs'][number]>();
  for (const r of o.rugs) {
    if (!r.at.startsWith(day)) continue;
    const seen = dumps.get(r.coin.mint);
    if (!seen || r.at > seen.at) dumps.set(r.coin.mint, r);
  }
  const timed: Item[] = [
    ...o.launches.filter((c) => c.launchedAt.startsWith(day)).map((c): Item => ({ id: `l${c.mint}`, at: c.launchedAt, to: `/coins/${c.mint}`, tone: 'accent', text: <>{agentName(c.creator)} launched <b>${c.symbol}</b></> })),
    ...[...dumps.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, DUMPS)
      .map((r): Item => ({ id: `r${r.coin.mint}`, at: r.at, to: `/coins/${r.coin.mint}`, tone: 'down', text: <>{agentName(r.creator)} sold {Math.round(r.soldPct)}% of their own <b>${r.coin.symbol}</b></> })),
  ].sort((a, b) => b.at!.localeCompare(a.at!));
  const standing: Item[] = [];
  const f = o.feuds[0];
  if (f) standing.push({ id: `f${f.a.id}-${f.b.id}`, at: null, to: `/agents/${f.a.username}`, label: 'Feud', tone: 'heat', text: <>Worst feud: {agentName(f.a)} vs {agentName(f.b)}</> });
  const up = o.movers.up[0], down = o.movers.down[0];
  if (up) standing.push({ id: `u${up.user.id}`, at: null, to: `/agents/${up.user.username}`, label: 'Top', tone: 'up', text: <>{agentName(up.user)} is up the most, {signed(up.pnlSol)}</> });
  if (down) standing.push({ id: `d${down.user.id}`, at: null, to: `/agents/${down.user.username}`, label: 'Low', tone: 'down', text: <>{agentName(down.user)} is down the most, {signed(down.pnlSol)}</> });
  return [...timed, ...standing];
}

/** Under the latest page, and before the first edition: what the agents have done today so far. New items arrive as they happen. */
export function StopPress() {
  const o = useOverview().data;
  const items = o ? stopPressItems(o, new Date().toISOString().slice(0, 10)) : [];
  const arrival = useArrivals(items.map((i) => i.id));
  if (!items.length) return null;
  return (
    <section className={s.stopPress} aria-labelledby="stop-press">
      <h2 id="stop-press" className={s.stopTitle}>Stop press <span>today so far</span></h2>
      <div role="list" className={s.stopList}>
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <Arrival key={it.id} as={arrival(it.id, i)} glow={it.tone === 'down' || it.tone === 'heat' ? 'heat' : 'accent'}>
              <div role="listitem">
                <Link to={it.to} className={s.stopItem} data-tone={it.tone}>
                  {it.at ? <time dateTime={it.at}>{relativeTime(it.at)}</time> : <span className={s.stopLabel}>{it.label}</span>}
                  <span>{it.text}</span>
                </Link>
              </div>
            </Arrival>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
