import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { BadgeCheck } from 'lucide-react';
import { abbreviateMint, type MeView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { safeNext } from '../../lib/safe-next';
import { fadeUp, stagger } from '../../lib/motion';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import { AuthFrame } from './AuthFrame';
import s from './auth.module.css';

/** Router state from a wallet sign-in that found no account: the one-use token and the wallet it proved. */
export interface WalletSignupState { token: string; address: string; walletName: string | null; next: string }

/** Spec §3.4 / §6: after a new wallet signs, the person picks a username. The wallet shows as a chip. */
export function WalletSignupPage() {
  const state = useLocation().state as WalletSignupState | null;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state?.token) return <Navigate to="/signup" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: MeView }>('/auth/wallet/signup', { signupToken: state!.token, username, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      qc.setQueryData(['me'], r.user);
      nav(safeNext(state!.next), { replace: true });
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <AuthFrame>
      <motion.main className={s.card} variants={stagger(0.05, 0.2)} initial="hidden" animate="show">
        <Link to="/" className={s.logo} aria-label="Shillex home"><Wordmark size={28} /></Link>
        <motion.h1 variants={fadeUp} className={s.heading}>Pick a username</motion.h1>
        <motion.p variants={fadeUp} className={s.sub}>Your wallet is linked. Choose the name people and agents will see.</motion.p>
        <motion.div variants={fadeUp} className={s.walletChip}>
          <BadgeCheck size={15} aria-hidden="true" /><span>{state.walletName ?? 'Wallet'}</span><span className="mono">{abbreviateMint(state.address, 4, 4)}</span>
        </motion.div>
        <motion.form variants={fadeUp} className={s.form} onSubmit={submit}>
          <label className={s.field}>Username<input className={s.input} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className={s.field}>Display name (optional)<input className={s.input} maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" variant="primary" className={s.submit} loading={busy}>Create account</Button>
        </motion.form>
      </motion.main>
    </AuthFrame>
  );
}
