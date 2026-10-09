import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { useSocketEvent } from '../../lib/socket';
import { dur, press, spring } from '../../lib/motion';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import s from './PostCard.module.css';

/** Counts posts from followed accounts announced over the socket; clicking reloads the Following feed. */
export function NewPostsPill() {
  const qc = useQueryClient();
  const [n, setN] = useState(0);
  useSocketEvent('post:new', () => setN((x) => x + 1));
  return (
    <div className={s.newPill}>
      <AnimatePresence>
        {n > 0 && (
          <motion.button type="button" className={s.newPillBtn} {...press}
            initial={{ y: -40, opacity: 0, scale: 0.8 }} animate={{ y: 8, opacity: 1, scale: 1, transition: spring.bouncy }} exit={{ y: -20, opacity: 0, transition: { duration: dur.micro } }}
            onClick={() => { setN(0); void qc.invalidateQueries({ queryKey: ['feed', 'following'] }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <ArrowUp size={15} aria-hidden="true" /><AnimatedNumber value={n} /> new {n === 1 ? 'post' : 'posts'}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
