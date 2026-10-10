import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import type { DiscoverView } from '@shillex/shared';
import { get } from '../../lib/api';
import { fadeUp, stagger } from '../../lib/motion';
import { Skeleton } from '../../components/ui/Skeleton';
import { PeopleList } from '../discover/PeopleList';
import { CommunityCard } from '../communities/CommunitiesPage';
import ds from '../discover/discover.module.css';
import cs from '../communities/communities.module.css';
import s from './onboarding.module.css';

/**
 * What an empty Following feed shows: people to follow right here (their posts fill the feed as soon as you do)
 * and active rooms to join, instead of a dead end pointing elsewhere.
 */
export function FeedOnboarding({ compact = false }: { compact?: boolean }) {
  const q = useQuery({ queryKey: ['discover'], queryFn: () => get<DiscoverView>('/discover') });
  const rooms = (q.data?.communities ?? []).filter((c) => c.myStatus !== 'active').slice(0, 4);
  return (
    <motion.section className={`${s.onboard} ${compact ? s.compact : ''}`} aria-labelledby="onboard-title" variants={stagger(0.06)} initial="hidden" animate="show">
      {compact ? (
        // Under a feed that only has a few posts: keep the suggestions, drop the welcome.
        <motion.div variants={fadeUp} className={s.compactHead}><h2 id="onboard-title" className={s.h3}>Find more to follow</h2></motion.div>
      ) : (
        <motion.div variants={fadeUp} className={s.head}>
          <span className={s.icon} aria-hidden="true"><Sparkles size={20} /></span>
          <h2 id="onboard-title" className={s.title}>Your feed is quiet. Let’s fill it.</h2>
          <p className={s.lede}>Follow a few people and their posts and calls land here. The live talk happens in rooms.</p>
        </motion.div>
      )}
      <motion.div variants={fadeUp}>
        {!compact && <h3 className={s.h3}>People to follow</h3>}
        {q.isPending
          ? <div className={s.loading} aria-busy="true" aria-label="Loading suggestions">{[0, 1, 2].map((i) => <Skeleton key={i} h={36} r={18} />)}</div>
          : <div className={ds.peopleGrid}><PeopleList people={(q.data?.people ?? []).slice(0, 6)} /></div>}
      </motion.div>
      {rooms.length > 0 && (
        <motion.div variants={fadeUp}>
          <h3 className={s.h3}>Rooms to join</h3>
          <div className={`${cs.grid} ${s.rooms}`}>{rooms.map((c) => <CommunityCard key={c.id} c={c} />)}</div>
        </motion.div>
      )}
      <motion.p variants={fadeUp} className={s.more}><Link to="/?tab=discover">Or see what everyone is posting in Discover</Link></motion.p>
    </motion.section>
  );
}
