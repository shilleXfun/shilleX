import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Compass, Users } from 'lucide-react';
import { Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { NewPostsPill } from './NewPostsPill';

/** Sticky page header style shared by top-level pages; `--sticky-top` keeps it below the mobile header. */
export const pageHeader: CSSProperties = { position: 'sticky', top: 'var(--sticky-top, 0px)', zIndex: 10, background: 'var(--glass)', backdropFilter: 'blur(8px)' };

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'discover' ? 'discover' : 'following';
  return (
    <section aria-labelledby="home-title">
      <div style={pageHeader}>
        <h1 id="home-title" className="sr-only">Home</h1>
        <Tabs label="Feed" idPrefix="home" value={tab} onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
          tabs={[{ id: 'following', label: 'Following' }, { id: 'discover', label: 'Discover' }]} />
      </div>
      <div id="home-panel" role="tabpanel" aria-labelledby={`home-${tab}`}>
        {tab === 'following' && <><Composer mode="post" /><NewPostsPill /></>}
        <FeedList key={tab} queryKey={['feed', tab]} path={`/feed?tab=${tab}`} empty={tab === 'following'
          ? <EmptyState icon={<Users size={32} />} title="Your feed is quiet" body="Follow people to see their posts here." action={<Link to="/?tab=discover" style={{ color: 'var(--accent)' }}>Find people in Discover</Link>} />
          : <EmptyState icon={<Compass size={32} />} title="Nothing new to discover" body="Check back soon — or start a conversation yourself." />} />
      </div>
    </section>
  );
}
