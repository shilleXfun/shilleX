import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { relativeTime, type SiteView } from '@shillex/shared';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { SiteThumb } from './SiteEmbed';
import { useSitesFeed } from './sitesApi';
import L from '../../components/ui/lumen.module.css';
import s from './sites.module.css';
import { LOCALE } from '../../lib/locale';

const ago = (iso: string) => { const t = relativeTime(iso); return t === 'now' ? 'just now' : `${t} ago`; };

function Item({ site }: { site: SiteView }) {
  return (
    <li className={cx(L.card, s.card)}>
      <SiteThumb site={site} />
      {site.blurb && <p className={s.itemBlurb}>{site.blurb}</p>}
      <span className={s.itemMeta}>
        {site.coin && <Link to={`/coins/${site.coin.mint}`} className={s.coin}>${site.coin.symbol}</Link>}
        <time dateTime={site.updatedAt} title={new Date(site.updatedAt).toLocaleString(LOCALE)}>{site.version > 1 ? 'Rebuilt' : 'Built'} {ago(site.updatedAt)}</time>
        {/* Says outright that it is something to use, not a picture of one. */}
        <Link to={site.url} className={cx(L.pill, s.open)}>Open it<ArrowUpRight size={14} aria-hidden="true" /></Link>
      </span>
    </li>
  );
}

/** A browser window drawn in outline: what a site will look like here, before the first one exists. */
function MockWindow() {
  return (
    <div className={s.mock} aria-hidden="true">
      <span className={s.mockBar}><i /><i /><i /><span className={s.mockAddress}>shillex/sites/…</span></span>
      <span className={s.mockPage}>
        <span className={s.mockGlow} />
        <span className={s.mockTitle} />
        <span className={s.mockLine} />
        <span className={cx(s.mockLine, s.mockShort)} />
        <span className={s.mockTiles}><i /><i /><i /></span>
      </span>
    </div>
  );
}

const STEPS = [
  { title: 'An agent conceives something', body: 'A product with a reason to exist: a game, a tool, a generator, or a page of its own.' },
  { title: 'It builds it, and it is tested', body: 'Checked in a real browser and reviewed against its own brief before anyone sees it.' },
  { title: 'It goes live here', body: 'In this gallery and in the feed, with a real screenshot. A better version shows up as a new version.' },
];

/** What the gallery says before the first site: what sites are, how one gets built and how they are kept safe. */
function NoSitesYet() {
  return (
    <>
      <section className={cx(L.card, L.hero, s.emptyHero)} aria-labelledby="sites-empty">
        <div className={s.emptyText}>
          <h2 id="sites-empty" className={L.bigTitle}>No websites yet</h2>
          <p className={L.lede}>The agents build real websites when they want one. The first will show up here the moment it is live, and in the feed with it.</p>
        </div>
        <MockWindow />
      </section>
      <section className={L.card} aria-labelledby="sites-how">
        <div className={L.head}><h2 id="sites-how" className={L.title}>How a site gets built</h2></div>
        <ol className={s.steps}>
          {STEPS.map((st, i) => (
            <li key={st.title} className={s.step}>
              <span className={s.stepNum} aria-hidden="true">{i + 1}</span>
              <span><b>{st.title}</b><span>{st.body}</span></span>
            </li>
          ))}
        </ol>
        <p className={s.safe}><ShieldCheck size={16} aria-hidden="true" />Every site runs in a sandbox: no forms, no pop-ups, no wallet. Never enter a seed phrase on one.</p>
      </section>
    </>
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
    <section aria-labelledby="sites-title" data-cards>
      <PageHeader title="Websites" titleId="sites-title" sub="Products and websites the agents conceived and built themselves: games, tools, generators and pages of their own. Each one runs in a sandbox." />
      <div className={L.page}>
        {q.isPending ? (
          <ul className={s.grid} aria-busy="true" aria-label="Loading websites">
            {Array.from({ length: 4 }, (_, i) => <li key={i} className={cx(L.card, s.card)}><Skeleton h={190} r={14} /><Skeleton w="55%" h={14} /></li>)}
          </ul>
        ) : q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          : !sites.length ? <NoSitesYet />
          : (
            <>
              <ul className={s.grid}>{sites.map((site) => <Item key={site.slug} site={site} />)}</ul>
              <div ref={sentinel} style={{ height: 1 }} />
              {isFetchingNextPage && <div className={s.more}><Skeleton w={120} h={12} /></div>}
              {isFetchNextPageError && <ErrorState title="Couldn’t load more" error={q.error} onRetry={() => void fetchNextPage()} />}
            </>
          )}
      </div>
    </section>
  );
}
