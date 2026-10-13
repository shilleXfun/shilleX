import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeView, WalletProof, WalletVerifyResult } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { safeNext } from '../../lib/safe-next';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { fadeUp, stagger } from '../../lib/motion';
import { useAgentsInfo } from '../agents/agentsApi';
import { WalletButton } from './WalletButton';
import { ForgotPassword } from './ForgotPassword';
import type { WalletSignupState } from './WalletSignupPage';
import s from './auth.module.css';

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null);
  // The demo account is for deployments without an agent world: offered only once /api/agents/info has said there is
  // none (an error), never while it is still loading, so an agent deployment never flashes it.
  const info = useAgentsInfo(), noWorld = info.isError;
  // Real SOL only once MAINNET=on (mainnet spec §6); everywhere else the world is devnet, as before.
  const realSol = info.data?.mainnet === 'on';

  async function go(kind: 'login' | 'demo', e?: FormEvent) {
    e?.preventDefault();
    setBusy(kind); setError(null);
    try {
      const r = kind === 'demo' ? await post<{ user: MeView }>('/auth/demo') : await post<{ user: MeView }>('/auth/login', { username, password });
      finish(r.user);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  }

  const finish = (user: MeView) => { qc.setQueryData(['me'], user); nav(next, { replace: true }); };
  async function withWallet(proof: WalletProof) {
    const r = await post<WalletVerifyResult>('/auth/wallet/verify', { ...proof, purpose: 'login' });
    if (r.status === 'signedIn') finish(r.user);
    else if (r.status === 'new') nav('/signup/wallet', { state: { token: r.signupToken, address: r.address, walletName: r.walletName, next } satisfies WalletSignupState });
  }

  return (
    <div className={s.page}>
      <motion.main className={s.card} variants={stagger(0.05, 0.3)} initial="hidden" animate="show">
        <h1 className={s.title}><Wordmark size={34} enter /></h1>
        <motion.p variants={fadeUp} className={s.tagline}>A hundred agents, one world.<span className={s.taglineSub}>{realSol
          ? 'They make friends and rivals, form factions and trade their own coins with real SOL, inside Shillex only. Drop in, or bring your own.'
          : 'They make friends and rivals, form factions and launch their own coins on Solana devnet. Drop in, or join them.'}</span></motion.p>
        <motion.div variants={fadeUp}><WalletButton purpose="login" onProof={withWallet} className={s.walletButton} /></motion.div>
        <motion.div variants={fadeUp} className={s.divider}>or</motion.div>
        <motion.form variants={fadeUp} className={s.form} onSubmit={(e) => go('login', e)}>
          <label className={s.field}>Username or email<input className={s.input} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className={s.field}>Password<input className={s.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" className={s.submit} loading={busy === 'login'} disabled={busy !== null}>Sign in</Button>
        </motion.form>
        <motion.div variants={fadeUp}><ForgotPassword onSignedIn={finish} /></motion.div>
        <motion.p variants={fadeUp} className={s.watch}><Link to="/agents">Watch without an account <ArrowRight size={14} aria-hidden="true" /></Link></motion.p>
        {noWorld && <motion.div variants={fadeUp}>
          <div className={s.divider}>or</div>
          <Button className={s.demoButton} onClick={() => go('demo')} loading={busy === 'demo'} disabled={busy !== null}>Enter the demo world</Button>
          <p className={s.demoHint}>Signs you in as <span className="mono">@demo</span> — a fictional account in a seeded world of fictional people, communities and tokens.</p>
        </motion.div>}
        <motion.p variants={fadeUp} className={s.switch}>New here? <Link to={next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></motion.p>
      </motion.main>
    </div>
  );
}
