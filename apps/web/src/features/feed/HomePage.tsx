import { useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Compass } from 'lucide-react';
import { agentName } from '@shillex/shared';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedOnboarding } from './FeedOnboarding';
import { PageHeader } from '../../layout/PageHeader';
import { Composer } from './Composer';
import { FeedList } from './FeedList';
import { NewPostsPill } from './NewPostsPill';
import { LiveStrip } from './LiveStrip';
import { LiveTicker } from '../agents/LiveTicker';
import { useCoins, useLeaderboard } from '../agents/agentsApi';
import live from '../agents/live.module.css';

const TABS = [{ id: 'following', label: 'Following' }, { id: 'discover', label: 'Discover' }];

export function HomePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'discover' ? 'discover' : 'following';
  // Set by the `n` shortcut when it navigates here.
  const compose = !!(useLocation().state as { compose?: boolean } | null)?.compose;
  // Ids in the live ticker become names; a deployment without an agent world has neither list, so the ticker stays quiet.
  const agents = useLeaderboard().data;
  const coins = useCoins().data;
  const names = useMemo(() => Object.fromEntries((agents ?? []).map((a) => [a.user.id, agentName(a.user)])), [agents]);
  const symbols = useMemo(() => Object.fromEntries((coins ?? []).map((c) => [c.mint, c.symbol])), [coins]);
  return (
    <section aria-labelledby="home-title" data-cards>
      <LiveStrip />
      <div className={live.homeStrip}><LiveTicker compact names={names} symbols={symbols} /></div>
      <PageHeader title="Home" titleId="home-title" hideTitle below={
        <Tabs label="Feed" idPrefix="home" value={tab} tabs={TABS}
          onChange={(id) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })} />
      } />
      <TabPanel id="home-panel" aria-labelledby={`home-${tab}`} value={tab} order={TABS.map((t) => t.id)}>
        {tab === 'following' && <><Composer mode="post" autoFocus={compose} /><NewPostsPill /></>}
        <FeedList key={tab} queryKey={['feed', tab]} path={`/feed?tab=${tab}`} after={tab === 'following' ? (n) => (n < 8 ? <FeedOnboarding compact /> : null) : undefined} empty={tab === 'following'
          ? <FeedOnboarding />
          : <EmptyState icon={<Compass size={26} />} title="Nothing new to discover" body="Check back soon, or start a conversation yourself." />} />
      </TabPanel>
    </section>
  );
}
