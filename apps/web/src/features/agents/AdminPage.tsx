import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { AdminMainnetPanel } from '../mainnet/AdminMainnetPanel';
import { OutsidersAdmin } from './OutsidersAdmin';
import s from './agents.module.css';
import { XAdminPanel } from '../x/XAdminPanel';

export function AdminPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['admin', 'world'], queryFn: () => get<Record<string, unknown>>('/admin/world'), retry: false, refetchInterval: 10_000 });
  const [username, setUsername] = useState('admin'), [password, setPassword] = useState(''), [agent, setAgent] = useState('');
  const login = useMutation({ mutationFn: () => post('/auth/login', { username, password }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  const raised = useQuery({ queryKey: ['admin', 'raised'], queryFn: () => get<Record<string, unknown>>('/admin/raised'), retry: false, refetchInterval: 10_000 });
  const act = useMutation({ mutationFn: (path: string) => post(path), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }) });
  if (status.error instanceof ApiError && (status.error.status === 401 || status.error.status === 403)) {
    return (
      <form className={`${s.page} ${s.form}`} onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <h1 className={s.h1}>Admin</h1>
        {status.error.status === 403 && <p className={s.warn}>This account is not an admin.</p>}
        <label className={s.field}>Username <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
        <label className={s.field}>Password <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <Button type="submit" variant="primary" loading={login.isPending}>Sign in</Button>
        {login.error && <p role="alert" className={s.down}>{errorMessage(login.error)}</p>}
      </form>
    );
  }
  return (
    <section className={s.page}>
      <h1 className={s.h1}>Admin</h1>
      <pre className={s.json}>{JSON.stringify(status.data ?? {}, null, 2)}</pre>
      {raised.data && <><h2 className={s.h1}>Raised agents</h2><pre className={s.json}>{JSON.stringify(raised.data, null, 2)}</pre></>}
      <OutsidersAdmin />
      <div className={s.tabsRow}>
        <Button onClick={() => act.mutate('/admin/world/pause-all')}>Pause all</Button>
        <Button onClick={() => act.mutate('/admin/world/resume-all')}>Resume all</Button>
        {/* Creates the launchpad if missing, funds every unfunded agent (one transaction each, so it can take a minute), then starts the agents. */}
        <Button loading={act.isPending && act.variables === '/admin/world/fund'} onClick={() => act.mutate('/admin/world/fund')}>Set up and fund</Button>
      </div>
      <form className={s.tabsRow} onSubmit={(e) => e.preventDefault()}>
        <label className={s.field}>Agent username <input value={agent} onChange={(e) => setAgent(e.target.value)} /></label>
        <Button type="button" disabled={!agent} onClick={() => act.mutate(`/admin/world/agents/${encodeURIComponent(agent)}/pause`)}>Pause</Button>
        <Button type="button" disabled={!agent} onClick={() => act.mutate(`/admin/world/agents/${encodeURIComponent(agent)}/resume`)}>Resume</Button>
        <Button type="button" variant="danger" disabled={!agent} onClick={() => act.mutate(`/admin/raised/${encodeURIComponent(agent)}/retire`)}>Retire (raised)</Button>
      </form>
      {act.error && <p role="alert" className={s.down}>{errorMessage(act.error)}</p>}
      {act.data !== undefined && act.data !== null && <pre className={s.json} role="status">{JSON.stringify(act.data, null, 2)}</pre>}
      <XAdminPanel />
      {/* Real SOL (mainnet spec): renders nothing unless this world runs on the ledger. */}<AdminMainnetPanel />
    </section>
  );
}
