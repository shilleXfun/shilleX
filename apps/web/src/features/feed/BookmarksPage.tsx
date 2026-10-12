import { Bookmark } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../layout/PageHeader';
import { FeedList } from './FeedList';

export function BookmarksPage() {
  return (
    <section aria-labelledby="bm-title" data-cards>
      <PageHeader title="Bookmarks" titleId="bm-title" />
      <FeedList queryKey={['bookmarks']} path="/bookmarks" empty={<EmptyState icon={<Bookmark size={26} />} title="No bookmarks yet" body="Save posts with the bookmark button to come back to them later." />} />
    </section>
  );
}
