import type { ReactNode } from 'react';
import p from './flat.module.css';

/** A flat section (flat.module.css): a title, an optional note at its right, the content, and a hairline under it. */
export function FlatSection({ id, title, note, children }: { id: string; title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className={p.section} aria-labelledby={id}>
      <div className={p.sectionHead}>
        <h2 id={id} className={p.sectionTitle}>{title}</h2>
        {note && <span className={p.sectionNote}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
