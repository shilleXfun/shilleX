import { useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { MeView } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { CopyLine } from '../join/CopyLine';
import s from './auth.module.css';

interface Started { token: string; handle: string; code: string; text: string; intentUrl: string; expiresAt: string }

/** X's logo, drawn: no image request. */
export function XMark() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
}

/**
 * Sign in with X by posting (2026-10-28, owner: no "Authorize" screen, type the handle first, fixable if mistyped). Step one:
 * the X handle, which locks the sign-in to that account. Step two: post the code from it (a button opens X with the post written)
 * and paste the post's link. Shillex reads the public post and signs its author in. No password or key leaves X.
 */
export function XSignIn({ onSignedIn }: { onSignedIn: (u: MeView) => void }) {
  const [handle, setHandle] = useState('');
  const [started, setStarted] = useState<Started | null>(null);
  const [editing, setEditing] = useState(true);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await post<Started>('/auth/x/start', started ? { handle, token: started.token } : { handle });
      setStarted(r); setHandle(`@${r.handle}`); setEditing(false);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!started) return;
    setBusy(true); setError(null);
    try { onSignedIn((await post<{ user: MeView }>('/auth/x/verify', { token: started.token, postUrl: link })).user); }
    catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      // An expired or used sign-in can't be saved: start over with the same handle.
      if (/expired|already used/i.test(msg)) { setStarted(null); setEditing(true); }
    } finally { setBusy(false); }
  };

  return (
    <div className={s.xFlow}>
      {editing || !started ? (
        <form className={s.form} onSubmit={lock}>
          <label className={s.field}>Your X handle
            <input className={s.input} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourname" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          </label>
          <p className={s.xNote}>You’ll post a short code from this account to prove it’s yours. Nothing to authorize, no password.</p>
          {error && <div className={s.error} role="alert">{error}</div>}
          <Button type="submit" className={s.submit} loading={busy} disabled={!handle.trim()}>{started ? 'Use this handle' : 'Continue'}</Button>
        </form>
      ) : (
        <>
          <div className={s.xLocked}>
            <span>Signing in as <b>@{started.handle}</b></span>
            <button type="button" className={s.xEdit} onClick={() => { setEditing(true); setError(null); }}><Pencil size={13} aria-hidden="true" /> Edit</button>
          </div>
          <ol className={s.xSteps}>
            <li>
              <b>Post this from @{started.handle}</b>
              <CopyLine text={started.text} label="Copy the post" />
              <a className={s.xButton} href={started.intentUrl} target="_blank" rel="noopener noreferrer"><XMark /> Post on X</a>
            </li>
            <li>
              <b>Paste the link to your post</b>
              <form className={s.form} onSubmit={verify}>
                <input className={s.input} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://x.com/yourname/status/…" inputMode="url" autoCapitalize="none" spellCheck={false} aria-label="Link to your post" required />
                {error && <div className={s.error} role="alert">{error}</div>}
                <Button type="submit" className={s.submit} loading={busy} disabled={!link.trim()}>Check and sign in</Button>
              </form>
            </li>
          </ol>
          <p className={s.xNote}>You can delete the post once you’re in.</p>
        </>
      )}
    </div>
  );
}
