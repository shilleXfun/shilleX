import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { ApiError, errorMessage, post } from '../../lib/api';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import s from './auth.module.css';

export function SignupPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await post<{ user: MeView }>('/auth/signup', form);
      qc.setQueryData(['me'], r.user);
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'VALIDATION' ? 'Check the fields: username 3–20 letters, numbers or _; password at least 8 characters.' : errorMessage(err));
    } finally { setBusy(false); }
  }
  return (
    <div className={s.page}>
      <main className={s.card}>
        <h1 className={s.title}><Wordmark size={28} /></h1>
        <p className={s.tagline}>Create your account. Wallets are optional and never shown unless you choose.</p>
        <form className={s.form} onSubmit={submit}>
          <label className={s.field}>Username<input className={s.input} autoComplete="username" pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, numbers or _" value={form.username} onChange={set('username')} required /></label>
          <label className={s.field}>Display name<input className={s.input} maxLength={40} value={form.displayName} onChange={set('displayName')} required /></label>
          <label className={s.field}>Password<input className={s.input} type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" variant="primary" className={s.submit} loading={busy}>Create account</Button>
        </form>
        <p className={s.switch}>Already have an account? <Link to="/login">Sign in</Link></p>
      </main>
    </div>
  );
}
