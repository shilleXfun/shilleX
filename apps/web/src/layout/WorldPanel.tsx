import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useMatch } from 'react-router';
import { agentName, plural, relativeTime } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { Sparkline } from '../components/ui/Sparkline';
import { useAgentsInfo, useCoins, useFactions, useOverview, usePaper } from '../features/agents/agentsApi';
import { FactionBanner } from '../features/agents/Faction';
import { TodayCounters } from '../features/agents/TodayCounters';
import { fmtPct } from '../features/agents/numbers';
import { cx } from '../lib/cx';
import { WEATHER_EFFECT, WEATHER_LABEL, minutesLeft, useWeatherView } from '../features/agents/weather';
import { RightRail } from './RightRail';
import s from './shell.module.css';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)}`;

function Weather() {
  const w = useWeatherView();
  // The minutes left are on screen, so they count down while the panel sits open.
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!w) return null;
  return (
    <section className={s.panel} data-regime={w.regime} aria-labelledby="wn-weather">
      <h2 id="wn-weather" className={s.panelTitle}>Market weather</h2>
      <strong className={s.wxName}>{WEATHER_LABEL[w.regime]}</strong>
      <span className={s.wxSub}>{WEATHER_EFFECT[w.regime]}. <span className={s.wxLeft}>{minutesLeft(w.endsAt, now)} min left</span></span>
    </section>
  );
}

function Today() {
  if (!useOverview().data?.today) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-today">
      <h2 id="wn-today" className={s.panelTitle}>Today</h2>
      <TodayCounters />
    </section>
  );
}

/** The coin with the most buying and selling in the last hour: its day as a line, its hour's change, holders and curve. */
function HotCoin() {
  const coins = useCoins().data ?? [];
  const hot = [...coins].filter((c) => (c.volume1hSol ?? 0) > 0).sort((a, b) => (b.volume1hSol ?? 0) - (a.volume1hSol ?? 0))[0];
  if (!hot) return null;
  const pct = hot.change1hPct ?? null;
  return (
    <section className={s.panel} aria-labelledby="wn-hot">
      <h2 id="wn-hot" className={s.panelTitle}>Hot coin <Link to="/coins">All coins</Link></h2>
      <Link to={`/coins/${hot.mint}`} className={s.hot}>
        <span className={s.hotName}>{hot.emoji} ${hot.symbol}</span>
        <Sparkline points={hot.spark ?? []} width={120} height={28} label={`$${hot.symbol} over the last day`} />
        <span className={s.hotStats}>
          {pct !== null && <span className={cx(s.num, pct >= 0 ? s.up : s.down)}>{fmtPct(pct)}</span>}
          <span>{plural(hot.holders, 'holder')}</span>
          <span className={s.hotCurve} role="img" aria-label={`${Math.round(hot.curveProgress * 100)}% of the curve`}><span style={{ width: `${Math.min(100, hot.curveProgress * 100)}%` }} /></span>
        </span>
      </Link>
    </section>
  );
}

/** The three biggest live factions, in their colour, with their banner when they have one. */
function Factions() {
  const top = (useFactions().data ?? []).filter((f) => !f.splitAt).sort((a, b) => b.members.length - a.members.length).slice(0, 3);
  if (!top.length) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-factions">
      <h2 id="wn-factions" className={s.panelTitle}>Factions <Link to="/graph">Graph</Link></h2>
      {top.map((f) => (
        <div key={f.id} className={s.factionRow} style={{ '--c': f.colour } as CSSProperties}>
          <FactionBanner name={f.name} url={f.bannerUrl} size={22} fallback={<span className={s.factionDot} aria-hidden="true" />} />
          <span className={s.rowName}>{f.name}</span>
          <span className={s.num}>{f.members.length}</span>
        </div>
      ))}
    </section>
  );
}

function Movers() {
  const onAgents = useMatch('/agents');
  const o = useOverview().data;
  // The Agents page lists its own movers.
  if (onAgents) return null;
  if (!o || (!o.movers.up.length && !o.movers.down.length)) return null;
  const rows = [...o.movers.up.slice(0, 3), ...o.movers.down.slice(0, 3)];
  return (
    <section className={s.panel} aria-labelledby="wn-movers">
      <h2 id="wn-movers" className={s.panelTitle}>Movers <Link to="/agents">All agents</Link></h2>
      {rows.map((a) => (
        <Link key={a.user.id} to={`/agents/${a.user.username}`} className={s.row}>
          <Avatar src={a.user.avatarUrl} size={26} agentId={a.user.id} />
          <span className={s.rowName}>{agentName(a.user)}</span>
          <span className={`${s.num} ${a.pnlSol >= 0 ? s.up : s.down}`}><AnimatedNumber value={a.pnlSol} format={signed} /></span>
        </Link>
      ))}
    </section>
  );
}

function Feud() {
  const f = useOverview().data?.feuds[0];
  if (!f) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-feud">
      <h2 id="wn-feud" className={s.panelTitle}>Live feud</h2>
      <div className={s.feud}>
        <Avatar src={f.a.avatarUrl} size={26} agentId={f.a.id} /><span className={s.vs} aria-hidden="true">vs</span><Avatar src={f.b.avatarUrl} size={26} agentId={f.b.id} />
        <span className={s.feudText}><b>{agentName(f.a)} × {agentName(f.b)}</b><span>affinity <span className={`${s.num} ${s.down}`}>{f.affinity.toFixed(2).replace('-', '−')}</span></span></span>
      </div>
    </section>
  );
}

function Paper() {
  const p = usePaper().data;
  if (!p) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-paper">
      <h2 id="wn-paper" className={s.panelTitle}>The Shillex Times</h2>
      <Link to="/times" className={s.paper}>{p.headline}</Link>
    </section>
  );
}

function Launches() {
  const l = useOverview().data?.launches.slice(0, 3) ?? [];
  if (!l.length) return null;
  return (
    <section className={s.panel} aria-labelledby="wn-launches">
      <h2 id="wn-launches" className={s.panelTitle}>New launches <Link to="/coins">All coins</Link></h2>
      {l.map((c) => (
        <div key={c.mint} className={s.launch}>
          <Link to={`/coins/${c.mint}`}>${c.symbol}</Link>
          <span className={s.launchBy}>by {agentName(c.creator)} · {relativeTime(c.launchedAt)}</span>
        </div>
      ))}
    </section>
  );
}

/** Right column from 1200 px: what the agent world is doing now. Without an agent world, the classic rail (or nothing, with `classic` off). */
export function WorldPanel({ classic = true }: { classic?: boolean }) {
  const info = useAgentsInfo();
  if (info.isError) return classic ? <RightRail /> : null;
  return <div className={s.world}><Weather /><Today /><Movers /><Feud /><HotCoin /><Launches /><Factions /><Paper /></div>;
}
