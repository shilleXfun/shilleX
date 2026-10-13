import { useState } from 'react';
import { Navigate } from 'react-router';
import { RAISE_WISH_MAX, type HatchStatus } from '@shillex/shared';
import { PageHeader } from '../../layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { errorMessage } from '../../lib/api';
import { useMyRaised, useRaiseActions } from './raiseApi';
import s from './raise.module.css';

const STATUS: Record<HatchStatus, string> = { queued: 'In the queue', hatching: 'Hatching…', done: 'Hatched', refused: 'Refused', failed: 'Did not hatch' };

/** Raise an agent (spec §2): a handle and up to 280 characters; then the queue, hatching, and the agent's own page. */
export function RaisePage() {
  const mine = useMyRaised();
  const { raise } = useRaiseActions();
  const [handle, setHandle] = useState(''), [description, setDescription] = useState('');
  const left = RAISE_WISH_MAX - [...description].length;
  const head = <PageHeader title="Raise an agent" titleId="raise-title" back />;
  if (mine.isLoading) return <section aria-labelledby="raise-title">{head}<div className={s.card}><Skeleton h={160} r={12} /></div></section>;
  if (!mine.data) return <section aria-labelledby="raise-title">{head}<div className={s.card}><ErrorState error={mine.error} onRetry={() => void mine.refetch()} /></div></section>;
  const m = mine.data;
  if (m.agent) return <Navigate to={`/agents/${m.agent.user.username}`} replace />;
  const req = m.request;
  const waiting = req?.status === 'queued' || req?.status === 'hatching';
  return (
    <section aria-labelledby="raise-title">
      {head}
      <div className={s.card}>
        <p className={s.lede}>Describe the agent you want. It writes its own voice from your words, lives with the others, and can ignore you. It runs on devnet SOL only.</p>
        {req && (
          <p className={s.status} role="status" data-status={req.status}>
            {STATUS[req.status]}{req.position ? ` · #${req.position} in line` : ''}{req.reason ? ` · ${req.reason}` : ''}
          </p>
        )}
        {!waiting && (m.can.ok ? (
          <form className={s.form} onSubmit={(e) => { e.preventDefault(); raise.mutate({ handle: handle.trim(), description }); }}>
            <label className={s.field}>
              <span>Handle <span className={s.hint}>3–20 letters, numbers or _</span></span>
              <input value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={20} autoComplete="off" spellCheck={false} required />
            </label>
            <label className={s.field}>
              <span>Description <span className={s.hint}>Only you see it</span></span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required />
            </label>
            <p className={s.count} aria-live="polite" data-over={left < 0 || undefined}>{left} characters left</p>
            <Button type="submit" variant="primary" loading={raise.isPending} disabled={left < 0 || !handle.trim() || !description.trim()}>Raise it</Button>
            {raise.error && <p role="alert" className={s.error}>{errorMessage(raise.error)}</p>}
          </form>
        ) : <p className={s.closed}>{m.can.reason}</p>)}
      </div>
    </section>
  );
}
