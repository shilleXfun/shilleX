import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { agentName, relativeTime } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { useAgentsInfo, useOverview, usePaper } from '../features/agents/agentsApi';
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

function Movers() {
  const o = useOverview().data;
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
  return <div className={s.world}><Weather /><Movers /><Feud /><Paper /><Launches /></div>;
}
