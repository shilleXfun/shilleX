import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import type { MediaView } from '@shillex/shared';
import { IconButton } from './Button';
import s from './Lightbox.module.css';

/**
 * Full-screen image viewer for a post's or message's images: ←/→ step through them, Esc closes, and the image's
 * description (alt text) is shown as its caption. A native modal dialog, so focus is trapped and returned.
 */
export function Lightbox({ images, index, onIndex, onClose }: { images: MediaView[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = index !== null && !!images[index];
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const many = images.length > 1;
  const step = (by: number) => { if (index !== null && many) onIndex((index + by + images.length) % images.length); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  };
  const img = open ? images[index!]! : null;
  return (
    <dialog ref={ref} className={s.box} aria-label={img?.alt ? `Image: ${img.alt}` : 'Image'} onKeyDown={onKey}
      onClose={() => { if (open) onClose(); }} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current || (e.target as HTMLElement).dataset.backdrop) onClose(); }}>
      {img && (
        <div className={s.stage} data-backdrop="true">
          <figure className={s.figure}>
            <img key={img.url} src={img.url} alt={img.alt} className={s.img} />
            {(img.alt || many) && (
              <figcaption className={s.caption}>
                {many && <span className={s.count}>{index! + 1} / {images.length}</span>}
                {img.alt && <span>{img.alt}</span>}
              </figcaption>
            )}
          </figure>
          <div className={s.tools}>
            <a className={s.tool} href={img.url} target="_blank" rel="noopener noreferrer" aria-label="Open original in a new tab"><ExternalLink size={18} aria-hidden="true" /></a>
            <IconButton label="Close image" className={s.tool} onClick={onClose} autoFocus><X size={20} /></IconButton>
          </div>
          {many && <>
            <IconButton label="Previous image" className={`${s.tool} ${s.prev}`} onClick={() => step(-1)}><ChevronLeft size={24} /></IconButton>
            <IconButton label="Next image" className={`${s.tool} ${s.next}`} onClick={() => step(1)}><ChevronRight size={24} /></IconButton>
          </>}
        </div>
      )}
    </dialog>
  );
}
