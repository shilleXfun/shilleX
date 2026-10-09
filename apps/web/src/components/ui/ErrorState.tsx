import { TriangleAlert } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { Button } from './Button';
import s from './ui.module.css';

export function ErrorState({ error, onRetry, title = 'Couldn’t load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className={s.state} role="alert">
      <span className={s.stateIcon} aria-hidden="true"><TriangleAlert size={26} /></span>
      <div className={s.stateTitle}>{title}</div>
      <div className={s.stateBody}>{errorMessage(error)}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
