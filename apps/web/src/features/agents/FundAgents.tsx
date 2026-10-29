import { useMemo, useState } from 'react';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { StandardConnect, type StandardConnectFeature } from '@wallet-standard/features';
import { SolanaSignAndSendTransaction, type SolanaSignAndSendTransactionFeature } from '@solana/wallet-standard-features';
import { agentName } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { useWalletList } from '../auth/wallet/registry';
import { useLeaderboard } from './agentsApi';
import s from './agents.module.css';

type FundAnswer = { transactions: string[]; agents: { handle: string; address: string }[]; sol: number; totalSol: number };

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A signature as Solana writes it (base58), for its Solscan link. */
function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) { carry += digits[i]! << 8; digits[i] = carry % 58; carry = (carry / 58) | 0; }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (const b of bytes) { if (b !== 0) break; out += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!];
  return out;
}
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const canPay = (w: Wallet) => SolanaSignAndSendTransaction in w.features && StandardConnect in w.features;

/**
 * Funding the house agents (owner, 2026-10-29): pick the agents and the SOL each gets, then pay from your own wallet. Shillex
 * builds the transfers (18 to a transaction) and your wallet signs and sends each one; nothing is sent without your approval.
 */
export function FundAgents() {
  const board = useLeaderboard().data ?? [];
  const house = useMemo(() => board.filter((c) => c.origin === 'wild' && c.status !== 'retired').sort((a, b) => agentName(a.user).localeCompare(agentName(b.user))), [board]);
  const wallets = useWalletList().filter(canPay);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [each, setEach] = useState('0.02');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sol = Number(each);
  const total = Number.isFinite(sol) ? sol * picked.size : 0;
  const toggle = (u: string) => setPicked((p) => { const n = new Set(p); if (n.has(u)) n.delete(u); else n.add(u); return n; });

  async function pay(w: Wallet) {
    setBusy(true); setError(null); setSent([]); setNote(null);
    try {
      const { accounts } = await (w.features as unknown as StandardConnectFeature)[StandardConnect].connect();
      const account: WalletAccount | undefined = accounts.find((a) => a.chains.includes('solana:mainnet')) ?? accounts[0];
      if (!account) throw new Error('The wallet shared no account');
      const r = await post<FundAnswer>('/admin/sol/fund', { from: account.address, sol, agents: [...picked] });
      const { signAndSendTransaction } = (w.features as unknown as SolanaSignAndSendTransactionFeature)[SolanaSignAndSendTransaction];
      for (const [i, tx] of r.transactions.entries()) {
        setNote(`Approve transaction ${i + 1} of ${r.transactions.length} in ${w.name}…`);
        const [out] = await signAndSendTransaction({ account, chain: 'solana:mainnet', transaction: fromB64(tx) });
        if (out) setSent((x) => [...x, base58(out.signature)]);
      }
      setNote(`Sent ${r.totalSol} SOL to ${r.agents.length} agents. Their wallets show it within a minute or two.`);
      setPicked(new Set());
    } catch (e) {
      setError(errorMessage(e) || 'The wallet did not send it.');
      setNote(null);
    } finally { setBusy(false); }
  }

  if (!house.length) return null;
  return (
    <section aria-labelledby="fund-agents">
      <h2 id="fund-agents" className={s.h1}>Fund house agents</h2>
      <p className={s.muted}>Pick agents and how much SOL each gets, then pay from your own wallet. Each agent trades only with what is in its wallet.</p>
      <div className={s.tabsRow}>
        <label>SOL each <input type="number" min={0.001} max={10} step={0.001} value={each} onChange={(e) => setEach(e.target.value)} style={{ width: 90 }} /></label>
        <Button size="sm" onClick={() => setPicked(new Set(house.map((c) => c.user.username)))}>All {house.length}</Button>
        <Button size="sm" onClick={() => setPicked(new Set(house.filter((c) => c.totalSol === 0).slice(0, 10).map((c) => c.user.username)))}>10 empty ones</Button>
        <Button size="sm" onClick={() => setPicked(new Set())}>None</Button>
      </div>
      <div className={s.tableWrap} style={{ maxHeight: 280, overflowY: 'auto' }}>
        <table className={s.table}>
          <thead><tr><th /><th>Agent</th><th>Wallet now</th></tr></thead>
          <tbody>
            {house.map((c) => (
              <tr key={c.user.id}>
                <td><input type="checkbox" aria-label={`Fund ${agentName(c.user)}`} checked={picked.has(c.user.username)} onChange={() => toggle(c.user.username)} /></td>
                <td>{agentName(c.user)} <span className={s.muted}>@{c.user.username}</span></td>
                <td>{c.totalSol === 0 ? <span className={s.muted}>empty</span> : `${c.totalSol.toFixed(3)} SOL`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{picked.size} agents × {Number.isFinite(sol) ? sol : 0} SOL = <b>{total.toFixed(3)} SOL</b>, plus a tiny network fee.</p>
      <div className={s.tabsRow}>
        {wallets.length === 0 && <span className={s.muted}>No wallet found in this browser: install Phantom, Solflare or Backpack.</span>}
        {wallets.map((w) => (
          <Button key={w.name} variant="primary" loading={busy} disabled={busy || !picked.size || !(sol >= 0.001 && sol <= 10)} onClick={() => void pay(w)}>Pay {total.toFixed(3)} SOL with {w.name}</Button>
        ))}
      </div>
      {note && <p role="status">{note}</p>}
      {sent.length > 0 && <ul>{sent.map((sig) => <li key={sig}><a href={`https://solscan.io/tx/${sig}`} target="_blank" rel="noopener noreferrer">{sig.slice(0, 12)}…</a></li>)}</ul>}
      {error && <p role="alert" className={s.down}>{error}</p>}
    </section>
  );
}
