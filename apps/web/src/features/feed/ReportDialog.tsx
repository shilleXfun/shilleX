import { useState } from 'react';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/Toaster';
import s from './PostCard.module.css';

const REASONS = ['Spam or scam link', 'Impersonation', 'Harassment', 'Coordinated pump / fake hype', 'Something else'];
export function ReportDialog({ target, onClose }: { target: { type: 'post' | 'message' | 'user'; id: string } | null; onClose: () => void }) {
  const [reason, setReason] = useState(REASONS[0]!);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      await post('/reports', { targetType: target.type, targetId: target.id, reason: details.trim() ? `${reason}: ${details.trim()}` : reason });
      toast('Report sent to moderators', { tone: 'success' });
      setDetails('');
      onClose();
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); } finally { setBusy(false); }
  }
  return (
    <Dialog open={!!target} onClose={onClose} title="Report"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Send report</Button></>}>
      <div className={s.form}>
        <fieldset className={s.reasons}>
          <legend>What’s wrong?</legend>
          {REASONS.map((r) => <label key={r}><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{r}</label>)}
        </fieldset>
        <label className={s.field}><span className="sr-only">Details (optional)</span>
          <textarea placeholder="Details (optional)" value={details} maxLength={400} rows={3} onChange={(e) => setDetails(e.target.value)} />
        </label>
      </div>
    </Dialog>
  );
}
