import { useState, type FormEvent } from 'react';
import type { MeView, WalletProof } from '@shillex/shared';
import { ApiError, errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { WalletButton } from './WalletButton';
import s from './auth.module.css';

/** Spec §5: Shillex sends no email, so a forgotten password is reset by signing with a wallet linked to the account. */
export function ForgotPassword({ onSignedIn }: { onSignedIn: (user: MeView) => void }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<WalletProof | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <p className={s.forgot}><button type="button" className={s.linkButton} onClick={() => setOpen(true)}>Forgot password?</button></p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!proof) return;
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: MeView }>('/auth/password/reset-with-wallet', { proof, password });
      onSignedIn(r.user);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && ['CHALLENGE_EXPIRED', 'NO_WALLET_ACCOUNT', 'SIGN_IN_INVALID'].includes(err.code)) setProof(null);
    } finally { setBusy(false); }
  }

  return (
    <section className={s.forgotPanel} aria-labelledby="forgot-title">
      <h2 id="forgot-title" className={s.forgotTitle}>Reset your password</h2>
      <p className={s.forgotText}>Shillex sends no email, so a password is reset with a wallet linked to your account. No wallet linked? There is no self-service reset: link one in Settings while you can still sign in.</p>
      {error && <div className={s.error} role="alert">{error}</div>}
      {!proof
        ? <WalletButton purpose="reset" label="Sign with your wallet" variant="secondary" onProof={async (p) => setProof(p)} />
        : <form className={s.form} onSubmit={submit}>
            <label className={s.field}>New password<input className={s.input} type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <Button type="submit" variant="primary" className={s.submit} loading={busy}>Set password and sign in</Button>
          </form>}
    </section>
  );
}
