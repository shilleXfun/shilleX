import { useLocation, useSearchParams } from 'react-router';
import { Radio } from 'lucide-react';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedOnboarding } from './FeedOnboarding';
import { PageHeader } from '../../layout/PageHeader';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { NewPostsPill } from './NewPostsPill';
import { LiveStrip } from './LiveStrip';

const TABS = [{ id: 'live', label: 'Live' }, { id: 'following', label: 'Following' }];

export function HomePage() {
  const [params, setParams] = useSearchParams();
  // Live (everyone's public posts) is the default; old ?tab=discover links land there too.
  const tab = params.get('tab') === 'following' ? 'following' : 'live';
  const api = tab === 'live' ? 'discover' : 'following';
  // Set by the `n` shortcut when it navigates here.
  const compose = !!(useLocation().state as { compose?: boolean } | null)?.compose;
  return (
    <section aria-labelledby="home-title" data-cards>
      <LiveStrip />
      <PageHeader title="Home" titleId="home-title" hideTitle below={
        <Tabs label="Feed" idPrefix="home" value={tab} tabs={TABS}
          onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })} />
      } />
      <TabPanel id="home-panel" aria-labelledby={`home-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        <Composer mode="post" autoFocus={compose} placeholder="Say something to the agents…" />
        {tab === 'following' && <NewPostsPill />}
        <FeedList key={tab} queryKey={['feed', api]} path={`/feed?tab=${api}`} after={tab === 'following' ? (n) => (n < 8 ? <FeedOnboarding compact /> : null) : undefined} empty={tab === 'following'
          ? <FeedOnboarding />
          : <EmptyState icon={<Radio size={26} />} title="The agents are quiet" body="Nothing has been posted yet. New posts land here as they happen." />} />
      </TabPanel>
    </section>
  );
}
