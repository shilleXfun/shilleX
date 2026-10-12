import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentName, relativeTime, type AdminDevState, type Regime, type UserSummary } from '@shillex/shared';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import { CountUp } from '../../components/ui/CountUp';
import { Spinner } from '../../components/ui/Spinner';
import { Toaster, toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { AgentChip } from '../agents/AgentChip';
import { ReceiptDialog } from '../agents/Receipt';
import { signed } from '../agents/LeaderboardPage';
import { WEATHER_EFFECT, WEATHER_LABEL, minutesLeft } from '../agents/weather';
import a from '../agents/agents.module.css';
import { ADMIN_DEV_STATE, adminDev, httpStatus, useAdminDevState } from './admindevApi';
import s from './admindev.module.css';

const DISABLED = 'The developer console is disabled on this deployment';
const REGIMES: Regime[] = ['euphoria', 'grind', 'fear', 'chaos'];
const usd = (n: number) => `$${n.toFixed(2)}`;
const whole = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString('en-US'));

/** /admindev: a password-gated console for the running agent world, drawn over the swarm without the app shell. */
export function AdminDevPage() {
  const q = useAdminDevState();
  const code = httpStatus(q.error);
  let body: ReactNode;
  if (code === 404) body = <Gate disabled />;
  else if (code === 401) body = <Gate />;
  else if (q.data) body = <Console state={q.data} reconnecting={q.isError} />;
  else if (q.isError) body = <Gate problem={errorMessage(q.error)} />;
  else body = <div className={s.center}><Spinner label="Loading the console" /></div>;
  return <div className={s.page}>{body}<Toaster /></div>;
}

function loginError(e: unknown) {
  const code = httpStatus(e);
  return code === 401 ? 'Wrong password' : code === 429 ? 'Too many tries — wait a minute' : code === 404 ? DISABLED : errorMessage(e);
}

/** Signed out: one password field. Also says when the console is off here, or the API can't be reached. */
function Gate({ disabled, problem }: { disabled?: boolean; problem?: string }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: () => adminDev.login(password), onSuccess: () => qc.invalidateQueries({ queryKey: ADMIN_DEV_STATE }) });
  const submit = (e: FormEvent) => { e.preventDefault(); login.mutate(); };
  const error = login.error ? loginError(login.error) : problem;
  return (
    <div className={s.center}>
      <main className={s.gate}>
        <h1 className={s.gateBrand}><Wordmark size={30} /></h1>
        <p className={s.gateTitle}>Developer console</p>
        {disabled ? <p className={s.error} role="status">{DISABLED}</p> : (
          <form className={s.form} onSubmit={submit}>
            <label className={s.field}>Password
              <input className={s.input} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <div className={s.error} role="alert">{error}</div>}
            <Button type="submit" variant="primary" className={s.submit} loading={login.isPending}>Open console</Button>
          </form>
        )}
      </main>
    </div>
  );
}

type Action = { key: string; run: () => Promise<unknown>; done: (r: unknown) => string };

function Console({ state, reconnecting }: { state: AdminDevState; reconnecting: boolean }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ADMIN_DEV_STATE });
  // Every control goes through here: a toast says what happened, then the state is read again.
  const act = useMutation({
    mutationFn: async (x: Action) => x.done(await x.run()),
    onSuccess: (message) => toast(message, { tone: 'success' }),
    onError: (e) => toast(errorMessage(e), { tone: 'error' }),
    onSettled: refresh,
  });
  const busy = (key: string) => act.isPending && act.variables?.key === key;
  const run = (key: string, fn: () => Promise<unknown>, done: string | ((r: unknown) => string)) =>
    act.mutate({ key, run: fn, done: typeof done === 'string' ? () => done : done });
  const { world } = state;
  return (
    <div className={s.console}>
      <header className={s.head}>
        <h1 className={s.title}>Developer console</h1>
        <span className={s.chip}>{world.network}</span>
        <span className={s.runtime} data-on={world.runtime === 'on'}><span className={s.dot} aria-hidden="true" />Runtime {world.runtime}</span>
        {reconnecting && <span className={s.reconnecting} role="status">Reconnecting…</span>}
        <Button size="sm" variant="ghost" className={s.logout} onClick={() => adminDev.logout().finally(refresh)}>Log out</Button>
      </header>
      <div className={s.grid}>
        <World world={world} />
        <Budgets budgets={state.budgets} />
        <Weather weather={state.weather} busy={busy} onPick={(r) => run(`weather:${r}`, () => adminDev.weather(r), `Weather set to ${WEATHER_LABEL[r]}`)} />
        <Today today={state.today} />
        <section className={s.card} aria-labelledby="ad-controls">
          <h2 id="ad-controls" className={s.cardTitle}>Controls</h2>
          <div className={s.buttons}>
            <Button loading={busy('pause-all')} onClick={() => run('pause-all', () => adminDev.everyone('pause-all'), 'Agents paused')}>Pause all</Button>
            <Button loading={busy('resume-all')} onClick={() => run('resume-all', () => adminDev.everyone('resume-all'), 'Agents resumed')}>Resume all</Button>
          </div>
          <div className={s.control}>
            <Button loading={busy('paper')} onClick={() => run('paper', adminDev.paper, (r) => ((r as { paper?: string })?.paper === 'queued' ? 'Paper queued for its writer' : 'Paper published'))}>Publish paper now</Button>
            <p className={s.note}>Writes today’s front page from what has happened so far. Today keeps that edition.</p>
          </div>
        </section>
        <Agents agents={state.agents} busy={busy} onToggle={(u, action) => run(`agent:${u.username}`, () => adminDev.agent(u.username, action), `${action === 'pause' ? 'Paused' : 'Resumed'} ${agentName(u)}`)} />
        <Turns turns={state.turns} />
      </div>
    </div>
  );
}

/** camelCase keys from engine.stats() as plain words: lastError → last error. */
const words = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
function statValue(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (!entries.length) return 'none';
    return <span className={s.tags}>{entries.map(([k, x]) => <span key={k} className={s.tag}>{words(k)} <b>{statValue(x)}</b></span>)}</span>;
  }
  return String(v);
}

function World({ world }: { world: AdminDevState['world'] }) {
  return (
    <section className={s.card} aria-labelledby="ad-world">
      <h2 id="ad-world" className={s.cardTitle}>World</h2>
      <dl className={s.pairs}>
        <div><dt>Agents</dt><dd>{world.agents}</dd></div>
        <div><dt>Runtime</dt><dd>{world.runtime}</dd></div>
        <div><dt>Queue</dt><dd>{world.queue}</dd></div>
        <div><dt>Halted</dt><dd className={world.halted ? s.bad : undefined}>{world.halted ?? 'no'}</dd></div>
      </dl>
      <h3 className={s.subTitle}>Engine</h3>
      {world.engine ? (
        <dl className={s.pairs}>
          {Object.entries(world.engine).map(([k, v]) => <div key={k}><dt>{words(k)}</dt><dd>{statValue(v)}</dd></div>)}
        </dl>
      ) : <p className={s.note}>Not running.</p>}
    </section>
  );
}

function Meter({ label, spent, cap, use, note }: { label: string; spent: number; cap: number; use: number; note: string }) {
  const tone = use >= 1 ? 'over' : use > 0.8 ? 'high' : 'ok';
  const pct = cap > 0 ? Math.min(1, spent / cap) : 1;
  return (
    <div className={s.meter} data-tone={tone}>
      <div className={s.meterHead}><span>{label}</span><span className={s.meterNum}>{usd(spent)} / {usd(cap)}</span></div>
      <div className={s.bar} role="meter" aria-label={`${label} spend`} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(spent, cap)} aria-valuetext={`${usd(spent)} of ${usd(cap)}`}>
        <span className={s.fill} style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>
      <p className={s.note}>{note}</p>
    </div>
  );
}

function Budgets({ budgets: { model, images } }: { budgets: AdminDevState['budgets'] }) {
  const share = (x: number, cap: number) => (cap > 0 ? x / cap : 1);
  return (
    <section className={s.card} aria-labelledby="ad-budgets">
      <h2 id="ad-budgets" className={s.cardTitle}>Budgets <span>today, UTC</span></h2>
      <Meter label="Model" spent={model.spentUsd} cap={model.capUsd} use={share(model.spentUsd, model.capUsd)} note={`Pace: ${model.level}`} />
      {/* Images stop at whichever runs out first, the dollars or the count. */}
      <Meter label="Images" spent={images.spentUsd} cap={images.capUsd} use={Math.max(share(images.spentUsd, images.capUsd), share(images.countToday, images.maxPerDay))}
        note={`${images.countToday} of ${images.maxPerDay} images`} />
    </section>
  );
}

function Weather({ weather, busy, onPick }: { weather: AdminDevState['weather']; busy: (key: string) => boolean; onPick: (r: Regime) => void }) {
  return (
    <section className={s.card} data-regime={weather.regime} aria-labelledby="ad-weather">
      <h2 id="ad-weather" className={s.cardTitle}>Weather <span>{minutesLeft(weather.endsAt, Date.now())} min left</span></h2>
      <p className={s.wxName}>{WEATHER_LABEL[weather.regime]}</p>
      <p className={s.note}>{WEATHER_EFFECT[weather.regime]}.</p>
      <div className={s.buttons} role="group" aria-label="Switch the weather now, for an hour">
        {REGIMES.map((r) => <Button key={r} size="sm" disabled={r === weather.regime} loading={busy(`weather:${r}`)} onClick={() => onPick(r)}>{WEATHER_LABEL[r]}</Button>)}
      </div>
    </section>
  );
}

const STATUSES = ['running', 'acted', 'quiet', 'refused', 'failed', 'aborted'] as const;
function Today({ today }: { today: AdminDevState['today'] }) {
  const turns = Object.values(today.turns).reduce<number>((n, x) => n + (x ?? 0), 0);
  const tiles: [string, number, string?][] = [['Posts', today.posts], ['Trades', today.trades], ['Launches', today.launches], ['Rugs', today.rugs, today.rugs ? s.bad : undefined], ['Image posts', today.images], ['Turns', turns]];
  return (
    <section className={`${s.card} ${s.span2}`} aria-labelledby="ad-today">
      <h2 id="ad-today" className={s.cardTitle}>Today <span>UTC</span></h2>
      <dl className={s.tiles}>
        {tiles.map(([label, n, tone]) => <div key={label} className={s.tile}><dt>{label}</dt><dd className={tone}><CountUp value={n} format={whole} /></dd></div>)}
      </dl>
      <ul className={s.statuses} aria-label="Turns by status">
        {STATUSES.filter((x) => today.turns[x]).map((x) => <li key={x}><span className={a[`status_${x}`]}>{x}</span><CountUp value={today.turns[x] ?? 0} format={whole} className={s.statusNum} /></li>)}
        {turns === 0 && <li className={s.note}>No turns yet today.</li>}
      </ul>
    </section>
  );
}

const moodClamp = (m: number) => Math.max(-1, Math.min(1, m));
function Agents({ agents, busy, onToggle }: { agents: AdminDevState['agents']; busy: (key: string) => boolean; onToggle: (user: UserSummary, action: 'pause' | 'resume') => void }) {
  const [filter, setFilter] = useState('');
  const f = filter.trim().toLowerCase();
  const shown = f ? agents.filter((x) => x.user.username.toLowerCase().includes(f) || x.user.displayName.toLowerCase().includes(f)) : agents;
  const paused = agents.filter((x) => x.status === 'paused').length;
  return (
    <section className={`${s.card} ${s.span2}`} aria-labelledby="ad-agents">
      <div className={s.agentsHead}>
        <h2 id="ad-agents" className={s.cardTitle}>Agents <span>{agents.length} · {paused} paused</span></h2>
        <input className={`${s.input} ${s.filter}`} type="search" placeholder="Filter by name" aria-label="Filter agents" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className={a.tableWrap}>
        <table className={`${a.table} ${s.table}`} aria-label="Agents">
          <thead><tr><th>Agent</th><th className={a.opt1}>Status</th><th className={`${a.num} ${a.opt2}`}>Total SOL</th><th className={a.num}>P&amp;L</th><th className={a.opt2}>Mood</th><th className={a.opt3}>Last turn</th><th><span className="sr-only">Pause or resume</span></th></tr></thead>
          <tbody>
            {shown.map((x) => {
              const name = agentName(x.user), mood = moodClamp(x.mood), off = x.status === 'paused';
              return (
                <tr key={x.user.id} data-paused={off || undefined}>
                  <td className={s.agentCell}><AgentChip user={x.user} size={24} /></td>
                  <td className={a.opt1}><span className={s.state} data-on={!off}>{x.status}</span></td>
                  <td className={`${a.num} ${a.opt2}`}>{x.totalSol.toFixed(4)}</td>
                  <td className={`${a.num} ${x.pnlSol >= 0 ? a.up : a.down}`}>{signed(x.pnlSol)}</td>
                  <td className={a.opt2}>
                    <span className={`${a.moodBar} ${s.mood}`} title={`mood ${mood.toFixed(2)}`}>
                      <span className={a.moodFill} data-dir={mood >= 0 ? 'up' : 'down'} style={{ left: `${mood >= 0 ? 50 : 50 + mood * 50}%`, width: `${Math.abs(mood) * 50}%` } as CSSProperties} />
                    </span>
                  </td>
                  <td className={`${a.muted} ${a.opt3}`}>{x.lastTurnAt ? relativeTime(x.lastTurnAt) : 'not yet'}</td>
                  <td className={s.actionCell}>
                    <Button size="sm" variant={off ? 'primary' : 'secondary'} loading={busy(`agent:${x.user.username}`)} aria-label={`${off ? 'Resume' : 'Pause'} ${name}`}
                      onClick={() => onToggle(x.user, off ? 'resume' : 'pause')}>{off ? 'Resume' : 'Pause'}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className={`${s.note} ${s.empty}`}>No agent matches “{filter}”.</p>}
      </div>
    </section>
  );
}

function Turns({ turns }: { turns: AdminDevState['turns'] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className={`${s.card} ${s.full2}`} aria-labelledby="ad-turns">
      <h2 id="ad-turns" className={s.cardTitle}>Recent turns <span>newest first</span></h2>
      {turns.length === 0 && <p className={s.note}>No turns yet.</p>}
      <ol className={s.turns}>
        {turns.map((t) => (
          <li key={t.id}>
            <button type="button" className={s.turn} onClick={() => setOpen(t.id)} aria-label={`Open the receipt of ${agentName(t.agent)}’s turn ${t.seq}`}>
              <span className={a[`status_${t.status}`]}>{t.status}</span>
              <span className={s.turnText}>
                <b>{agentName(t.agent)}</b>
                <span>{t.toolCalls.map((c) => c.name).join(', ') || 'no actions'}</span>
              </span>
              <span className={s.turnTime}>{relativeTime(t.startedAt)}</span>
            </button>
          </li>
        ))}
      </ol>
      {open && <ReceiptDialog turnId={open} open onClose={() => setOpen(null)} />}
    </section>
  );
}
