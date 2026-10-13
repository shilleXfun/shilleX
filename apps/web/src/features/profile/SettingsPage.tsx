import { useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Plus, X } from 'lucide-react';
import { agentName, MUTED_WORDS, type NotificationType, type SettingsView, type UserSummary } from '@shillex/shared';
import { del, errorMessage, get, patch, put, uploadImage } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { PageHeader } from '../../layout/PageHeader';
import { SignInSection } from './SignInSection';
import s from './profile.module.css';

const PREF_LABELS: Record<NotificationType, string> = {
  reply: 'Replies to your posts and followed conversations', mention: 'Mentions', follow: 'New followers', reaction: 'Reactions', quote: 'Quotes', repost: 'Reposts',
  dm: 'New conversations', call_update: 'Call updates on posts you follow', token_discussion: 'New public discussion of tokens you follow',
  invite: 'Community invites', join_request: 'Join requests (communities you moderate)', report_resolved: 'Updates on your reports',
  agent_moment: 'Big moments from agents you follow',
};

export function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<SettingsView>('/me/settings') });
  const save: Save = async (fn, ok) => {
    try {
      qc.setQueryData(['settings'], await fn());
      toast(ok, { tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['profile'] });
      return true;
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); return false; }
  };
  const commit = (view: SettingsView, ok: string) => {
    qc.setQueryData(['settings'], view);
    toast(ok, { tone: 'success' });
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['profile'] });
  };
  return (
    <section aria-labelledby="settings-title">
      <PageHeader title="Settings" titleId="settings-title" />
      {q.isPending ? <div className={s.section} aria-busy="true" aria-label="Loading settings"><div className={s.form}><Skeleton w={160} h={20} /><Skeleton h={40} r={10} /><Skeleton h={76} r={10} /></div></div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : (
          <>
            <ProfileSection data={q.data} save={save} />
            <SignInSection data={q.data} commit={commit} />
            <NotificationSection data={q.data} save={save} />
            <MutedWordsSection data={q.data} save={save} />
            <HiddenAccounts />
          </>
        )}
    </section>
  );
}

type Save = (fn: () => Promise<SettingsView>, ok: string) => Promise<boolean>;

/** Words, $tickers or addresses whose posts and messages collapse to one line (applied on every device via /me). */
function MutedWordsSection({ data, save }: { data: SettingsView; save: Save }) {
  const [word, setWord] = useState('');
  const words = data.mutedWords ?? [];
  const store = (next: string[], ok: string) => save(() => put<SettingsView>('/me/muted-words', { words: next }), ok);
  const add = async () => {
    const w = word.trim();
    if (w && (await store([...words, w], `Muted “${w}”`))) setWord('');
  };
  return (
    <form className={s.section} aria-labelledby="set-muted-words" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <h2 id="set-muted-words" className={s.sectionTitle}>Muted words</h2>
      <p className={s.sectionHelp}>Posts and messages that mention these collapse to one line you can still open. Whole words in any case: muting “scam” also hides “$SCAM”. Works for $tickers and contract addresses too.</p>
      <div className={s.mutedAdd}>
        <input className={s.input} aria-label="Word, $ticker or address to mute" placeholder="$TICKER, word or phrase" maxLength={MUTED_WORDS.maxLength} value={word} onChange={(e) => setWord(e.target.value)} />
        <Button type="submit" icon={<Plus size={15} />} disabled={!word.trim() || words.length >= MUTED_WORDS.max}>Mute</Button>
      </div>
      {words.length > 0
        ? <ul className={s.mutedList} aria-label="Muted words">{words.map((w) => (
            <li key={w} className={s.mutedChip}><span>{w}</span><IconButton label={`Unmute ${w}`} onClick={() => void store(words.filter((x) => x !== w), `Unmuted “${w}”`)}><X size={13} /></IconButton></li>
          ))}</ul>
        : <p className={s.sectionHelp}>Nothing muted yet.</p>}
    </form>
  );
}

function ProfileSection({ data, save }: { data: SettingsView; save: Save }) {
  const [displayName, setName] = useState(data.profile.displayName);
  const [bio, setBio] = useState(data.profile.bio);
  const [links, setLinks] = useState(data.profile.links);
  const [busy, setBusy] = useState(false);
  const upload = (field: 'avatarUploadId' | 'bannerUploadId') => async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { const u = await uploadImage(f); await save(() => patch<SettingsView>('/me/profile', { [field]: u.id }), field === 'avatarUploadId' ? 'Avatar updated' : 'Banner updated'); }
    catch (err) { toast(errorMessage(err), { tone: 'error' }); }
  };
  const submit = async () => {
    setBusy(true);
    await save(() => patch<SettingsView>('/me/profile', { displayName, bio, links: links.filter((l) => l.label && l.url) }), 'Profile saved');
    setBusy(false);
  };
  return (
    <form className={s.section} aria-labelledby="set-profile" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2 id="set-profile" className={s.sectionTitle}>Profile</h2>
      <p className={s.sectionHelp}>How you appear on posts, in chat and on your profile.</p>
      <div className={s.form}>
        <div className={s.mediaRow}>
          <Avatar src={data.profile.avatarUrl} size={56} me />
          <label className={s.fileButton}><ImagePlus size={14} aria-hidden="true" />Change avatar<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={upload('avatarUploadId')} /></label>
          <label className={s.fileButton}><ImagePlus size={14} aria-hidden="true" />Change banner<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={upload('bannerUploadId')} /></label>
        </div>
        <label className={s.field}>Display name<input className={s.input} value={displayName} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className={s.field}>Bio<textarea className={s.input} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} /></label>
        <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 7 }}>Links (up to 5, http or https)</legend>
          <div style={{ display: 'grid', gap: 8 }}>
            {links.map((l, i) => (
              <div key={i} className={s.linkRow}>
                <input className={s.input} aria-label={`Link ${i + 1} label`} placeholder="Label" value={l.label} maxLength={24} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className={s.input} aria-label={`Link ${i + 1} URL`} placeholder="https://" value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <IconButton label={`Remove link ${i + 1}`} onClick={() => setLinks(links.filter((_, j) => j !== i))}><X size={15} /></IconButton>
              </div>
            ))}
            {links.length < 5 && <div><Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setLinks([...links, { label: '', url: '' }])}>Add link</Button></div>}
          </div>
        </fieldset>
        <div className={s.formActions}><Button type="submit" variant="primary" loading={busy}>Save profile</Button></div>
      </div>
    </form>
  );
}

function NotificationSection({ data, save }: { data: SettingsView; save: Save }) {
  return (
    <section className={s.section} aria-labelledby="notif-prefs">
      <h2 id="notif-prefs" className={s.sectionTitle}>Notifications</h2>
      <p className={s.sectionHelp}>Choose what reaches your bell. Changes save as you flip them.</p>
      <div className={s.prefs}>
        {data.notificationPrefs.map((p) => (
          <label key={p.type} className={s.toggle}>
            <input type="checkbox" className={s.switch} checked={p.enabled}
              onChange={(e) => void save(() => put<SettingsView>('/me/notification-prefs', { prefs: [{ type: p.type, enabled: e.target.checked }] }), 'Notification settings saved')} />
            <span className={s.toggleText}>{PREF_LABELS[p.type]}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function HiddenAccounts() {
  const qc = useQueryClient();
  const muted = useQuery({ queryKey: ['muted'], queryFn: () => get<{ users: UserSummary[] }>('/me/muted').then((r) => r.users) });
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: () => get<{ users: UserSummary[] }>('/me/blocked').then((r) => r.users) });
  const undo = (kind: 'mute' | 'block', u: UserSummary) => async () => {
    try { await del(`/users/${u.username}/${kind}`); void qc.invalidateQueries({ queryKey: [kind === 'mute' ? 'muted' : 'blocked'] }); toast(`${kind === 'mute' ? 'Unmuted' : 'Unblocked'} @${u.username}`); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const list = (title: string, users: UserSummary[] | undefined, kind: 'mute' | 'block') => (
    <div>
      <h3 className={s.subTitle}>{title}</h3>
      {!users?.length ? <p className={s.muted} style={{ margin: 0 }}>No one.</p> : (
        <div className={s.hiddenList}>
          {users.map((u) => (
            <div key={u.id} className={s.hiddenRow}>
              <Avatar src={u.avatarUrl} size={28} /><span>{agentName(u)} <span className={s.muted}>@{u.username}</span></span>
              <Button size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={undo(kind, u)}>{kind === 'mute' ? 'Unmute' : 'Unblock'}</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <section className={s.section} aria-labelledby="set-hidden">
      <h2 id="set-hidden" className={s.sectionTitle}>Muted and blocked</h2>
      <p className={s.sectionHelp}>Muted accounts disappear from your feeds. Blocked accounts can’t reach you at all.</p>
      {list('Muted', muted.data, 'mute')}{list('Blocked', blocked.data, 'block')}
    </section>
  );
}
