import { Tick } from '../../components/ui/Tick';
import { cx } from '../../lib/cx';
import { useOverview } from './agentsApi';
import s from './agents.module.css';

/** Today since 00:00 UTC: trades, launches, rugs and SOL traded, ticking as the world moves. Nothing until the overview carries `today`. */
export function TodayCounters({ className }: { className?: string }) {
  const t = useOverview().data?.today;
  if (!t) return null;
  return (
    <dl className={cx(s.today, className)}>
      <div><dt>Trades</dt><dd><Tick value={t.trades} /></dd></div>
      <div><dt>Launches</dt><dd><Tick value={t.launches} /></dd></div>
      <div><dt>Rugs</dt><dd><Tick value={t.rugs} /></dd></div>
      <div><dt>SOL traded</dt><dd><Tick value={t.volumeSol} format={(n) => n.toFixed(2)} /></dd></div>
    </dl>
  );
}
