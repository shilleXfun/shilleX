import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import { relativeTime, type OwnerRules, type SolView } from '@shillex/shared';
import { errorMessage, get, put } from '../../lib/api';
import { cx } from '../../lib/cx';
import { WithdrawForm } from './WithdrawForm';
import { TradingSettings } from './TradingSettings';
import { Button } from '../../components/ui/Button';
import { FlatSection as Section } from './FlatSection';
import s from './agents.module.css';
import r from './realsol.module.css';

/**
 * An agent's real SOL (2026-10-27): its own mainnet wallet, what it holds at live prices, every movement with its transaction,
 * and its owner's rules. Its owner also sees the rules form and the withdraw form.
 */
export interface SolAnswer { sol: SolView | null; on: boolean; stopped: string | null }
export const useSol = (username: string) => useQuery({ queryKey: ['sol', username], queryFn: ({ signal }) => get<SolAnswer>(`/agents/${encodeURIComponent(username)}/sol`, signal), refetchInterval: 30_000 });

const solscan = (path: string) => `https://solscan.io/${path}`;
const fmt = (x: number) => x.toFixed(Math.abs(x) >= 0.1 ? 3 : 4);
const WORD: Record<string, string> = { buy: 'Bought', sell: 'Sold', deposit: 'Owner sent', withdraw: 'Owner withdrew', escrow_in: 'Paid into escrow', escrow_out: 'From escrow', launch: 'Launched' };
const BY: Record<string, string> = { stop_loss: ' (owner’s stop loss)', take_profit: ' (owner’s take profit)' };
const OUT = new Set(['buy', 'withdraw', 'escrow_in', 'launch']);

/** The owner's rules in plain words. */
export function rulesWords(x: OwnerRules | null): string[] {
  if (!x || !Object.keys(x).length) return [];
  const w: string[] = [];
  if (x.tradingOn === false) w.push('Trading switched off');
  if (x.maxSolPerTrade !== undefined) w.push(`At most ${x.maxSolPerTrade} SOL a trade`);
  if (x.maxTradesPerDay !== undefined) w.push(`At most ${x.maxTradesPerDay} trades a day`);
  if (x.stopLossPct !== undefined) w.push(`Stop loss at −${Math.round(x.stopLossPct * 100)}%`);
  if (x.takeProfit?.length) w.push(`Take profit: ${x.takeProfit.map((t) => `${Math.round(t.sellPct * 100)}% at ${t.x}x`).join(', ')}`);
  if (x.maxLossPerDaySol !== undefined) w.push(`Pause after losing ${x.maxLossPerDaySol} SOL in a day`);
  if (x.maxLossTotalSol !== undefined) w.push(`Pause after losing ${x.maxLossTotalSol} SOL in total`);
  if (x.pumpOnly) w.push('pump.fun coins only');
  if (x.minMcapUsd !== undefined) w.push(`Market cap at least $${x.minMcapUsd.toLocaleString('en')}`);
  if (x.minHolders !== undefined) w.push(`At least ${x.minHolders} holders`);
  if (x.minLiquidityUsd !== undefined) w.push(`Liquidity at least $${x.minLiquidityUsd.toLocaleString('en')}`);
  if (x.blacklist?.length) w.push(`Never: ${x.blacklist.join(', ')}`);
  if (x.canBuyServices === false) w.push('May not buy services');
  if (x.canSellServices === false) w.push('May not sell services');
  if (x.maxServiceSpendPerDaySol !== undefined) w.push(`At most ${x.maxServiceSpendPerDaySol} SOL a day on services`);
  return w;
}

export function RealSolCard({ username, external = false }: { username: string; /** An outside agent: launching is off until its owner turns it on. */ external?: boolean }) {
  const q = useSol(username);
  const w = q.data?.sol;
  const [copied, setCopied] = useState(false);
  if (!w) return null;
  const status = q.data?.stopped ? 'stopped' : w.paused ? 'paused' : q.data?.on ? 'live' : 'off';
  const words = rulesWords(w.rules);
  return (
    <>
      <Section id="agent-sol" title="Wallet" note={<span className={r.note}><span className={r.dot} data-s={status} aria-hidden="true" />{fmt(w.sol)} SOL</span>}>
        <div className={r.fund}>
          <span className={r.fundLabel}>{w.mine ? 'Deposit address' : 'Its wallet (anyone can send SOL to it)'}</span>
          <span className={r.addr}>
            <a href={solscan(`account/${w.address}`)} target="_blank" rel="noreferrer" title={w.address}>{w.address}</a>
            <button type="button" className={r.icon} aria-label="Copy the address" onClick={() => { void navigator.clipboard?.writeText(w.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
              <Copy size={14} aria-hidden="true" />
            </button>
            {copied && <span className={r.copied} role="status">Copied</span>}
          </span>
        </div>
        {status !== 'live' && (
          <p className={r.state}>{q.data?.stopped ? 'Trading is paused for every agent right now.' : w.paused ? `Paused: ${w.paused.reason}${w.paused.until ? ` (until ${new Date(w.paused.until).toUTCString().slice(17, 22)} UTC)` : ''}.` : 'Trading is not on yet.'}</p>
        )}
        {w.positions.length > 0 && (
          <ul className={cx(s.rows, r.positions)}>
            {w.positions.map((p) => (
              <li key={p.mint} className={r.pos} title={p.why ?? undefined}>
                <a href={solscan(`token/${p.mint}`)} target="_blank" rel="noreferrer" className={r.sym}>${p.symbol}</a>
                <span className={r.muted}>{fmt(p.solIn)} SOL in</span>
                <span className={cx(r.num, p.pnlPct === null ? undefined : p.pnlPct >= 0 ? s.up : s.down)}>{p.pnlPct === null ? '—' : `${p.pnlPct >= 0 ? '+' : '−'}${Math.abs(p.pnlPct * 100).toFixed(1)}%`}</span>
              </li>
            ))}
          </ul>
        )}
        {w.trades.length > 0 ? (
          <ul className={cx(s.rows, r.ledger)}>
            {w.trades.slice(0, 10).map((t, i) => (
              <li key={`${t.at}-${i}`} className={r.row}>
                <span className={r.what} title={t.error ?? undefined}>
                  {WORD[t.kind] ?? t.kind}{t.symbol ? ` $${t.symbol}` : ''}{BY[t.by] ?? ''}{!t.ok && <span className={s.down}> · failed</span>}
                  {t.sig && <a href={solscan(`tx/${t.sig}`)} target="_blank" rel="noreferrer" className={r.tx} aria-label="The transaction on Solscan"><ExternalLink size={12} aria-hidden="true" /></a>}
                </span>
                <span className={cx(r.num, t.ok ? (OUT.has(t.kind) ? s.down : s.up) : undefined)}>{t.ok ? `${OUT.has(t.kind) ? '−' : '+'}${fmt(t.sol)}` : '—'}</span>
                <span className={r.time}>{relativeTime(t.at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className={s.empty}>{w.sol > 0 ? 'No trades yet.' : 'Not funded yet.'}</p>}
        <div className={r.rules}>
          <span className={r.fundLabel}>Owner’s rules</span>
          {words.length ? <ul className={r.ruleList}>{words.map((x) => <li key={x}>{x}</li>)}</ul> : <p className={r.muted}>None: it decides freely within its balance.</p>}
        </div>
      </Section>
      {w.mine && <OwnerPanel username={username} w={w} external={external} />}
    </>
  );
}

/** The owner's controls: the trading settings (TradingSettings, the same for every owner) and a withdrawal (WithdrawForm). */
function OwnerPanel({ username, w, external }: { username: string; w: SolView; external: boolean }) {
  const qc = useQueryClient();
  return (
    <Section id="agent-owner" title="Trading settings" note="only you see this">
      <TradingSettings username={username} rules={w.rules} external={external} />
      <div style={{ marginTop: 18 }}><WithdrawForm handle={username} sol={w.sol} onDone={() => void qc.invalidateQueries({ queryKey: ['sol', username] })} /></div>
    </Section>
  );
}
