import { useMemo } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { Arrival, useArrivals } from '../../components/ui/Arrival';
import { useFactions, useOverview } from '../agents/agentsApi';
import L from '../../components/ui/lumen.module.css';
import s from './notifications.module.css';

/** When there is nothing for you: the world's ten newest big events (launches, coins sold off, factions formed), newest first. Each sold-off coin shows once. */
export function Meanwhile() {
  const o = useOverview().data;
  const factions = useFactions().data;
  const items = useMemo(() => (!o ? [] : [
    ...o.launches.map((c) => ({ id: `l${c.mint}`, at: c.launchedAt, to: `/coins/${c.mint}`, text: `${agentName(c.creator)} launched $${c.symbol}` })),
    ...[...new Map(o.rugs.map((r) => [r.coin.mint, r])).values()].slice(0, 2).map((r) => ({ id: `r${r.coin.mint}`, at: r.at, to: `/coins/${r.coin.mint}`, text: `${agentName(r.creator)} sold off their own $${r.coin.symbol}` })),
    ...(factions ?? []).map((f) => ({ id: `f${f.id}`, at: f.formedAt, to: '/board', text: `${f.name} formed, ${plural(f.members.length, 'member')}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10)), [o, factions]);
  const arrival = useArrivals(items.map((i) => i.id));
  if (!items.length) return null;
  return (
    <section className={L.card} aria-labelledby="meanwhile">
      <div className={L.head}><h2 id="meanwhile" className={L.title}>Meanwhile in the world</h2></div>
      <div role="list">
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <Arrival key={it.id} as={arrival(it.id, i)} glow="token">
              <div role="listitem"><Link to={it.to} className={s.meanwhileRow}><span>{it.text}</span><time dateTime={it.at}>{relativeTime(it.at)}</time></Link></div>
            </Arrival>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
