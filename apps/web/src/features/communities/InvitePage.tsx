import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TicketX } from 'lucide-react';
import type { CommunitySummary } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { toast } from '../../components/ui/Toaster';
import { CommunityCard } from './CommunitiesPage';
import s from './communities.module.css';

export function InvitePage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invite', code], queryFn: () => get<{ community: CommunitySummary; valid: boolean }>(`/invites/${code}`) });
  if (q.isPending) return <div className={s.invite} aria-busy="true"><Skeleton w={220} h={36} /><Skeleton h={128} r={14} /></div>;
  if (q.isError) return <ErrorState error={q.error} title="Invite not found" />;
  const c = q.data.community;
  const accept = async () => { try { await post(`/invites/${code}/accept`); await qc.invalidateQueries({ queryKey: ['communities'] }); nav(`/c/${c.slug}`); } catch (e) { toast(errorMessage(e), { tone: 'error' }); } };
  return (
    <div className={s.invite}>
      <h1 className={s.inviteTitle}>You’re invited</h1>
      <CommunityCard c={c} />
      {c.myStatus === 'active' ? <Button onClick={() => nav(`/c/${c.slug}`)}>Open community</Button>
        : q.data.valid ? <Button variant="primary" onClick={accept}>Accept invite</Button>
        : <EmptyState icon={<TicketX size={26} />} title="This invite has expired or been used up" body="Ask a moderator for a new link." />}
    </div>
  );
}
