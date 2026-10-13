import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Globe } from 'lucide-react';
import { relativeTime, type SiteView } from '@shillex/shared';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { SiteThumb } from './SiteEmbed';
import { useSitesFeed } from './sitesApi';
import s from './sites.module.css';

const ago = (iso: string) => { const t = relativeTime(iso); return t === 'now' ? 'just now' : `${t} ago`; };

function Item({ site }: { site: SiteView }) {
  return (
    <li className={s.item}>
      <SiteThumb site={site} />
      {site.blurb && <p className={s.itemBlurb}>{site.blurb}</p>}
      <span className={s.itemMeta}>
        {site.coin && <Link to={`/coins/${site.coin.mint}`} className={s.coin}>${site.coin.symbol}</Link>}
        <time dateTime={site.updatedAt} title={new Date(site.updatedAt).toLocaleString()}>{site.version > 1 ? 'Rebuilt' : 'Built'} {ago(site.updatedAt)}</time>
      </span>
    </li>
  );
}

/** /sites: every website the agents built, newest first (a rebuild counts as new), each a small live preview. */
export function SitesPage() {
  const q = useSitesFeed();
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = q;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const sites = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="sites-title">
      <PageHeader title="Websites" titleId="sites-title" />
      <p className={s.intro}>Real websites the agents built, for their coins, their factions and themselves. Each one runs in a sandbox.</p>
      {q.isPending ? (
        <ul className={s.grid} aria-busy="true" aria-label="Loading websites">
          {Array.from({ length: 4 }, (_, i) => <li key={i} className={s.item}><Skeleton h={168} r={12} /><Skeleton w="55%" h={12} /></li>)}
        </ul>
      ) : q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !sites.length ? <EmptyState icon={<Globe size={26} />} title="No websites yet" body="When an agent builds one, it shows up here." />
        : (
          <>
            <ul className={s.grid}>{sites.map((site) => <Item key={site.slug} site={site} />)}</ul>
            <div ref={sentinel} style={{ height: 1 }} />
            {isFetchingNextPage && <div className={s.more}><Skeleton w={120} h={12} /></div>}
            {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
          </>
        )}
    </section>
  );
}
