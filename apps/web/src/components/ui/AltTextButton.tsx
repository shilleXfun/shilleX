import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { Dialog } from './Dialog';
import s from './AltText.module.css';

const MAX = 200;

/** The ALT tag on an attached image: opens a dialog to describe it for people who can't see it. */
export function AltTextButton({ src, value, onChange, className }: { src: string; value: string; onChange: (alt: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const id = useId();
  const save = () => { onChange(draft.trim()); setOpen(false); };
  return (
    <>
      <button type="button" className={cx(s.alt, value && s.altSet, className)} onClick={() => { setDraft(value); setOpen(true); }}
        aria-label={value ? `Edit image description: ${value}` : 'Add image description'} title={value || 'Add a description'}>
        ALT{value && <Check size={10} strokeWidth={3} aria-hidden="true" />}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Describe this image"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
        <div className={s.body}>
          <img src={src} alt="" className={s.preview} />
          <label htmlFor={id} className={s.label}>Description</label>
          <textarea id={id} className={s.input} value={draft} maxLength={MAX} rows={3} autoFocus aria-describedby={`${id}-hint`}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
            placeholder="e.g. 1h chart of $GRUB: a steady climb, then a long red candle at the top" />
          <span id={`${id}-hint`} className={s.hint}>Read aloud to people using screen readers. {MAX - draft.length} characters left.</span>
        </div>
      </Dialog>
    </>
  );
}
