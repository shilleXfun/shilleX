import { useState, type FormEvent } from 'react';
import { BadgeCheck, Trash2 } from 'lucide-react';
import { abbreviateMint, AUTH_LIMITS, type AccountProof, type LinkWalletRequest, type SettingsView, type SignInView, type WalletProof, type WalletView } from '@shillex/shared';
import { ApiError, del, errorMessage, patch, post, put } from '../../lib/api';
import { Button, IconButton } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { WalletButton } from '../auth/WalletButton';
import s from './profile.module.css';

type Commit = (view: SettingsView, ok: string) => void;

/** Spec §6: password, email and wallets. Changes need the current password, or (no password) a wallet signature. */
export function SignInSection({ data, commit }: { data: SettingsView; commit: Commit }) {
  const si = data.signIn;
  return (
    <section className={s.section} aria-labelledby="set-signin">
      <h2 id="set-signin" className={s.sectionTitle}>Sign-in methods</h2>
      <p className={s.sectionHelp}>Keep at least one way in: a password or a wallet. Your username always works with your password.</p>
      <div className={s.form}>
        <PasswordForm si={si} commit={commit} />
        <EmailForm si={si} commit={commit} />
        <Wallets si={si} commit={commit} />
      </div>
    </section>
  );
}

function PasswordForm({ si, commit }: { si: SignInView; commit: Commit }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (proof: AccountProof) => {
    const v = await put<SettingsView>('/me/password', { password: next, proof });
    setCurrent(''); setNext('');
    commit(v, si.hasPassword ? 'Password changed. Other devices were signed out.' : 'Password set');
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await run({ password: current }); } catch (err) { toast(errorMessage(err), { tone: 'error' }); } finally { setBusy(false); }
  }
  return (
    <form className={s.form} aria-labelledby="set-password" onSubmit={submit}>
      <h3 id="set-password" className={s.subTitle}>Password</h3>
      {si.hasPassword && <label className={s.field}>Current password<input className={s.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>}
      <label className={s.field}>{si.hasPassword ? 'New password' : 'Password'}<input className={s.input} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
      <div className={s.formActions}>
        {si.hasPassword
          ? <Button type="submit" variant="primary" loading={busy} disabled={next.length < 8}>Change password</Button>
          : <WalletButton purpose="confirm" size="sm" label="Set password (confirm with a wallet)" disabled={next.length < 8} onProof={(p) => run({ wallet: p })} />}
      </div>
    </form>
  );
}

function EmailForm({ si, commit }: { si: SignInView; commit: Commit }) {
  const [email, setEmail] = useState(si.email ?? '');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const run = (value: string | null) => async (proof: AccountProof) => {
    const v = await put<SettingsView>('/me/email', { email: value, proof });
    setCurrent('');
    commit(v, value ? 'Email saved' : 'Email removed');
  };
  async function viaPassword(value: string | null, which: 'save' | 'remove') {
    setBusy(which);
    try { await run(value)({ password: current }); } catch (err) { toast(errorMessage(err), { tone: 'error' }); } finally { setBusy(null); }
  }
  const trimmed = email.trim();
  return (
    <form className={s.form} aria-labelledby="set-email" onSubmit={(e) => { e.preventDefault(); void viaPassword(trimmed, 'save'); }}>
      <h3 id="set-email" className={s.subTitle}>Email</h3>
      <p className={s.muted} style={{ margin: 0 }}>Sign in with it instead of your username. Shillex never emails you and never shows it to anyone.</p>
      {!si.hasPassword && <p className={s.muted} style={{ margin: 0 }}>Email sign-in needs a password: set one above.</p>}
      <label className={s.field}>Email<input className={s.input} type="email" autoComplete="email" maxLength={AUTH_LIMITS.emailMax} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {si.hasPassword && <label className={s.field}>Password (to confirm)<input className={s.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>}
      <div className={s.formActions}>
        {si.hasPassword ? <>
          <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!trimmed || trimmed.toLowerCase() === si.email || !current}>Save email</Button>
          {si.email && <Button variant="ghost" loading={busy === 'remove'} disabled={!current} onClick={() => void viaPassword(null, 'remove')}>Remove email</Button>}
        </> : <>
          <WalletButton purpose="confirm" size="sm" label="Save email (confirm with a wallet)" disabled={!trimmed} onProof={(p) => run(trimmed)({ wallet: p })} />
          {si.email && <WalletButton purpose="confirm" size="sm" variant="ghost" label="Remove email (confirm with a wallet)" onProof={(p) => run(null)({ wallet: p })} />}
        </>}
      </div>
    </form>
  );
}

/**
 * Linking a wallet adds a way to sign in, so a session alone isn't enough: the current password, or (no password) a
 * signature by a wallet already on the account goes with the new wallet's signature. The owner is notified either way.
 */
function Wallets({ si, commit }: { si: SignInView; commit: Commit }) {
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState<WalletProof | null>(null);
  const proof: AccountProof | null = si.hasPassword ? (password ? { password } : null) : (confirmed ? { wallet: confirmed } : null);
  const link = async (wallet: WalletProof) => {
    if (!proof) return;
    try {
      const v = await post<SettingsView>('/me/wallets', { wallet, proof } satisfies LinkWalletRequest);
      setPassword(''); setConfirmed(null);
      commit(v, 'Wallet linked');
    } catch (e) {
      // A wallet confirmation is single-use: once the server has seen it, the next try needs a fresh one.
      if (e instanceof ApiError) setConfirmed(null);
      throw e;
    }
  };
  const room = si.wallets.length < AUTH_LIMITS.walletsPerAccount;
  const unverified = si.wallets.some((w) => !w.verified);
  return (
    <div className={s.form}>
      <h3 className={s.subTitle}>Wallets</h3>
      {si.wallets.length === 0
        ? <p className={s.muted} style={{ margin: 0 }}>No wallets linked.</p>
        : <ul className={s.walletList} aria-label="Linked wallets">{si.wallets.map((w) => <WalletRow key={w.address} w={w} si={si} commit={commit} onVerify={link} canVerify={proof !== null} />)}</ul>}
      {(room || unverified) && <>
        <p className={s.muted} style={{ margin: 0 }}>
          {si.hasPassword ? 'To add or verify a wallet, enter your password.' : 'To add or verify a wallet, first confirm with a wallet already on your account.'} You get a notification whenever a wallet is linked or removed.
        </p>
        {si.hasPassword
          ? <label className={s.field}>Password (to add or verify a wallet)<input className={s.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          : confirmed
            ? <p className={s.muted} style={{ margin: 0 }} role="status">Confirmed with {confirmed.walletName ?? 'your wallet'}. Now add or verify a wallet.</p>
            : <div><WalletButton purpose="confirm" size="sm" variant="secondary" label="Confirm with a linked wallet" onProof={async (p) => setConfirmed(p)} /></div>}
      </>}
      {room && <div><WalletButton purpose="link" variant="secondary" label="Add a wallet" disabled={!proof} onProof={link} /></div>}
    </div>
  );
}

function WalletRow({ w, si, commit, onVerify, canVerify }: { w: WalletView; si: SignInView; commit: Commit; onVerify: (p: WalletProof) => Promise<void>; canVerify: boolean }) {
  const short = abbreviateMint(w.address, 4, 4);
  const act = async (fn: () => Promise<SettingsView>, ok: string) => {
    try { commit(await fn(), ok); } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return (
    <li className={s.walletRow}>
      <div className={s.walletRowHead}>
        <span className={s.walletRowName}>{w.walletName ?? 'Wallet'}</span>
        <span className="mono">{short}</span>
        {w.verified
          ? <span className={s.walletVerified}><BadgeCheck size={14} aria-hidden="true" />Verified</span>
          : <WalletButton purpose="link" size="sm" variant="ghost" label="Verify" disabled={!canVerify} onProof={onVerify} />}
        <IconButton label={`Remove wallet ${short}`} onClick={() => void act(() => del<SettingsView>(`/me/wallets/${w.address}`), 'Wallet removed')}><Trash2 size={14} /></IconButton>
      </div>
      <label className={s.toggle}>
        <input type="checkbox" className={s.switch} checked={w.showOnProfile} disabled={!w.verified}
          onChange={(e) => void act(() => patch<SettingsView>(`/me/wallets/${w.address}`, { showOnProfile: e.target.checked }), e.target.checked ? 'Shown on your profile' : 'Hidden from your profile')} />
        <span className={s.toggleText}>Show on profile</span>
      </label>
      {si.payoutEnabled && w.verified && (
        <label className={s.toggle}>
          <input type="radio" name="payout-wallet" checked={w.isPayout} onChange={() => void act(() => patch<SettingsView>(`/me/wallets/${w.address}`, { isPayout: true }), 'Payout wallet set')} />
          <span className={s.toggleText}>Payout wallet</span>
        </label>
      )}
    </li>
  );
}
