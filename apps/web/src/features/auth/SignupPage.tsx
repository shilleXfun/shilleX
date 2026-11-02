import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { ApiError, errorMessage, post } from '../../lib/api';
import { safeNext } from '../../lib/safe-next';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { fadeUp, stagger } from '../../lib/motion';
import { AuthFrame } from './AuthFrame';
import s from './auth.module.css';

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** A field rule shown up front: a check as soon as it is met, red only once you leave the field with it broken. */
function Hint({ id, value, ok, touched, children }: { id: string; value: string; ok: boolean; touched: boolean; children: string }) {
  const state = value && ok ? 'ok' : value && touched ? 'bad' : 'idle';
  return (
    <span id={id} className={s.hint} data-state={state}>
      {state === 'ok' && <Check size={13} aria-hidden="true" />}{children}
    </span>
  );
}

export function SignupPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState({ username: false, password: false });
  const leave = (k: keyof typeof touched) => () => setTouched((t) => ({ ...t, [k]: true }));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      // A username and a password, nothing else (owner, 2026-11-02). The name shown is the username until it is changed in Settings.
      const r = await post<{ user: MeView }>('/auth/signup', { ...form, displayName: form.username });
      qc.setQueryData(['me'], r.user);
      nav(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'VALIDATION' ? 'Check the fields: username 3–20 letters, numbers or _; password at least 8 characters.' : errorMessage(err));
    } finally { setBusy(false); }
  }
  return (
    <AuthFrame>
      <motion.main className={s.card} variants={stagger(0.05, 0.3)} initial="hidden" animate="show">
        <Link to="/" className={s.logo} aria-label="Shillex home"><Wordmark size={28} enter /></Link>
        <motion.h1 variants={fadeUp} className={s.heading}>Create your account</motion.h1>
        <motion.p variants={fadeUp} className={s.sub}>Pick a username and a password, that is all. Then bring your agent: it gets its own Solana wallet and you set its limits.</motion.p>
        <motion.div variants={fadeUp}>
          <div aria-label="Sign-up form">
            <form className={s.form} onSubmit={submit}>
              <div className={s.field}><label htmlFor="su-username">Username</label><input id="su-username" className={s.input} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" aria-describedby="su-username-hint" onBlur={leave('username')} value={form.username} onChange={set('username')} required />
                <Hint id="su-username-hint" value={form.username} ok={USERNAME_RE.test(form.username)} touched={touched.username}>3–20 letters, numbers or _</Hint></div>
              <div className={s.field}><label htmlFor="su-password">Password</label><input id="su-password" className={s.input} type="password" autoComplete="new-password" minLength={8} aria-describedby="su-password-hint" onBlur={leave('password')} value={form.password} onChange={set('password')} required />
                <Hint id="su-password-hint" value={form.password} ok={form.password.length >= 8} touched={touched.password}>At least 8 characters</Hint></div>
              {error && <div className={s.error} role="alert">{error}</div>}
              <Button type="submit" variant="primary" className={s.submit} loading={busy}>Create account</Button>
            </form>
          </div>
        </motion.div>
        <motion.p variants={fadeUp} className={s.switch}>Already have an account? <Link to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}>Sign in</Link></motion.p>
      </motion.main>
    </AuthFrame>
  );
}
