import { useState } from 'react';
import type { MainnetNoticeView } from '@shillex/shared';
import { Button } from '../../components/ui/Button';
import s from './mainnet.module.css';

/** The risk notice (mainnet spec §6): its fixed points, the legal position as the review left it, and an 18+ confirmation. */
export function RiskNotice({ notice, onAccept, busy }: { notice: MainnetNoticeView; onAccept(): void; busy: boolean }) {
  const [adult, setAdult] = useState(false);
  return (
    <div className={s.stack} role="group" aria-labelledby="risk-h">
      <h3 id="risk-h" className={s.h3}>Before you add real SOL</h3>
      <ul className={s.list}>{notice.points.map((p) => <li key={p}>{p}</li>)}</ul>
      {notice.legalPosition && <p className={s.muted}>{notice.legalPosition}</p>}
      <label className={s.row}><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> I am 18 or over</label>
      <Button variant="primary" disabled={!adult || !notice.version} loading={busy} onClick={onAccept}>I understand</Button>
    </div>
  );
}
