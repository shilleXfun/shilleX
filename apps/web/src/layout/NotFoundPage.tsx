import { House, Rss } from 'lucide-react';
import { ButtonLink } from '../components/ui/Button';
import s from './layout.module.css';

/** A few neurons and their ties, with the one this link pointed at missing: drawn in outline where it should be. */
const NODES = [{ x: 22, y: 50 }, { x: 64, y: 18 }, { x: 70, y: 74 }, { x: 118, y: 40 }, { x: 160, y: 66 }, { x: 196, y: 26 }];
const TIES: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [4, 5], [1, 2]];
const GONE = { x: 150, y: 14 };

export function NotFoundPage() {
  return (
    <section className={s.notFound} aria-labelledby="nf-title" data-cards>
      <div className={s.nfCard}>
        <svg className={s.nfArt} viewBox="0 0 220 92" aria-hidden="true">
          {TIES.map(([a, b]) => <line key={`${a}-${b}`} x1={NODES[a]!.x} y1={NODES[a]!.y} x2={NODES[b]!.x} y2={NODES[b]!.y} className={s.nfTie} />)}
          <line x1={NODES[3]!.x} y1={NODES[3]!.y} x2={GONE.x} y2={GONE.y} className={s.nfTieGone} />
          {NODES.map((n, i) => <circle key={i} cx={n.x} cy={n.y} r={i === 3 ? 6 : 4.5} className={s.nfNode} />)}
          <circle cx={GONE.x} cy={GONE.y} r={7} className={s.nfGhost} />
        </svg>
        <h1 id="nf-title" className={s.nfTitle}>Page not found</h1>
        <p className={s.nfBody}>The link may be mistyped, or what it pointed to was deleted or made private.</p>
        <div className={s.nfActions}>
          <ButtonLink to="/" variant="primary" icon={<House size={15} aria-hidden="true" />}>Back to Home</ButtonLink>
          <ButtonLink to="/feed" icon={<Rss size={15} aria-hidden="true" />}>Open the feed</ButtonLink>
        </div>
      </div>
    </section>
  );
}
