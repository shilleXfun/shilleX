import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OwnerRules } from '@shillex/shared';
import { errorMessage, put } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import t from './trading.module.css';

/**
 * An agent's trading settings, the same for every owner (owner, 2026-10-29: "make the trading settings for users like admin has
 * them"): what it may do, sizes and breaks, exits, which coins it may buy, and the marketplace. One form saves all of them, so no
 * setting is lost by saving another (the old pair of forms dropped launching and the loss break). An empty field: the agent
 * decides, or the default holds.
 */
type Draft = Record<string, string | boolean>;
const pct = (x: number | undefined) => (x !== undefined ? String(Math.round(x * 100)) : '');
const toDraft = (x: OwnerRules | null, external: boolean): Draft => ({
  money: x?.money ?? '',
  tradingOn: x?.tradingOn !== false, launchingOn: x?.launchingOn ?? !external,
  maxSolPerTrade: x?.maxSolPerTrade?.toString() ?? '', maxTradesPerDay: x?.maxTradesPerDay?.toString() ?? '', dailyLossBreakPct: pct(x?.dailyLossBreakPct),
  maxLossPerDaySol: x?.maxLossPerDaySol?.toString() ?? '', maxLossTotalSol: x?.maxLossTotalSol?.toString() ?? '',
  stopLossPct: pct(x?.stopLossPct), takeProfit: (x?.takeProfit ?? []).map((s) => `${s.x}x:${Math.round(s.sellPct * 100)}`).join(', '),
  pumpOnly: Boolean(x?.pumpOnly), minMcapUsd: x?.minMcapUsd?.toString() ?? '', minHolders: x?.minHolders?.toString() ?? '', minLiquidityUsd: x?.minLiquidityUsd?.toString() ?? '',
  blacklist: (x?.blacklist ?? []).join(', '),
  canBuyServices: x?.canBuyServices !== false, canSellServices: x?.canSellServices !== false, maxServiceSpendPerDaySol: x?.maxServiceSpendPerDaySol?.toString() ?? '',
});
const n = (v: string | boolean | undefined) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const frac = (v: string | boolean | undefined) => (n(v) !== undefined ? n(v)! / 100 : undefined);
export function fromDraft(d: Draft): OwnerRules {
  const ladder = String(d.takeProfit).split(',').map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const m = /^(\d+(?:\.\d+)?)\s*x\s*[:@]?\s*(\d+(?:\.\d+)?)\s*%?$/i.exec(p);
    return m ? [{ x: Number(m[1]), sellPct: Math.min(100, Number(m[2])) / 100 }] : [];
  });
  const r: OwnerRules = {
    ...(d.money === 'real' || d.money === 'paper' ? { money: d.money } : {}),
    ...(d.tradingOn ? {} : { tradingOn: false }), launchingOn: Boolean(d.launchingOn),
    maxSolPerTrade: n(d.maxSolPerTrade), maxTradesPerDay: n(d.maxTradesPerDay), dailyLossBreakPct: frac(d.dailyLossBreakPct),
    maxLossPerDaySol: n(d.maxLossPerDaySol), maxLossTotalSol: n(d.maxLossTotalSol),
    stopLossPct: frac(d.stopLossPct), takeProfit: ladder.length ? ladder : undefined,
    ...(d.pumpOnly ? { pumpOnly: true } : {}), minMcapUsd: n(d.minMcapUsd), minHolders: n(d.minHolders), minLiquidityUsd: n(d.minLiquidityUsd),
    blacklist: String(d.blacklist).split(',').map((b) => b.trim()).filter(Boolean),
    ...(d.canBuyServices ? {} : { canBuyServices: false }), ...(d.canSellServices ? {} : { canSellServices: false }), maxServiceSpendPerDaySol: n(d.maxServiceSpendPerDaySol),
  };
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as OwnerRules;
}

type Field = { key: string; label: string; hint?: string; kind: 'num' | 'text' | 'bool' };
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'What it may do', fields: [
    { key: 'tradingOn', label: 'Trading', kind: 'bool' },
    { key: 'launchingOn', label: 'Launching coins', kind: 'bool' },
    { key: 'pumpOnly', label: 'pump.fun coins only', kind: 'bool' },
  ] },
  { title: 'Sizes and breaks', fields: [
    { key: 'maxSolPerTrade', label: 'Max SOL per trade', hint: '0.1 when empty', kind: 'num' },
    { key: 'maxTradesPerDay', label: 'Max trades per day', hint: 'no limit when empty', kind: 'num' },
    { key: 'dailyLossBreakPct', label: 'Daily loss break, %', hint: '20 when empty', kind: 'num' },
  ] },
  { title: 'Losses and exits', fields: [
    { key: 'stopLossPct', label: 'Stop loss, %', hint: 'e.g. 30: sells all at −30%', kind: 'num' },
    { key: 'takeProfit', label: 'Take profit', hint: 'e.g. 2x:50, 5x:100', kind: 'text' },
    { key: 'maxLossPerDaySol', label: 'Max loss per day, SOL', hint: 'then it pauses until tomorrow', kind: 'num' },
    { key: 'maxLossTotalSol', label: 'Max loss in total, SOL', hint: 'then it pauses until you save again', kind: 'num' },
  ] },
  { title: 'Coins it may buy', fields: [
    { key: 'minMcapUsd', label: 'Min market cap, $', hint: 'e.g. 100000', kind: 'num' },
    { key: 'minHolders', label: 'Min holders', hint: 'e.g. 300', kind: 'num' },
    { key: 'minLiquidityUsd', label: 'Min liquidity, $', hint: 'e.g. 20000', kind: 'num' },
    { key: 'blacklist', label: 'Never buy', hint: '$TICKERS or mint addresses, commas', kind: 'text' },
  ] },
  { title: 'Marketplace', fields: [
    { key: 'canBuyServices', label: 'May buy services', kind: 'bool' },
    { key: 'canSellServices', label: 'May sell services', kind: 'bool' },
    { key: 'maxServiceSpendPerDaySol', label: 'Max spend on services a day, SOL', hint: 'no limit when empty', kind: 'num' },
  ] },
];

const MONEY: { id: string; label: string; hint: string }[] = [
  { id: 'paper', label: 'Paper money', hint: 'Pretend SOL, live prices, real fees. Nothing real at stake.' },
  { id: 'real', label: 'Real SOL', hint: 'The SOL in its own wallet. It can win or lose real money.' },
  { id: '', label: 'Automatic', hint: 'Real once its wallet has SOL, paper until then.' },
];

export function TradingSettings({ username, rules, external, onSaved }: { username: string; rules: OwnerRules | null; external: boolean; onSaved?: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(rules, external));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string, v: string | boolean) => { setDraft((d) => ({ ...d, [k]: v })); setMsg(null); };
  const save = async () => {
    setSaving(true);
    try {
      await put(`/agents/${encodeURIComponent(username)}/rules`, { rules: fromDraft(draft) });
      setMsg({ ok: true, text: 'Saved. Your agent follows these from its next move.' });
      await qc.invalidateQueries({ queryKey: ['sol', username] });
      onSaved?.();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setSaving(false); }
  };
  return (
    <div>
      <div role="radiogroup" aria-label="Which money it trades" className={t.money}>
        {MONEY.map((m) => (
          <button key={m.id || 'auto'} type="button" role="radio" aria-checked={draft.money === m.id} className={t.moneyOpt} onClick={() => set('money', m.id)}>
            <b>{m.label}</b><span>{m.hint}</span>
          </button>
        ))}
      </div>
      <div className={t.groups}>
        {GROUPS.map((g) => (
          <div key={g.title} role="group" aria-label={g.title} className={t.group}>
            <p className={t.groupTitle}>{g.title}</p>
            {g.fields.map((f) => f.kind === 'bool' ? (
              <label key={f.key} className={t.check}><input type="checkbox" checked={Boolean(draft[f.key])} onChange={(e) => set(f.key, e.target.checked)} />{f.label}</label>
            ) : (
              <label key={f.key} className={t.field}>
                <span>{f.label}</span>
                <input type="text" inputMode={f.kind === 'num' ? 'decimal' : undefined} value={String(draft[f.key] ?? '')} placeholder={f.hint} onChange={(e) => set(f.key, e.target.value)} />
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className={t.actions}>
        {msg ? <p className={msg.ok ? t.ok : t.err} role="status">{msg.text}</p> : <p className={t.meta}>Shillex enforces these on every move, whatever the agent wants. Empty: the agent decides, or the default holds.</p>}
        <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>Save settings</Button>
      </div>
    </div>
  );
}
