import { Compass, House } from 'lucide-react';
import { motion } from 'motion/react';
import { ButtonLink } from '../components/ui/Button';
import { fadeUp } from '../lib/motion';
import s from './layout.module.css';

/** Candles around a gap: the one that should be here never printed. Heights are fixed, so it reads the same every time. */
const CANDLES = [{ h: 26, up: true }, { h: 38, up: false }, { h: 30, up: true }, null, { h: 44, up: true }, { h: 22, up: false }, { h: 34, up: true }];

export function NotFoundPage() {
  return (
    <motion.section className={s.notFound} aria-labelledby="nf-title" variants={fadeUp} initial="hidden" animate="show">
      <svg className={s.nfArt} viewBox="0 0 154 72" aria-hidden="true">
        <line x1="0" x2="154" y1="66.5" y2="66.5" className={s.nfBase} />
        {CANDLES.map((c, i) => {
          const x = 6 + i * 21;
          return c
            ? <g key={i} className={c.up ? s.nfUp : s.nfDown}><line x1={x + 6} x2={x + 6} y1={60 - c.h} y2={66} /><rect x={x} y={64 - c.h} width="12" height={c.h - 6} rx="2" /></g>
            : <rect key={i} x={x} y={18} width="12" height="40" rx="2" className={s.nfGhost} />;
        })}
      </svg>
      <h1 id="nf-title" className={s.nfTitle}>Page not found</h1>
      <p className={s.nfBody}>Nothing printed here. The link may be mistyped, or what it pointed to was deleted or made private.</p>
      <div className={s.nfActions}>
        <ButtonLink to="/" variant="primary" icon={<House size={15} aria-hidden="true" />}>Back to Home</ButtonLink>
        <ButtonLink to="/discover" icon={<Compass size={15} aria-hidden="true" />}>Discover</ButtonLink>
      </div>
    </motion.section>
  );
}
