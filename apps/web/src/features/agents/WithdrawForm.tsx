import { useState } from 'react';
import { abbreviateMint, isValidSolanaAddress, type WalletProof } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { WalletButton } from '../auth/WalletButton';
import w from './withdraw.module.css';

/**
 * Withdraw an agent's SOL (owner, 2026-10-29), all or part, at any time: to any Solana address the owner types, checked once
 * more before it is sent (no wallet needed), or to the owner's own wallet by a free signed message. Every withdrawal also
 * sends the owner an always-on notice.
 */
export function WithdrawForm({ handle, sol, onDone, title = true }: { handle: string; sol: number; onDone: () => void; title?: boolean }) {
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const all = Math.max(0, sol - 0.000005);
  const n = amount.trim() === '' ? null : Number(amount);
  const badAmount = n !== null && !(n > 0);
  const address = to.trim();

  const send = async (body: { to: string } | { wallet: WalletProof }) => {
    setBusy(true);
    try {
      const r = await post<{ outcome: string; sig?: string }>(`/agents/${encodeURIComponent(handle)}/withdraw`, { sol: n, ...body });
      setMsg({ ok: true, text: `Withdrawn: ${r.outcome.replace(/^sent /, '')}.`, sig: r.sig });
      setAmount(''); setTo(''); setAsking(false);
      onDone();
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  const review = () => {
    if (badAmount) { setMsg({ ok: false, text: 'Enter an amount of SOL, or leave it empty to withdraw everything.' }); return; }
    if (!isValidSolanaAddress(address)) { setMsg({ ok: false, text: 'That is not a Solana address.' }); return; }
    setMsg(null); setAsking(true);
  };

  return (
    <div className={w.box}>
      {title && <h3 className={w.title}>Withdraw</h3>}
      <p className={w.meta}>The balance is yours to take out at any time. Leave the amount empty to withdraw everything ({all.toFixed(4)} SOL).</p>
      <div className={w.row}>
        <input className={w.input} type="number" min={0.001} step={0.001} inputMode="decimal" value={amount} placeholder="all" aria-label="SOL to withdraw"
          onChange={(e) => { setAmount(e.target.value); setAsking(false); }} />
        <input className={`${w.input} ${w.address}`} type="text" spellCheck={false} autoComplete="off" value={to} placeholder="Solana address to send to" aria-label="Address to send to"
          onChange={(e) => { setTo(e.target.value); setAsking(false); }} />
        <Button variant="primary" size="sm" disabled={!address || busy} onClick={review}>Send</Button>
      </div>
      {asking && (
        <div className={w.confirm} role="alertdialog" aria-label="Confirm the withdrawal">
          <span>Send <strong>{n === null ? `everything (${all.toFixed(4)} SOL)` : `${n} SOL`}</strong> to <code title={address}>{abbreviateMint(address, 6, 6)}</code>? This can't be undone.</span>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void send({ to: address })}>Confirm</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAsking(false)}>Cancel</Button>
        </div>
      )}
      <div className={w.or}>
        <span>or</span>
        <WalletButton purpose="confirm" size="sm" variant="ghost" label="Withdraw to my wallet" onProof={async (proof) => {
          if (badAmount) { setMsg({ ok: false, text: 'Enter an amount of SOL, or leave it empty to withdraw everything.' }); return; }
          await send({ wallet: proof });
        }} />
      </div>
      {msg && <p className={msg.ok ? w.ok : w.err} role="status">{msg.text}{msg.sig && <> <a href={`https://solscan.io/tx/${msg.sig}`} target="_blank" rel="noreferrer">View on Solscan</a></>}</p>}
    </div>
  );
}
