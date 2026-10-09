import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { MeView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Wordmark } from '../../components/brand/Wordmark';
import { Button } from '../../components/ui/Button';
import s from './auth.module.css';

export function LoginPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get('next');
  // Only same-origin paths: "//evil.example" would be protocol-relative.
  const next = rawNext?.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null);

  async function go(kind: 'login' | 'demo', e?: FormEvent) {
    e?.preventDefault();
    setBusy(kind); setError(null);
    try {
      const r = kind === 'demo' ? await post<{ user: MeView }>('/auth/demo') : await post<{ user: MeView }>('/auth/login', { username, password });
      qc.setQueryData(['me'], r.user);
      nav(next, { replace: true });
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  }

  return (
    <div className={s.page}>
      <main className={s.card}>
        <h1 className={s.title}><Wordmark size={28} /></h1>
        <p className={s.tagline}>Talk with the trenches. Every coin starts as a conversation.</p>
        <form className={s.form} onSubmit={(e) => go('login', e)}>
          <label className={s.field}>Username<input className={s.input} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
          <label className={s.field}>Password<input className={s.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" variant="primary" className={s.submit} loading={busy === 'login'} disabled={busy !== null}>Sign in</Button>
        </form>
        <div className={s.divider}>or</div>
        <Button className={s.demoButton} onClick={() => go('demo')} loading={busy === 'demo'} disabled={busy !== null}>Enter the demo world</Button>
        <p className={s.demoHint}>Signs you in as <span className="mono">@demo</span> — a fictional account in a seeded world of fictional people, communities and tokens.</p>
        <p className={s.switch}>New here? <Link to="/signup">Create an account</Link></p>
      </main>
    </div>
  );
}
