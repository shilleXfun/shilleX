import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';

const IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const images = (files: FileList | null | undefined) => [...(files ?? [])].filter((f) => IMAGE.test(f.type));
const carriesFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes('Files');

/**
 * Paste or drop images onto a composer. Paste only takes over when the clipboard holds an image and no plain text:
 * spreadsheets and some editors copy both, and then the text is what you meant.
 */
export function useImageDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child crossed, so count depth instead of trusting a single leave.
  const depth = useRef(0);
  const reset = () => { depth.current = 0; setOver(false); };
  return {
    over: enabled && over,
    handlers: {
      onPaste: (e: ClipboardEvent) => {
        if (!enabled || e.clipboardData.getData('text/plain')) return;
        const files = images(e.clipboardData.files);
        if (files.length) { e.preventDefault(); onFiles(files); }
      },
      onDragEnter: (e: DragEvent) => { if (!enabled || !carriesFiles(e.dataTransfer)) return; e.preventDefault(); depth.current += 1; setOver(true); },
      onDragOver: (e: DragEvent) => { if (enabled && carriesFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
      onDragLeave: () => { if (!enabled) return; depth.current -= 1; if (depth.current <= 0) reset(); },
      onDrop: (e: DragEvent) => {
        if (!enabled || !carriesFiles(e.dataTransfer)) return;
        e.preventDefault(); reset();
        const files = images(e.dataTransfer.files);
        if (files.length) onFiles(files);
      },
    },
  };
}
