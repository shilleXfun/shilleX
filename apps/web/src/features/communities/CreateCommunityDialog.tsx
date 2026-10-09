import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { CommunityDetail, CommunityVisibility } from '@shillex/shared';
import { errorMessage, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import s from './communities.module.css';

const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const VIS: { id: CommunityVisibility; label: string; help: string }[] = [
  { id: 'public', label: 'Public', help: 'Anyone can read and join. Token mentions here appear in public token discussion.' },
  { id: 'private', label: 'Private', help: 'Listed by name only. Moderators approve members. Nothing inside is ever shown publicly.' },
  { id: 'invite', label: 'Invite-only', help: 'Not listed. Join only with an invite link. Nothing inside is ever shown publicly.' },
];

export function CreateCommunityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(''); const [slug, setSlug] = useState(''); const [touched, setTouched] = useState(false);
  const [description, setDescription] = useState(''); const [visibility, setVisibility] = useState<CommunityVisibility>('public');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    try {
      const r = await post<{ community: CommunityDetail }>('/communities', { name, slug: touched ? slug : slugify(name), description, visibility });
      await qc.invalidateQueries({ queryKey: ['communities'] });
      onClose(); nav(`/c/${r.community.community.slug}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Create a community"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 3} onClick={submit}>Create community</Button></>}>
      <label className={s.field}>Name<input className={s.textInput} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
      <label className={s.field}>Address
        <span className={s.slugInput}><span>/c/</span><input aria-label="Community address" value={touched ? slug : slugify(name)} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }} /></span>
      </label>
      <label className={s.field}>Description<textarea className={s.textInput} value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} /></label>
      <fieldset className={s.visOptions}>
        <legend>Visibility</legend>
        {VIS.map((v) => (
          <label key={v.id} className={s.visOption}>
            <input type="radio" name="vis" checked={visibility === v.id} onChange={() => setVisibility(v.id)} />
            <span><strong>{v.label}</strong><span>{v.help}</span></span>
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className={s.formError}>{error}</p>}
    </Dialog>
  );
}
