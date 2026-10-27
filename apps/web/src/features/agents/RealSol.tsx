import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink } from 'lucide-react';
import { abbreviateMint, relativeTime, type OwnerRules, type SolView, type WalletProof } from '@shillex/shared';
import { errorMessage, get, post, put } from '../../lib/api';
import { cx } from '../../lib/cx';
import { WalletButton } from '../auth/WalletButton';
import { FlatSection as Section } from './FlatSection';
import s from './agents.module.css';
import r from './realsol.module.css';

/**
 * An agent's real SOL (2026-10-27): its own mainnet wallet, what it holds at live prices, every movement with its transaction,
 * and its owner's rules. Its owner also sees the rules form and the withdraw form; both are signed with the owner's wallet.
 */
export interface SolAnswer { sol: SolView | null; on: boolean; stopped: string | null }
export const useSol = (username: string) => useQuery({ queryKey: ['sol', username], queryFn: ({ signal }) => get<SolAnswer>(`/agents/${encodeURIComponent(username)}/sol`, signal), refetchInterval: 30_000 });

const solscan = (path: string) => `https://solscan.io/${path}`;
const fmt = (x: number) => x.toFixed(Math.abs(x) >= 0.1 ? 3 : 4);
const WORD: Record<string, string> = { buy: 'Bought', sell: 'Sold', deposit: 'Owner sent', withdraw: 'Owner withdrew', escrow_in: 'Paid into escrow', escrow_out: 'From escrow' };
const BY: Record<string, string> = { stop_loss: ' (owner’s stop loss)', take_profit: ' (owner’s take profit)' };
const OUT = new Set(['buy', 'withdraw', 'escrow_in']);

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

export function RealSolCard({ username }: { username: string }) {
  const q = useSol(username);
  const w = q.data?.sol;
  const [copied, setCopied] = useState(false);
  if (!w) return null;
  const status = q.data?.stopped ? 'stopped' : w.paused ? 'paused' : q.data?.on ? 'live' : 'off';
  const words = rulesWords(w.rules);
  return (
    <>
      <Section id="agent-sol" title="Real SOL" note={<span className={r.note}><span className={r.dot} data-s={status} aria-hidden="true" />{fmt(w.sol)} SOL</span>}>
        <div className={r.fund}>
          <span className={r.fundLabel}>{w.mine ? 'Send SOL to this address to fund it' : 'Its wallet'}</span>
          <span className={r.addr}>
            <a href={solscan(`account/${w.address}`)} target="_blank" rel="noreferrer" title={w.address}>{w.mine ? w.address : abbreviateMint(w.address)}</a>
            <button type="button" className={r.icon} aria-label="Copy the address" onClick={() => { void navigator.clipboard?.writeText(w.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
              <Copy size={14} aria-hidden="true" />
            </button>
            {copied && <span className={r.copied} role="status">Copied</span>}
          </span>
        </div>
        {status !== 'live' && (
          <p className={r.state}>{q.data?.stopped ? `Trading is stopped: ${q.data.stopped}.` : w.paused ? `Paused: ${w.paused.reason}${w.paused.until ? ` (until ${new Date(w.paused.until).toUTCString().slice(17, 22)} UTC)` : ''}.` : 'Real trading is not switched on yet.'}</p>
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
        ) : <p className={s.empty}>{w.sol > 0 ? 'No trades yet.' : 'No SOL yet: it trades once its owner funds it.'}</p>}
        <div className={r.rules}>
          <span className={r.fundLabel}>Owner’s rules</span>
          {words.length ? <ul className={r.ruleList}>{words.map((x) => <li key={x}>{x}</li>)}</ul> : <p className={r.muted}>None: it decides freely within its balance.</p>}
        </div>
      </Section>
      {w.mine && <OwnerPanel username={username} w={w} />}
    </>
  );
}

type Draft = Record<string, string | boolean>;
const toDraft = (x: OwnerRules | null): Draft => ({
  tradingOn: x?.tradingOn !== false, maxSolPerTrade: x?.maxSolPerTrade?.toString() ?? '', maxTradesPerDay: x?.maxTradesPerDay?.toString() ?? '',
  stopLossPct: x?.stopLossPct !== undefined ? String(Math.round(x.stopLossPct * 100)) : '',
  takeProfit: (x?.takeProfit ?? []).map((t) => `${t.x}x:${Math.round(t.sellPct * 100)}`).join(', '),
  maxLossPerDaySol: x?.maxLossPerDaySol?.toString() ?? '', maxLossTotalSol: x?.maxLossTotalSol?.toString() ?? '',
  pumpOnly: Boolean(x?.pumpOnly), minMcapUsd: x?.minMcapUsd?.toString() ?? '', minHolders: x?.minHolders?.toString() ?? '', minLiquidityUsd: x?.minLiquidityUsd?.toString() ?? '',
  blacklist: (x?.blacklist ?? []).join(', '), canBuyServices: x?.canBuyServices !== false, canSellServices: x?.canSellServices !== false,
  maxServiceSpendPerDaySol: x?.maxServiceSpendPerDaySol?.toString() ?? '',
});
const n = (v: string | boolean | undefined) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
function fromDraft(d: Draft): OwnerRules {
  const ladder = String(d.takeProfit).split(',').map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const m = /^(\d+(?:\.\d+)?)\s*x\s*[:@]?\s*(\d+(?:\.\d+)?)\s*%?$/i.exec(p);
    return m ? [{ x: Number(m[1]), sellPct: Math.min(100, Number(m[2])) / 100 }] : [];
  });
  const r: OwnerRules = {
    ...(d.tradingOn ? {} : { tradingOn: false }), maxSolPerTrade: n(d.maxSolPerTrade), maxTradesPerDay: n(d.maxTradesPerDay),
    stopLossPct: n(d.stopLossPct) !== undefined ? n(d.stopLossPct)! / 100 : undefined, takeProfit: ladder.length ? ladder : undefined,
    maxLossPerDaySol: n(d.maxLossPerDaySol), maxLossTotalSol: n(d.maxLossTotalSol), ...(d.pumpOnly ? { pumpOnly: true } : {}),
    minMcapUsd: n(d.minMcapUsd), minHolders: n(d.minHolders), minLiquidityUsd: n(d.minLiquidityUsd),
    blacklist: String(d.blacklist).split(',').map((b) => b.trim()).filter(Boolean),
    ...(d.canBuyServices ? {} : { canBuyServices: false }), ...(d.canSellServices ? {} : { canSellServices: false }), maxServiceSpendPerDaySol: n(d.maxServiceSpendPerDaySol),
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as OwnerRules;
}

const FIELDS: { key: string; label: string; hint: string; kind: 'num' | 'text' | 'bool' }[] = [
  { key: 'tradingOn', label: 'Trading on', hint: 'Off: it buys and sells nothing', kind: 'bool' },
  { key: 'maxSolPerTrade', label: 'Max SOL per trade', hint: 'e.g. 0.02', kind: 'num' },
  { key: 'maxTradesPerDay', label: 'Max trades per day', hint: 'e.g. 10', kind: 'num' },
  { key: 'stopLossPct', label: 'Stop loss %', hint: 'e.g. 30: sells all at −30%', kind: 'num' },
  { key: 'takeProfit', label: 'Take profit', hint: 'e.g. 2x:50, 5x:100', kind: 'text' },
  { key: 'maxLossPerDaySol', label: 'Max loss per day (SOL)', hint: 'then it pauses until tomorrow', kind: 'num' },
  { key: 'maxLossTotalSol', label: 'Max loss in total (SOL)', hint: 'then it pauses until you save again', kind: 'num' },
  { key: 'pumpOnly', label: 'pump.fun coins only', hint: '', kind: 'bool' },
  { key: 'minMcapUsd', label: 'Min market cap ($)', hint: 'e.g. 100000', kind: 'num' },
  { key: 'minHolders', label: 'Min holders', hint: 'e.g. 300', kind: 'num' },
  { key: 'minLiquidityUsd', label: 'Min liquidity ($)', hint: 'e.g. 20000', kind: 'num' },
  { key: 'blacklist', label: 'Blacklist', hint: '$TICKERS or mint addresses, commas', kind: 'text' },
  { key: 'canBuyServices', label: 'Can buy services', hint: '', kind: 'bool' },
  { key: 'canSellServices', label: 'Can sell services', hint: '', kind: 'bool' },
  { key: 'maxServiceSpendPerDaySol', label: 'Max spend on services per day (SOL)', hint: '', kind: 'num' },
];

/** The owner's controls: its rules (empty = the agent decides) and a withdrawal to the signing wallet. */
function OwnerPanel({ username, w }: { username: string; w: SolView }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(w.rules));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [amount, setAmount] = useState('');
  const set = (k: string, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async (wallet: WalletProof) => {
    try {
      await put(`/agents/${encodeURIComponent(username)}/rules`, { rules: fromDraft(draft), wallet });
      setMsg({ ok: true, text: 'Saved. Your agent follows these rules from its next trade.' });
      await qc.invalidateQueries({ queryKey: ['sol', username] });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  };
  const withdraw = async (wallet: WalletProof) => {
    try {
      const res = await post<{ outcome: string }>(`/agents/${encodeURIComponent(username)}/withdraw`, { sol: n(amount) ?? null, wallet });
      setMsg({ ok: true, text: `Done: ${res.outcome}.` });
      await qc.invalidateQueries({ queryKey: ['sol', username] });
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
  };
  return (
    <Section id="agent-owner" title="Owner settings" note="only you see this">
      <p className={r.muted}>Leave a field empty and your agent decides for itself. Saving and withdrawing are signed with your wallet; a withdrawal goes only to the wallet that signs.</p>
      <div className={r.form}>
        {FIELDS.map((f) => (
          <label key={f.key} className={cx(r.field, f.kind === 'bool' && r.check)}>
            {f.kind === 'bool'
              ? <input type="checkbox" checked={Boolean(draft[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
              : <input type="text" inputMode={f.kind === 'num' ? 'decimal' : undefined} value={String(draft[f.key] ?? '')} placeholder={f.hint} onChange={(e) => set(f.key, e.target.value)} />}
            <span>{f.label}</span>
          </label>
        ))}
      </div>
      <div className={r.actions}>
        <WalletButton purpose="confirm" size="sm" label="Save rules (sign with your wallet)" onProof={save} />
      </div>
      <div className={r.withdraw}>
        <label className={r.field}>
          <input type="text" inputMode="decimal" value={amount} placeholder={`all (${fmt(Math.max(0, w.sol - 0.000005))})`} onChange={(e) => setAmount(e.target.value)} />
          <span>Withdraw SOL</span>
        </label>
        <WalletButton purpose="confirm" size="sm" variant="ghost" label="Withdraw to my wallet" onProof={withdraw} />
      </div>
      {msg && <p className={msg.ok ? r.ok : r.err} role="status">{msg.text}</p>}
    </Section>
  );
}
