import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Inbox, ShieldCheck } from 'lucide-react';
import { SLOW_MODE_OPTIONS, type ChannelView, type CommunityDetail, type InviteView, type MemberView, type ReportView } from '@shillex/shared';
import { errorMessage, get, patch, post } from '../../lib/api';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import s from './communities.module.css';

const slowLabel = (n: number) => (n === 0 ? 'Off' : n < 60 ? `${n}s` : `${n / 60}m`);

/** Moderator tools: join requests, open reports, per-channel spam controls, new channels and invite links. */
export function ModPanel({ detail }: { detail: CommunityDetail }) {
  const qc = useQueryClient();
  const slug = detail.community.slug;
  const requests = useQuery({ queryKey: ['requests', slug], queryFn: () => get<{ members: MemberView[] }>(`/communities/${slug}/requests`).then((r) => r.members) });
  const reports = useQuery({ queryKey: ['reports', slug], queryFn: () => get<{ reports: ReportView[] }>(`/communities/${slug}/reports`).then((r) => r.reports) });
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [newChannel, setNewChannel] = useState('');
  const run = (fn: () => Promise<unknown>, ok: string, keys: unknown[][]) => async () => {
    try { await fn(); toast(ok, { tone: 'success' }); keys.forEach((k) => void qc.invalidateQueries({ queryKey: k })); } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  const updateChannel = (ch: ChannelView, body: Partial<Pick<ChannelView, 'slowModeSeconds' | 'holdNewMemberPosts' | 'topic'>>) =>
    run(() => patch(`/channels/${ch.id}`, body), `#${ch.name} updated`, [['community', slug]])();
  const createInvite = async () => {
    try { const r = await post<{ invite: InviteView }>(`/communities/${slug}/invites`, { expiresInHours: 72, maxUses: 25 }); setInvite(r.invite); }
    catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };

  return (
    <div>
      <section className={s.section} aria-labelledby="mod-req">
        <h2 id="mod-req" className={s.sectionTitle}>Join requests</h2>
        {requests.isPending ? <Skeleton h={34} r={10} />
          : requests.data?.length ? requests.data.map((m) => (
            <div key={m.user.id} className={s.row}>
              <Avatar src={m.user.avatarUrl} size={30} />
              <span>{m.user.displayName} <span className={s.memberHandle}>@{m.user.username}</span></span>
              <span className={s.actions} style={{ marginLeft: 'auto' }}>
                <Button size="sm" variant="primary" onClick={run(() => post(`/communities/${slug}/requests/${m.user.id}/approve`), 'Approved', [['requests', slug], ['community', slug]])}>Approve</Button>
                <Button size="sm" variant="ghost" onClick={run(() => post(`/communities/${slug}/requests/${m.user.id}/reject`), 'Rejected', [['requests', slug]])}>Reject</Button>
              </span>
            </div>
          )) : <p className={s.muted} style={{ margin: 0 }}>No pending requests.</p>}
      </section>
      <section className={s.section} aria-labelledby="mod-rep">
        <h2 id="mod-rep" className={s.sectionTitle}>Reports</h2>
        {reports.isPending ? <Skeleton h={60} r={10} />
          : reports.data?.length ? reports.data.map((r) => (
            <div key={r.id} className={s.report}>
              <div className={s.muted} style={{ fontSize: 'var(--fs-sm)' }}>{r.reporter.displayName} reported a {r.targetType}: <strong style={{ color: 'var(--text)' }}>{r.reason}</strong></div>
              {r.preview && <blockquote className={s.quote}><strong>{r.preview.author?.displayName ?? 'Unknown'}</strong>: {r.preview.body || 'Deleted content'}</blockquote>}
              <div className={s.actions}>
                <Button size="sm" variant="danger" onClick={run(() => post(`/reports/${r.id}/resolve`, { action: 'remove_content' }), 'Content removed', [['reports', slug]])}>Remove content</Button>
                <Button size="sm" variant="ghost" onClick={run(() => post(`/reports/${r.id}/resolve`, { action: 'dismiss' }), 'Report dismissed', [['reports', slug]])}>Dismiss</Button>
              </div>
            </div>
          )) : <p className={s.muted} style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={15} aria-hidden="true" />No open reports.</p>}
      </section>
      <section className={s.section} aria-labelledby="mod-ch">
        <h2 id="mod-ch" className={s.sectionTitle}>Channels and spam controls</h2>
        {detail.channels.map((ch) => (
          <div key={ch.id} className={s.chanControls}>
            <strong>#{ch.name}</strong>
            <label className={s.control}>Slow mode
              <select className={s.select} value={ch.slowModeSeconds} onChange={(e) => updateChannel(ch, { slowModeSeconds: Number(e.target.value) })}>
                {SLOW_MODE_OPTIONS.map((n) => <option key={n} value={n}>{slowLabel(n)}</option>)}
              </select>
            </label>
            <label className={s.control}><input type="checkbox" checked={ch.holdNewMemberPosts} onChange={(e) => updateChannel(ch, { holdNewMemberPosts: e.target.checked })} />Hold messages from members who joined in the last 24h</label>
          </div>
        ))}
        <form className={s.inlineForm} onSubmit={(e) => { e.preventDefault(); const name = newChannel; void run(() => post(`/communities/${slug}/channels`, { name }), `#${name} created`, [['community', slug]])(); setNewChannel(''); }}>
          <input className={s.textInput} aria-label="New channel name" placeholder="new-channel" pattern="[a-z0-9-]{1,24}" title="Lowercase letters, numbers and dashes" value={newChannel} onChange={(e) => setNewChannel(e.target.value.toLowerCase())} />
          <Button size="sm" type="submit" disabled={!newChannel}>Add channel</Button>
        </form>
      </section>
      <section className={s.section} aria-labelledby="mod-inv">
        <h2 id="mod-inv" className={s.sectionTitle}>Invite link</h2>
        <Button size="sm" icon={<Inbox size={14} />} onClick={createInvite}>Create invite (72h, 25 uses)</Button>
        {invite && (
          <div className={s.inviteUrl}>
            <span style={{ flex: 1 }}>{invite.url}</span>
            <IconButton label="Copy invite link" onClick={() => void navigator.clipboard?.writeText(invite.url).then(() => toast('Invite link copied', { tone: 'success' }))}><Copy size={14} /></IconButton>
          </div>
        )}
      </section>
    </div>
  );
}
