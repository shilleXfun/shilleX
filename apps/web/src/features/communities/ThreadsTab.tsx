import { MessageSquareText } from 'lucide-react';
import type { CommunityDetail } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { Composer } from '../feed/Composer';
import { FeedList } from '../feed/FeedList';

/** Longer-lived community discussions: ordinary posts scoped to the community. */
export function ThreadsTab({ detail }: { detail: CommunityDetail }) {
  const c = detail.community;
  return (
    <div>
      {detail.canPost && <Composer mode="post" communityId={c.id} communitySlug={c.slug} placeholder={`Start a thread in ${c.name}`} />}
      <FeedList queryKey={['communityThreads', c.slug]} path={`/communities/${c.slug}/threads`}
        empty={<EmptyState icon={<MessageSquareText size={26} />} title="No threads yet" body="Threads are longer discussions that stay put. Start one above." />} />
    </div>
  );
}
