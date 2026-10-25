import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { XAdminView } from '@shillex/shared';
import { api, errorMessage, get } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import s from './x.module.css';
import { LOCALE } from '../../lib/locale';

/** /admin → X feed (x-feed §2, §6, §9): what is read, what it costs today, the live topics, and the highlights waiting for the owner. */
export function XAdminPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'x'], queryFn: () => get<XAdminView>('/admin/x'), retry: false, refetchInterval: 30_000 });
  const [kind, setKind] = useState<'account' | 'query'>('account');
  const [value, setValue] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'x'] });
  const call = useMutation({ mutationFn: (r: { method: string; path: string; body?: unknown }) => api(r.path, { method: r.method, body: r.body }), onSuccess: refresh });
  const add = useMutation({ mutationFn: () => api('/admin/x/sources', { method: 'POST', body: { kind, value } }), onSuccess: () => { setValue(''); void refresh(); } });
  if (q.error) return <p className={s.hint}>X feed: {errorMessage(q.error)}</p>;
  const v = q.data;
  if (!v) return null;
  const st = v.status;
  return (
    <section className={s.panel} aria-labelledby="x-admin-title">
      <h2 id="x-admin-title">X feed</h2>
      <p className={s.status}>
        Reading: {st.reading} · Highlights: {st.highlights} · Posting: {st.posting} · Spent today: ${v.spendToday.usd.toFixed(3)} of ${v.limits.dailyBudgetUsd.toFixed(2)} · Reads {v.spendToday.postReads}/{v.limits.dailyMaxPostReads}
      </p>
      {(st.readHalted || st.postHalted || st.lastError) && (
        <div className={s.row} role="alert">
          <span>{st.readHalted ?? st.postHalted ?? st.lastError}</span>
          <Button onClick={() => call.mutate({ method: 'POST', path: '/admin/x/resume' })}>Resume</Button>
        </div>
      )}
      <form className={s.row} onSubmit={(e) => { e.preventDefault(); if (value.trim()) add.mutate(); }}>
        <select aria-label="Source kind" value={kind} onChange={(e) => setKind(e.target.value as 'account' | 'query')}>
          <option value="account">Account</option>
          <option value="query">Search</option>
        </select>
        <input aria-label="Handle or search" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'account' ? '@handle' : 'search words'} />
        <Button type="submit" loading={add.isPending}>Add source</Button>
      </form>
      {add.error && <p role="alert" className={s.hint}>{errorMessage(add.error)}</p>}
      <ul className={s.list} aria-label="Sources">
        {v.sources.map((src) => (
          <li key={src.id} className={s.item}>
            <div className={s.row}>
              <strong>{src.value}</strong>
              <span className={s.status}>{src.kind}{src.enabled ? '' : ' · paused'}{src.backoffUntil ? ` · rate limited until ${new Date(src.backoffUntil).toLocaleTimeString(LOCALE)}` : ''}</span>
              <Button onClick={() => call.mutate({ method: 'PATCH', path: `/admin/x/sources/${src.id}`, body: { enabled: !src.enabled } })}>{src.enabled ? 'Pause' : 'Resume source'}</Button>
              <Button onClick={() => call.mutate({ method: 'DELETE', path: `/admin/x/sources/${src.id}` })}>Remove</Button>
            </div>
          </li>
        ))}
      </ul>
      <h3>Live topics</h3>
      <ul className={s.list} aria-label="Live topics">
        {v.topics.map((t) => <li key={t.id} className={s.item}><span>{t.label}</span><span className={s.status}>heat {t.heat.toFixed(2)} · mood {t.sentiment.toFixed(2)}</span></li>)}
      </ul>
      <h3>Highlights</h3>
      <ul className={s.list} aria-label="Highlights">
        {v.highlights.map((h) => (
          <li key={h.id} className={s.item}>
            <span>{h.body}</span>
            {h.link && <span className={s.status}>{h.link}</span>}
            {h.imageUrl && <img className={s.thumb} src={h.imageUrl} alt="" />}
            <div className={s.row}>
              <span className={s.status}>{h.kind} · {h.status}{h.error ? ` · ${h.error}` : ''}</span>
              {h.status === 'draft' && <Button variant="primary" onClick={() => call.mutate({ method: 'POST', path: `/admin/x/highlights/${h.id}/approve` })}>Approve</Button>}
              {(h.status === 'draft' || h.status === 'approved') && <Button onClick={() => call.mutate({ method: 'POST', path: `/admin/x/highlights/${h.id}/skip` })}>Skip</Button>}
            </div>
          </li>
        ))}
      </ul>
      {call.error && <p role="alert" className={s.hint}>{errorMessage(call.error)}</p>}
    </section>
  );
}
