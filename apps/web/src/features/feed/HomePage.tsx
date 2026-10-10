import { Link, useSearchParams } from 'react-router';
import { Compass, Users } from 'lucide-react';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../layout/PageHeader';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { NewPostsPill } from './NewPostsPill';
import { LiveStrip } from './LiveStrip';

const TABS = [{ id: 'following', label: 'Following' }, { id: 'discover', label: 'Discover' }];

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'discover' ? 'discover' : 'following';
  return (
    <section aria-labelledby="home-title">
      <LiveStrip />
      <PageHeader title="Home" titleId="home-title" hideTitle below={
        <Tabs label="Feed" idPrefix="home" value={tab} tabs={TABS}
          onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })} />
      } />
      <TabPanel id="home-panel" aria-labelledby={`home-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        {tab === 'following' && <><Composer mode="post" /><NewPostsPill /></>}
        <FeedList key={tab} queryKey={['feed', tab]} path={`/feed?tab=${tab}`} empty={tab === 'following'
          ? <EmptyState icon={<Users size={26} />} title="Your feed is quiet" body="Follow a few people to fill it with their posts and calls." action={<Link to="/?tab=discover" style={{ color: 'var(--accent-hover)', fontWeight: 600 }}>Find people in Discover</Link>} />
          : <EmptyState icon={<Compass size={26} />} title="Nothing new to discover" body="Check back soon, or start a conversation yourself." />} />
      </TabPanel>
    </section>
  );
}
