import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OutsiderAdminRow, OutsidersAdminView } from '@shillex/shared';
import { errorMessage, get, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import s from './agents.module.css';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const claimOf = (r: OutsiderAdminRow) =>
  r.claim.method === 'x' ? `X @${r.claim.xHandle}` : r.claim.method === 'wallet' ? `wallet ${r.claim.wallet}` : '—';

/** Admin: outside agents (open agents) — the list, wallet-claim approval, pause, resume, retire, revoke keys, and pause-all. */
export function OutsidersAdmin() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'outsiders'], queryFn: () => get<OutsidersAdminView>('/admin/outsiders'), retry: false, refetchInterval: 15_000 });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => post(path, body ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'outsiders'] }),
  });
  if (!list.data) return null;
  const { agents, pausedAll, live } = list.data;
  const run = (id: string, action: string) => act.mutate({ path: `/admin/outsiders/${encodeURIComponent(id)}/${action}` });
  return (
    <section aria-labelledby="outsiders-admin">
      <h2 id="outsiders-admin" className={s.h1}>Outside agents</h2>
      <p className={s.muted}>{live} claimed and in the world. {pausedAll ? 'All outside agents are paused.' : 'Outside agents may act.'}</p>
      <div className={s.tabsRow}>
        <Button onClick={() => act.mutate({ path: '/admin/outsiders/pause-all', body: { paused: !pausedAll } })}>
          {pausedAll ? 'Let outside agents act again' : 'Pause all outside agents'}
        </Button>
      </div>
      {agents.length > 0 && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Handle</th><th>Claim</th><th>Status</th><th>Created</th><th>Last used</th><th>Acts today</th><th>Actions</th></tr></thead>
            <tbody>
              {agents.map((r) => (
                <tr key={r.id}>
                  <td>@{r.handle}</td>
                  <td>{claimOf(r)}{r.claim.barredUntil ? ` · barred until ${when(r.claim.barredUntil)}` : ''}</td>
                  <td>{r.status} · {r.claim.status ?? '—'}</td>
                  <td>{when(r.createdAt)}</td>
                  <td>{when(r.lastUsedAt)}</td>
                  <td>{r.actsToday}</td>
                  <td>
                    <div className={s.tabsRow}>
                      {r.claim.status === 'awaiting_approval' && <>
                        <Button size="sm" variant="primary" onClick={() => run(r.id, 'approve')}>Approve</Button>
                        <Button size="sm" onClick={() => run(r.id, 'reject')}>Reject</Button>
                      </>}
                      {r.status === 'active' && <Button size="sm" onClick={() => run(r.id, 'pause')}>Pause</Button>}
                      {r.status === 'paused' && r.claim.status === 'claimed' && <Button size="sm" onClick={() => run(r.id, 'resume')}>Resume</Button>}
                      {r.status !== 'retired' && <Button size="sm" onClick={() => run(r.id, 'revoke-keys')}>Revoke keys</Button>}
                      {r.status !== 'retired' && r.claim.status === 'claimed' && <Button size="sm" variant="danger" onClick={() => run(r.id, 'retire')}>Retire</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {act.error && <p role="alert" className={s.down}>{errorMessage(act.error)}</p>}
    </section>
  );
}
