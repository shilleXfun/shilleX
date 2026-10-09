import { useState } from 'react';
import { motion } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { CALL_STATUSES, CALL_STATUS_LABELS, COPY, relativeTime, type CallStatus, type CallUpdateView, type PostView } from '@shillex/shared';
import { errorMessage, post as apiPost } from '../../lib/api';
import { patchPost } from '../../lib/cache';
import { cx } from '../../lib/cx';
import { dur, ease, spring } from '../../lib/motion';
import { useArrivals } from '../../components/ui/Arrival';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import s from './PostCard.module.css';

/** The author's call updates on a post, oldest first, each labeled self-reported. A new update arrives with a heat flash. */
export function CallUpdates({ post }: { post: PostView }) {
  const arrival = useArrivals(post.callUpdates.map((u) => u.id), 'bottom');
  if (!post.callUpdates.length) return null;
  return (
    <div className={s.calls} onClick={(e) => e.stopPropagation()}>
      <motion.span aria-hidden="true" className={s.callLine} initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={{ once: true }} transition={{ duration: dur.enter, ease: ease.out }} />
      <ol className={s.callList} aria-label="Call updates">
        {post.callUpdates.map((u, i) => <CallRow key={u.id} u={u} fresh={arrival(u.id, i)?.kind === 'arrived'} />)}
      </ol>
    </div>
  );
}

function CallRow({ u, fresh }: { u: CallUpdateView; fresh: boolean }) {
  const [flash] = useState(fresh);
  return (
    <motion.li className={cx(s.call, s[`status_${u.status}`])} initial={flash ? { opacity: 0, x: -8 } : false} animate={{ opacity: 1, x: 0 }} transition={spring.soft}>
      {flash && <motion.span aria-hidden="true" className={s.callFlash} initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.2, delay: 0.2 }} />}
      <span className={s.callDot} aria-hidden="true" />
      <span className={s.callStatus}>{CALL_STATUS_LABELS[u.status]}</span>
      {u.note && <span className={s.callNoteText}>{u.note}</span>}
      <time className={s.time} dateTime={u.createdAt}>{relativeTime(u.createdAt)}</time>
      <span className={s.selfReported} title="Posted by the author; not verified by Shillex">{COPY.selfReported}</span>
    </motion.li>
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
