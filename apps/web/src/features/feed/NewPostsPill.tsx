import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp } from 'lucide-react';
import { useSocketEvent } from '../../lib/socket';

/** Counts posts from followed accounts announced over the socket; clicking reloads the Following feed. */
export function NewPostsPill() {
  const qc = useQueryClient();
  const [n, setN] = useState(0);
  useSocketEvent('post:new', () => setN((x) => x + 1));
  if (!n) return null;
  return (
    <div style={{ position: 'sticky', top: 'calc(var(--sticky-top, 0px) + 52px)', zIndex: 5, display: 'grid', placeItems: 'center', height: 0, overflow: 'visible' }}>
      <button type="button" onClick={() => { setN(0); void qc.invalidateQueries({ queryKey: ['feed', 'following'] }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: 0, borderRadius: 999, background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600, boxShadow: 'var(--shadow-pop)', transform: 'translateY(8px)' }}>
        <ArrowUp size={14} aria-hidden="true" /> {n} new {n === 1 ? 'post' : 'posts'}
      </button>
    </div>
  );
}
