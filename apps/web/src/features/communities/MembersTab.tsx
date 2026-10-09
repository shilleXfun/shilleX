import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ellipsis } from 'lucide-react';
import type { CommunityDetail, MemberView } from '@shillex/shared';
import { errorMessage, get, post, put } from '../../lib/api';
import { useRequiredMe } from '../../lib/useMe';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { IconButton } from '../../components/ui/Button';
import { Menu } from '../../components/ui/Menu';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import s from './communities.module.css';

export function useMembers(slug: string, enabled = true) {
  return useQuery({ queryKey: ['members', slug], queryFn: () => get<{ members: MemberView[] }>(`/communities/${slug}/members`), enabled });
}

const ROLE_LABEL = { owner: 'Owner', mod: 'Mod', member: 'Member' } as const;

/** Members, online first. Online avatars carry the pulsing presence ring; mods get a per-member moderation menu. */
export function MembersTab({ detail }: { detail: CommunityDetail }) {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const slug = detail.community.slug;
  const q = useMembers(slug);
  const act = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); void qc.invalidateQueries({ queryKey: ['members', slug] }); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };
  if (q.isPending) {
    return <div className={s.memberList} aria-busy="true" aria-label="Loading members">{[0, 1, 2, 3].map((i) => <div key={i} className={s.memberRow}><Skeleton w={34} h={34} r={17} /><Skeleton w={160} h={12} /></div>)}</div>;
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const owner = detail.community.myRole === 'owner';
  const online = q.data.members.filter((m) => m.online);
  const offline = q.data.members.filter((m) => !m.online);
  const row = (m: MemberView) => (
    <li key={m.user.id} className={s.memberRow}>
      <Avatar src={m.user.avatarUrl} size={34} online={m.online} me={m.user.id === me.id} />
      <span style={{ minWidth: 0 }}>
        <Link to={`/u/${m.user.username}`} className={s.memberName}>{m.user.displayName}</Link> <span className={s.memberHandle}>@{m.user.username}</span>
      </span>
      {m.role !== 'member' && <Badge tone="accent">{ROLE_LABEL[m.role]}</Badge>}
      {detail.isMod && m.user.id !== me.id && m.role !== 'owner' && (owner || m.role === 'member') && (
        <span className={s.memberActions}>
          <Menu label={`Moderate ${m.user.username}`} items={[
            ...(owner ? [{ label: m.role === 'mod' ? 'Remove mod' : 'Make mod', onSelect: act(() => put(`/communities/${slug}/members/${m.user.id}/role`, { role: m.role === 'mod' ? 'member' : 'mod' }), 'Role updated') }] : []),
            { label: 'Remove from community', onSelect: act(() => post(`/communities/${slug}/members/${m.user.id}/remove`), 'Member removed'), danger: true },
            { label: 'Ban', onSelect: act(() => post(`/communities/${slug}/members/${m.user.id}/ban`), 'Member banned'), danger: true },
          ]} trigger={(t) => <IconButton {...t} label={`Moderate ${m.user.username}`}><Ellipsis size={15} /></IconButton>} />
        </span>
      )}
    </li>
  );
  const list = { listStyle: 'none', margin: 0, padding: 0 } as const;
  return (
    <div className={s.memberList}>
      {online.length > 0 && <><div className={s.groupLabel}>Online, {online.length}</div><ul aria-label="Online members" style={list}>{online.map(row)}</ul></>}
      {offline.length > 0 && <><div className={s.groupLabel}>Offline, {offline.length}</div><ul aria-label="Offline members" style={list}>{offline.map(row)}</ul></>}
    </div>
  );
}
