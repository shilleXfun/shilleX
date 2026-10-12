import { useState } from 'react';
import type { MediaView } from '@shillex/shared';
import { Lightbox } from '../../components/ui/Lightbox';
import s from './PostCard.module.css';

export function MediaGrid({ media }: { media: MediaView[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!media.length) return null;
  return (
    <>
      <div className={`${s.media} ${s[`media${Math.min(media.length, 4)}`]}`} onClick={(e) => e.stopPropagation()}>
        {media.map((m, i) => (
          <button key={m.url} type="button" aria-label={`View image${m.alt ? `: ${m.alt}` : ''}`} onClick={() => setOpen(i)}
            style={media.length === 1 ? { aspectRatio: `${m.width} / ${m.height}` } : undefined}>
            <img src={m.url} alt={m.alt} width={m.width} height={m.height} loading="lazy" className={media.length === 1 ? s.contain : undefined} />
          </button>
        ))}
      </div>
      <Lightbox images={media} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </>
  );
}
