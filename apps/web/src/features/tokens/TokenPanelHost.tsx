import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { dur, ease, spring } from '../../lib/motion';
import { useTokenPanel } from './useTokenPanel';
import { TokenPanel } from './TokenPanel';
import s from './panel.module.css';

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
const useIsMobile = () => useSyncExternalStore((l) => { mq?.addEventListener('change', l); return () => mq?.removeEventListener('change', l); }, () => !!mq?.matches, () => false);

/**
 * Desktop: a non-modal aside that springs in from the right edge; the routed page stays mounted and usable.
 * Mobile: a modal bottom sheet (`<dialog>`) that rises with a spring and can be dragged down to dismiss.
 * Open state lives in `?token=<mint>`, so browser Back closes it.
 */
export function TokenPanelHost() {
  const { mint, close } = useTokenPanel();
  const mobile = useIsMobile();
  if (mobile) return <Sheet mint={mint} onClose={close} />;
  return (
    <AnimatePresence>
      {mint && (
        <motion.div key="token-panel" className={s.aside}
          initial={{ x: '100%', opacity: 0.6 }} animate={{ x: 0, opacity: 1, transition: spring.soft }} exit={{ x: '100%', opacity: 0, transition: { duration: dur.standard, ease: ease.out } }}>
          <TokenPanel key={mint} mint={mint} onClose={close} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Sheet({ mint, onClose }: { mint: string | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const drag = useDragControls();
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (mint && !d.open) d.showModal();
    if (!mint && d.open) d.close();
  }, [mint]);
  // Drag from the handle or header only, so the sheet's own content still scrolls; a press on a button stays a click.
  const startDrag = (e: ReactPointerEvent) => { if (!(e.target as HTMLElement).closest('button, a')) drag.start(e); };
  return (
    <dialog ref={dlg} className={s.sheet} aria-labelledby="token-panel-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === dlg.current) onClose(); }}>
      {mint && (
        <motion.div className={s.sheetBody} key={mint}
          initial={{ y: '100%' }} animate={{ y: 0, transition: spring.soft }}
          drag="y" dragControls={drag} dragListener={false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.05, bottom: 0.9 }}
          onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}>
          <TokenPanel mint={mint} onClose={onClose} asSheet onHandleDown={startDrag} />
        </motion.div>
      )}
    </dialog>
  );
}
