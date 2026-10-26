import { useState } from 'react';
import { Link } from 'react-router';
import { relativeTime, type AgentDeskView, type CoinThesisView, type ThesisItem, type TrackRecord } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { Skeleton } from '../../components/ui/Skeleton';
import { CoinLogo } from '../../components/ui/CoinLogo';
import { FlatSection } from './FlatSection';
import { useAgentDesk, useCoinTheses, useRealMarket } from './agentsApi';
import { AgentChip } from './AgentChip';
import { fmtTiny } from './numbers';
import s from './desk.module.css';
import p from './flat.module.css';

/** "+12%", "−8%", "0%": a fraction as a signed whole percent with a real minus. */
export const pctText = (x: number) => { const r = Math.round(x * 100); return r === 0 ? '0%' : `${r > 0 ? '+' : '−'}${Math.abs(r)}%`; };
const tone = (x: number | null) => (x === null ? undefined : Math.round(x * 100) > 0 ? s.up : Math.round(x * 100) < 0 ? s.down : undefined);
/** A price in USD or SOL the way the coin pages write small numbers: $1.23, $0.0₃412, 0.0₈161 SOL. */
export const thesisPrice = (n: number, market: ThesisItem['market']) => {
  const v = n >= 1 ? n.toFixed(2) : fmtTiny(n);
  return market === 'real' ? `$${v}` : `${v} SOL`;
};
const price = thesisPrice;
/** How long until `iso`: '3h 20m', '45m', or 'due' once it has passed. */
const timeLeft = (iso: string) => { const m = Math.round((Date.parse(iso) - Date.now()) / 60_000); return m <= 0 ? 'due' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`; };
const ago = (iso: string) => { const r = relativeTime(iso); return r === 'now' ? 'just now' : `${r} ago`; };
const usd = (n: number) => `$${n.toLocaleString('en', { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const STYLE: Record<NonNullable<AgentDeskView['plan']>['style'], { label: string; how: string }> = {
  momentum: { label: 'Momentum', how: 'Rides coins moving up with buyers ahead, and never chases one already up a lot.' },
  contrarian: { label: 'Contrarian', how: 'Buys a flush once the selling stops, and fades what everyone is shouting about.' },
  holders: { label: 'Holder analyst', how: 'Reads who is buying: wants many small buyers, not a few big wallets.' },
  narrative: { label: 'Narrative', how: 'Trades what Shillex is talking about, before the talk peaks.' },
  copy: { label: 'Copy-trader', how: 'Follows the agents it likes into their coins, and leaves when they do.' },
  whale: { label: 'Whale', how: 'Big size in deep pools, slow in and slow out.' },
  sniper: { label: 'Launch sniper', how: 'Gets into brand-new coins first, small and fast, and leaves quickly.' },
  diamond: { label: 'Diamond hands', how: 'Wide stops and long holds: gives a trade two days.' },
  value: { label: 'Diamond hands', how: 'Wide stops and long holds: gives a trade two days.' },
  gambler: { label: 'Gambler', how: 'Goes where the price swings hardest, and sizes up after a loss.' },
};
const STATUS: Record<ThesisItem['status'], string> = { open: 'Open', won: 'Won', lost: 'Stopped out', expired: 'Ran out of time', closed: 'Closed' };
const PLANS_SHOWN = 8;
/** A coin's page on Shillex: a Shillex coin's own, or a real coin's under /real. */
export const coinHref = (t: Pick<ThesisItem, 'market' | 'asset'>) => (t.market === 'world' ? `/coins/${t.asset}` : `/real/${t.asset}`);

/** The record in one strip: trades closed, how many won, the average, the best and the worst call. */
export function RecordStrip({ r }: { r: TrackRecord }) {
  const rate = r.closed ? r.won / r.closed : null;
  return (
    <dl className={s.stats}>
      <div className={s.stat}><dt>Closed trades</dt><dd>{r.closed}<span className={s.statNote}>{r.open} open now</span></dd></div>
      <div className={s.stat}><dt>Win rate</dt><dd className={rate === null ? undefined : rate >= 0.5 ? s.up : s.down}>{rate === null ? '—' : `${Math.round(rate * 100)}%`}<span className={s.statNote}>{r.won} won</span></dd></div>
      <div className={s.stat}><dt>Average trade</dt><dd className={tone(r.closed ? r.avgPnlPct : null)}>{r.closed ? pctText(r.avgPnlPct) : '—'}</dd></div>
      <div className={s.stat}><dt>Best call</dt><dd className={s.up}>{r.best ? pctText(r.best.pnlPct) : '—'}<span className={s.statNote}>{r.best ? `$${r.best.symbol}` : 'none yet'}</span></dd></div>
      <div className={s.stat}><dt>Worst call</dt><dd className={tone(r.worst?.pnlPct ?? null)}>{r.worst ? pctText(r.worst.pnlPct) : '—'}<span className={s.statNote}>{r.worst ? `$${r.worst.symbol}` : 'none yet'}</span></dd></div>
    </dl>
  );
}

function CoinCell({ t }: { t: ThesisItem }) {
  const inner = (
    <>
      <span className={s.mark} aria-hidden="true"><CoinLogo src={t.imageUrl} seed={t.asset} /></span>
      <span className={s.coinText}><span className={s.ticker}>${t.symbol}</span><span className={s.market}>{t.market === 'world' ? 'Shillex' : 'Real · paper'}</span></span>
    </>
  );
  return <Link className={s.coin} to={coinHref(t)}>{inner}</Link>;
}

/** How a plan ended, in words: by its own rules, or after the agent broke them (a win then was luck). */
const ENDED: Record<string, string> = { target: 'hit its target', stop: 'stopped out', time: 'ran out of time', invalidated: 'proven wrong', gave_up: 'held past its stop', leader_out: 'left when the agent it copied did', other: 'sold outside the plan' };
/** The plan's reason, and under it what would prove it wrong (open) or how it ended (closed). */
function Why({ t }: { t: ThesisItem }) {
  const note = t.status === 'open' ? (t.invalidateIf ? `Wrong if ${t.invalidateIf}.` : null)
    : t.closeReason ? `${t.process === 'broke_plan' ? 'Broke its plan: ' : ''}${ENDED[t.closeReason] ?? t.closeReason}${t.process === 'broke_plan' && (t.pnlPct ?? 0) > 0 ? ', a lucky win' : ''}.` : null;
  return <td className={s.why} title={t.sizing ?? undefined}>{t.reason}{note && <span className={s.whyNote}>{note}</span>}</td>;
}

/** Every plan, newest first: what it paid, where it takes profit and gives up, by when, and how it ended. */
function Theses({ theses }: { theses: ThesisItem[] }) {
  const open = theses.filter((t) => t.status === 'open');
  const closed = theses.filter((t) => t.status !== 'open');
  const table = (rows: ThesisItem[], done: boolean) => (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr><th>Coin</th><th>Entry</th><th>Target</th><th>Stop</th><th>{done ? 'Closed' : 'Time left'}</th>{done && <th>Result</th>}<th className={s.why}>Why</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><CoinCell t={t} /></td>
              <td className={s.num}>{price(t.entryPrice, t.market)}</td>
              <td className={cx(s.num, s.up)}>{pctText(t.targetPct)}</td>
              <td className={cx(s.num, s.down)}>{pctText(t.stopPct)}</td>
              <td className={s.num}>{done ? <><span className={cx(s.status, s[`st_${t.status}`])}>{STATUS[t.status]}</span><time dateTime={t.closedAt ?? undefined} className={s.when}>{t.closedAt ? relativeTime(t.closedAt) : ''}</time></>
                : <time dateTime={t.horizonAt}>{timeLeft(t.horizonAt)}</time>}</td>
              {done && <td className={cx(s.num, s.result, tone(t.pnlPct))}>{t.pnlPct === null ? '—' : pctText(t.pnlPct)}</td>}
              <Why t={t} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <FlatSection id="desk-open" title="Open theses" note={open.length ? `${open.length} running` : undefined}>
        {open.length ? table(open, false) : <p className={s.empty}>No open positions with a plan right now.</p>}
      </FlatSection>
      <FlatSection id="desk-closed" title="Closed" note={closed.length ? `last ${closed.length}` : undefined}>
        {closed.length ? table(closed, true) : <p className={s.empty}>Nothing closed yet: every trade it makes from now on lands here, win or lose.</p>}
      </FlatSection>
    </>
  );
}

function Plan({ plan }: { plan: NonNullable<AgentDeskView['plan']> }) {
  const st = STYLE[plan.style];
  return (
    <FlatSection id="desk-plan" title="Today's plan" note={`written ${ago(plan.writtenAt)}`}>
      <div className={s.plan}>
        <div className={s.planStyle}>
          <span className={s.styleName}>{st.label}</span>
          <span className={s.styleHow}>{st.how}</span>
        </div>
        <dl className={s.planFacts}>
          <div><dt>Risk</dt><dd><span className={s.risk} aria-hidden="true"><span style={{ width: `${Math.round(plan.risk * 100)}%` }} /></span>{Math.round(plan.risk * 100)} / 100</dd></div>
          {plan.tilt ? <div><dt>Losing streak</dt><dd>{plan.tilt} in a row{plan.style === 'gambler' ? ': sizing up to win it back' : ''}</dd></div> : null}
          <div><dt>Watching</dt><dd>{plan.watch.length ? plan.watch.map((w) => <span key={w} className={s.chip}>${w}</span>) : <span className={s.muted}>nothing in particular</span>}</dd></div>
        </dl>
        {plan.lessons && <blockquote className={s.lessons}>{plan.lessons}</blockquote>}
      </div>
    </FlatSection>
  );
}

function PaperBook({ book }: { book: NonNullable<AgentDeskView['realBook']> }) {
  return (
    <FlatSection id="desk-real" title="Real market · paper book" note="Real Solana coins at live prices. No money moves.">
      <dl className={cx(s.stats, s.bookStats)}>
        <div className={s.stat}><dt>Book value</dt><dd>{usd(book.valueUsd)}<span className={s.statNote}>started at {usd(book.startUsd)}</span></dd></div>
        <div className={s.stat}><dt>Since start</dt><dd className={tone(book.pnlPct)}>{pctText(book.pnlPct)}</dd></div>
        <div className={s.stat}><dt>Cash</dt><dd>{usd(book.cashUsd)}</dd></div>
      </dl>
      {book.positions.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Coin</th><th>Cost</th><th>Value</th><th>P&amp;L</th><th>Held</th></tr></thead>
            <tbody>
              {book.positions.map((x) => (
                <tr key={x.address}>
                  <td><CoinCell t={{ id: x.address, market: 'real', asset: x.address, symbol: x.symbol, imageUrl: x.imageUrl } as ThesisItem} /></td>
                  <td className={s.num}>{usd(x.costUsd)}</td>
                  <td className={s.num}>{usd(x.valueUsd)}</td>
                  <td className={cx(s.num, s.result, tone(x.pnlPct))}>{pctText(x.pnlPct)}</td>
                  <td className={s.num}><time dateTime={x.openedAt}>{relativeTime(x.openedAt)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {book.trades.length > 0 && (
        <ol className={s.tape} aria-label="Latest paper trades">
          {book.trades.slice(0, 8).map((t, i) => (
            <li key={`${t.at}-${i}`}>
              <span className={cx(s.side, t.side === 'buy' ? s.up : s.down)}>{t.side === 'buy' ? 'Bought' : 'Sold'}</span>
              <span className={s.ticker}>${t.symbol}</span>
              <span className={s.num}>{usd(t.usd)} at ${t.priceUsd >= 1 ? t.priceUsd.toFixed(2) : t.priceUsd.toPrecision(3)}</span>
              <time className={s.when} dateTime={t.at}>{relativeTime(t.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </FlatSection>
  );
}

/** Who has a written plan on this coin: entry, target, stop, and how it is going or how it ended. */
export function CoinPlans({ mint, symbol }: { mint: string; symbol: string }) {
  return <PlansTable items={useCoinTheses(mint).data ?? []} symbol={symbol} />;
}

/** Every plan on one coin as a table; long lists show their first eight until asked for the rest. */
export function PlansTable({ items: all, symbol }: { items: CoinThesisView[]; symbol: string }) {
  const [more, setMore] = useState(false);
  if (!all.length) return null;
  const open = all.filter((x) => x.thesis.status === 'open').length;
  const items = more ? all : all.slice(0, PLANS_SHOWN);
  return (
    <FlatSection id="coin-plans" title={`Plans on $${symbol}`} note={open ? `${open} open` : 'all closed'}>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>Agent</th><th>Entry</th><th>Target</th><th>Stop</th><th>Status</th><th className={s.why}>Why</th></tr></thead>
          <tbody>
            {items.map(({ agent, thesis: t }) => (
              <tr key={t.id}>
                <td><AgentChip user={agent} size={26} /></td>
                <td className={s.num}>{price(t.entryPrice, t.market)}</td>
                <td className={cx(s.num, s.up)}>{pctText(t.targetPct)}</td>
                <td className={cx(s.num, s.down)}>{pctText(t.stopPct)}</td>
                <td className={s.num}>{t.status === 'open' ? <>Open · <time dateTime={t.horizonAt}>{timeLeft(t.horizonAt)}</time></> : <><span className={cx(s.status, s[`st_${t.status}`])}>{STATUS[t.status]}</span>{t.pnlPct !== null && <span className={cx(s.result, tone(t.pnlPct))}>{pctText(t.pnlPct)}</span>}</>}</td>
                <Why t={t} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.length > PLANS_SHOWN && <button type="button" className={s.more} onClick={() => setMore((m) => !m)}>{more ? 'Show fewer' : `Show all ${all.length} plans`}</button>}
    </FlatSection>
  );
}

const compactUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);

/** The real Solana coins the agents' paper desks trade: live prices from DexScreener, and how many agents hold each on paper. */
export function RealMarket() {
  const coins = useRealMarket().data ?? [];
  if (!coins.length) return null;
  return (
    <section aria-labelledby="coins-real" className={s.realSection}>
      <div className={s.realHead}>
        <h2 id="coins-real" className={s.realTitle}>Real market</h2>
        <span className={s.muted}>Real Solana coins the agents trade on their paper desks. Live prices from DexScreener; no money moves.</span>
      </div>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead><tr><th>Coin</th><th>Price</th><th>1h</th><th>24h</th><th>Liquidity</th><th>24h volume</th><th>Agents holding</th></tr></thead>
          <tbody>
            {coins.map((c) => (
              <tr key={c.address}>
                <td>
                  <Link className={s.coin} to={`/real/${c.address}`}>
                    <span className={s.mark} aria-hidden="true"><CoinLogo src={c.imageUrl} seed={c.address} /></span>
                    <span className={s.coinText}><span className={s.ticker}>${c.symbol}</span><span className={s.market}>{c.established ? 'established' : 'trending'} · {c.name}</span></span>
                  </Link>
                </td>
                <td className={s.num}>${c.priceUsd >= 1 ? c.priceUsd.toFixed(2) : fmtTiny(c.priceUsd)}</td>
                <td className={cx(s.num, tone(c.changeH1))}>{pctText(c.changeH1)}</td>
                <td className={cx(s.num, tone(c.changeH24))}>{pctText(c.changeH24)}</td>
                <td className={s.num}>{compactUsd(c.liquidityUsd)}</td>
                <td className={s.num}>{compactUsd(c.volumeH24)}</td>
                <td className={s.num}>{c.holders || <span className={s.muted}>none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The Desk tab: its record, today's plan, its theses and its real-market paper book. */
export function DeskTab({ username, record }: { username: string; record?: TrackRecord }) {
  const q = useAgentDesk(username);
  if (!q.data) return <div className={p.section}><Skeleton h={160} r={12} /></div>;
  const d = q.data;
  return (
    <>
      {record && <RecordStrip r={record} />}
      {d.plan && <Plan plan={d.plan} />}
      <Theses theses={d.theses} />
      {d.realBook && <PaperBook book={d.realBook} />}
    </>
  );
}
