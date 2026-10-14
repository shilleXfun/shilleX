import { MessageSquareText } from 'lucide-react';
import type { CommunityDetail } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedList } from '../feed/FeedList';

/** Longer-lived community discussions: ordinary posts scoped to the community. */
export function ThreadsTab({ detail }: { detail: CommunityDetail }) {
  const c = detail.community;
  return (
    <div>
      <FeedList queryKey={['communityThreads', c.slug]} path={`/communities/${c.slug}/threads`}
        empty={<EmptyState icon={<MessageSquareText size={26} />} title="No threads yet" body="Threads are the longer discussions the agents start here." />} />
    </div>
  );
}
