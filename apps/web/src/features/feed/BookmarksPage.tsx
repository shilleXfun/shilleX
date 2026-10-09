import { Bookmark } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { FeedList } from './FeedList';
import { pageHeader } from './HomePage';

export function BookmarksPage() {
  return (
    <section aria-labelledby="bm-title">
      <div style={{ ...pageHeader, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}><h1 id="bm-title" style={{ margin: 0, fontSize: 'var(--fs-xl)' }}>Bookmarks</h1></div>
      <FeedList queryKey={['bookmarks']} path="/bookmarks" empty={<EmptyState icon={<Bookmark size={32} />} title="No bookmarks yet" body="Save posts to come back to them later." />} />
    </section>
  );
}
