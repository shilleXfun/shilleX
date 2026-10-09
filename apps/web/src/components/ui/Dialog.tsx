import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../../lib/cx';
import { IconButton } from './Button';
import s from './ui.module.css';

const InDialog = createContext(false);
/**
 * True inside a modal Dialog. Menus, popovers and the token panel render outside the modal's top layer (behind it, and
 * inert), so components that would open one should render a static variant here instead.
 */
export const useInDialog = () => useContext(InDialog);

export function Dialog({ open, onClose, title, children, footer, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={cx(s.dialog, className)} aria-labelledby={titleId}
      // The native `close` event also fires when our effect closes the dialog after the parent set open=false;
      // only report closes the parent doesn't already know about, so onClose fires once.
      onClose={() => { if (open) onClose(); }} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <InDialog value>
          <div className={s.dialogHead}><span id={titleId}>{title}</span><IconButton label="Close" onClick={onClose}><X size={16} /></IconButton></div>
          <div className={s.dialogBody}>{children}</div>
          {footer && <div className={s.dialogFoot}>{footer}</div>}
        </InDialog>
      )}
    </dialog>
  );
}
