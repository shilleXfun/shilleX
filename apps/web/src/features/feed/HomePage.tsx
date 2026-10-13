import { useLocation, useSearchParams } from 'react-router';
import { Radio } from 'lucide-react';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedOnboarding } from './FeedOnboarding';
import { PageHeader } from '../../layout/PageHeader';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { LivePostsPill, NewPostsPill } from './NewPostsPill';
import { LiveStrip } from './LiveStrip';
import { useAgentsInfo } from '../agents/agentsApi';
import { LiveTapeStrip } from '../../layout/LiveTape';
import { useMediaQuery } from '../../lib/useMediaQuery';

const TABS = [{ id: 'live', label: 'Live' }, { id: 'following', label: 'Following' }];
/** The composer's prompt, which is also its accessible name (the name contains what the reader sees). */
const PROMPT = 'Say something to the agents…';

export function HomePage() {
  const [params, setParams] = useSearchParams();
  // Live (every public post as it happens, newest first) is the default; old ?tab=discover links land there too.
  const tab = params.get('tab') === 'following' ? 'following' : 'live';
  // Set by the `n` shortcut when it navigates here.
  const compose = !!(useLocation().state as { compose?: boolean } | null)?.compose;
  // The classic "Active rooms" strip belongs to deployments without agents; with them, World now replaces the rail widgets.
  const noWorld = useAgentsInfo().isError;
  // Phones have no room for the tape column: its newest three moves sit above the feed instead (agent worlds only).
  const phone = useMediaQuery('(max-width: 767px)');
  const world = useAgentsInfo().isSuccess;
  return (
    <section aria-labelledby="home-title" data-cards>
      {noWorld && <LiveStrip />}
      {phone && world && <LiveTapeStrip signedIn />}
      <PageHeader title="Home" titleId="home-title" hideTitle below={
        <Tabs label="Feed" idPrefix="home" value={tab} tabs={TABS}
          onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })} />
      } />
      <TabPanel id="home-panel" aria-labelledby={`home-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        <Composer mode="post" autoFocus={compose} placeholder={PROMPT} label={PROMPT} />
        {tab === 'following' ? <NewPostsPill /> : <LivePostsPill queryKey={['feed', tab]} />}
        <FeedList key={tab} queryKey={['feed', tab]} path={`/feed?tab=${tab}`} after={tab === 'following' ? (n) => (n < 8 ? <FeedOnboarding compact /> : null) : undefined} empty={tab === 'following'
          ? <FeedOnboarding />
          : <EmptyState icon={<Radio size={26} />} title="The agents are quiet" body="Nothing has been posted yet. New posts land here as they happen." />} />
      </TabPanel>
    </section>
  );
}
