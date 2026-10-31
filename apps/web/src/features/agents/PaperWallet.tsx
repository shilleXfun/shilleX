import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { relativeTime, type PaperWalletView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { cx } from '../../lib/cx';
import p from './paper.module.css';

/**
 * An agent's paper wallet (owner, 2026-10-31: "make the paper money trading actually good"): what it is worth at live prices, its
 * result since it started, each coin it holds with its move, and every fill with its price, fee and result. Its owner can start it
 * over with any amount.
 */
const fmt = (x: number) => x.toFixed(Math.abs(x) >= 10 ? 2 : Math.abs(x) >= 0.1 ? 3 : 4);
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x))}`;
const usd = (x: number) => (x >= 1 ? `$${x.toFixed(2)}` : `$${x.toPrecision(3)}`);
const WORD: Record<string, string> = { buy: 'Bought', sell: 'Sold', reset: 'Started over with' };
const BY: Record<string, string> = { stop_loss: ' · stop loss', take_profit: ' · take profit' };

export function PaperWallet({ username, paper, mode, mine }: { username: string; paper: PaperWalletView | null; mode: 'real' | 'paper'; mine: boolean }) {
  if (!paper) return mode === 'paper' ? <p className={p.empty}>The paper wallet opens with its first trade: 5 paper SOL to start.</p> : null;
  const pnl = paper.worthSol - paper.startSol, pct = paper.startSol > 0 ? pnl / paper.startSol : 0;
  const closed = paper.trades.filter((t) => t.kind === 'sell' && t.ok);
  const won = closed.filter((t) => (t.pnlSol ?? 0) > 0).length;
  const fees = paper.trades.reduce((n, t) => n + (t.ok ? t.feeSol : 0), 0);
  return (
    <div className={p.wrap}>
      <dl className={p.stats}>
        <div><dt>Worth now</dt><dd>{fmt(paper.worthSol)} <small>SOL</small></dd></div>
        <div><dt>Since start</dt><dd className={pnl >= 0 ? p.up : p.down}>{signed(pnl)} <small>{(pct * 100).toFixed(1)}%</small></dd></div>
        <div><dt>Free to trade</dt><dd>{fmt(paper.sol)} <small>SOL</small></dd></div>
        <div><dt>Won</dt><dd>{closed.length ? `${won} of ${closed.length}` : '—'}</dd></div>
      </dl>
      {paper.positions.length > 0 && (
        <table className={p.table}>
          <thead><tr><th>Coin</th><th>In</th><th>Bought at</th><th>Now</th><th>Move</th></tr></thead>
          <tbody>{paper.positions.map((x) => (
            <tr key={x.mint} title={x.why ?? undefined}>
              <td><Link to={`/real/${x.mint}`}>${x.symbol}</Link></td>
              <td>{fmt(x.solIn)} SOL</td>
              <td>{usd(x.entryPriceUsd)}</td>
              <td>{x.priceUsd ? usd(x.priceUsd) : '—'}</td>
              <td className={x.pnlPct === null ? undefined : x.pnlPct >= 0 ? p.up : p.down}>{x.pnlPct === null ? '—' : `${x.pnlPct >= 0 ? '+' : '−'}${Math.abs(x.pnlPct * 100).toFixed(1)}%`}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {paper.trades.length > 0 ? (
        <ul className={p.ledger}>
          {paper.trades.slice(0, 12).map((t, i) => (
            <li key={`${t.at}-${i}`}>
              <span className={p.what}>{WORD[t.kind] ?? t.kind}{t.kind === 'reset' ? ` ${fmt(t.sol)} SOL` : t.symbol ? ` $${t.symbol}` : ''}<span className={p.muted}>{BY[t.by] ?? ''}{t.priceUsd ? ` · at ${usd(t.priceUsd)}` : ''}{t.feeSol ? ` · fee ${fmt(t.feeSol)}` : ''}</span></span>
              <span className={cx(p.num, t.kind === 'sell' ? ((t.pnlSol ?? 0) >= 0 ? p.up : p.down) : undefined)}>{t.kind === 'buy' ? `−${fmt(t.sol)}` : t.kind === 'sell' ? `+${fmt(t.sol)}${t.pnlSol !== null ? ` (${signed(t.pnlSol)})` : ''}` : ''}</span>
              <span className={p.time}>{relativeTime(t.at)}</span>
            </li>
          ))}
        </ul>
      ) : <p className={p.empty}>No paper trades yet.</p>}
      <p className={p.note}>Live prices, with each trade’s swap fee, price impact and network fee taken off, like a real trade. {fees > 0 ? `Fees paid so far: ${fmt(fees)} SOL.` : ''}</p>
      {mine && <Reset username={username} start={paper.startSol} />}
    </div>
  );
}

function Reset({ username, start }: { username: string; start: number }) {
  const qc = useQueryClient();
  const [sol, setSol] = useState(String(start));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      await post(`/agents/${encodeURIComponent(username)}/paper/reset`, { sol: Number(sol) });
      setMsg({ ok: true, text: `Started over with ${sol} paper SOL.` });
      await qc.invalidateQueries({ queryKey: ['sol', username] });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <div className={p.reset}>
      <label><span>Start over with</span><input type="text" inputMode="decimal" value={sol} onChange={(e) => setSol(e.target.value)} aria-label="Paper SOL to start with" /><span>paper SOL</span></label>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void go()}>Start over</Button>
      {msg && <span className={msg.ok ? p.ok : p.err} role="status">{msg.text}</span>}
    </div>
  );
}
