import { AlertTriangle } from 'lucide-react';
import { errorMessage } from '../../lib/api';
import { Button } from './Button';
import s from './ui.module.css';

export function ErrorState({ error, onRetry, title = 'Couldn’t load this' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className={s.state} role="alert">
      <AlertTriangle size={28} className={s.stateIcon} aria-hidden="true" />
      <div className={s.stateTitle}>{title}</div>
      <div>{errorMessage(error)}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
