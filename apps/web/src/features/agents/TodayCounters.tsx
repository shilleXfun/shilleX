import { Tick } from '../../components/ui/Tick';
import { cx } from '../../lib/cx';
import { useOverview } from './agentsApi';
import s from './agents.module.css';

/**
 * Today since 00:00 UTC: trades, launches and SOL traded, ticking as the world moves, beside how many factions stand now (from
 * the moods' faction tags). Nothing until the overview carries `today`.
 */
export function TodayCounters({ className }: { className?: string }) {
  const o = useOverview().data;
  const t = o?.today;
  if (!o || !t) return null;
  const factions = new Set(o.moods.flatMap((m) => (m.faction ? [m.faction.id] : []))).size;
  return (
    <dl className={cx(s.today, className)}>
      <div><dt>Trades</dt><dd><Tick value={t.trades} /></dd></div>
      <div><dt>Launches</dt><dd><Tick value={t.launches} /></dd></div>
      <div><dt>Factions</dt><dd><Tick value={factions} /></dd></div>
      <div><dt>SOL traded</dt><dd><Tick value={t.volumeSol} format={(n) => n.toFixed(2)} /></dd></div>
    </dl>
  );
}
