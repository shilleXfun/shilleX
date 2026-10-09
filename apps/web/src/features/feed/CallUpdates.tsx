import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CALL_STATUSES, CALL_STATUS_LABELS, COPY, relativeTime, type CallStatus, type CallUpdateView, type PostView } from '@shillex/shared';
import { errorMessage, post as apiPost } from '../../lib/api';
import { patchPost } from '../../lib/cache';
import { cx } from '../../lib/cx';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import s from './PostCard.module.css';

/** The author's call updates on a post, oldest first, each labeled self-reported. */
export function CallUpdates({ post }: { post: PostView }) {
  if (!post.callUpdates.length) return null;
  return (
    <ol className={s.calls} aria-label="Call updates" onClick={(e) => e.stopPropagation()}>
      {post.callUpdates.map((u) => (
        <li key={u.id} className={s.call}>
          <span className={cx(s.callStatus, s[`status_${u.status}`])}>{CALL_STATUS_LABELS[u.status]}</span>
          {u.note && <span>{u.note}</span>}
          <time className={s.time} dateTime={u.createdAt}>{relativeTime(u.createdAt)}</time>
          <span className={s.selfReported} title="Posted by the author; not verified by Shillex">{COPY.selfReported}</span>
        </li>
      ))}
    </ol>
  );
}

export function AddCallUpdate({ p, open, onClose }: { p: PostView; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<CallStatus>('watching');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ update: CallUpdateView; post: PostView }>(`/posts/${p.id}/call-updates`, { status, note: note.trim() || undefined });
      patchPost(qc, p.id, () => r.post);
      setNote(''); onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add a call update"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Post update</Button></>}>
      <div className={s.form}>
        <p className={s.callNote}>Updates stay attached to this post and are labeled <strong>{COPY.selfReported}</strong>. They can’t be edited later.</p>
        <fieldset className={s.statusPicker}>
          <legend className="sr-only">Status</legend>
          {CALL_STATUSES.map((c) => (
            <label key={c} className={s.statusOption}>
              <input type="radio" name={`call-status-${p.id}`} value={c} checked={status === c} onChange={() => setStatus(c)} />{CALL_STATUS_LABELS[c]}
            </label>
          ))}
        </fieldset>
        <label className={s.field}>Note (optional)
          <textarea value={note} maxLength={280} rows={3} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p role="alert" className={s.formError}>{error}</p>}
      </div>
    </Dialog>
  );
}
