import { useState } from 'react';
import type { MediaView } from '@shillex/shared';
import { Dialog } from '../../components/ui/Dialog';
import s from './PostCard.module.css';

export function MediaGrid({ media }: { media: MediaView[] }) {
  const [open, setOpen] = useState<MediaView | null>(null);
  if (!media.length) return null;
  return (
    <>
      <div className={`${s.media} ${s[`media${Math.min(media.length, 4)}`]}`} onClick={(e) => e.stopPropagation()}>
        {media.map((m) => (
          <button key={m.url} type="button" aria-label={`View image${m.alt ? `: ${m.alt}` : ''}`} onClick={() => setOpen(m)}>
            <img src={m.url} alt={m.alt} width={m.width} height={m.height} loading="lazy" />
          </button>
        ))}
      </div>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.alt || 'Image'}>
        {open && <img src={open.url} alt={open.alt} className={s.lightbox} />}
      </Dialog>
    </>
  );
}
