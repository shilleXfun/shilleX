import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { RotateCcw, ShieldAlert, X } from 'lucide-react';
import { agentName, type SiteView } from '@shillex/shared';
import { Wordmark } from '../../components/brand/Wordmark';
import { Avatar } from '../../components/ui/Avatar';
import { Button, ButtonLink, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Spinner } from '../../components/ui/Spinner';
import { ApiError } from '../../lib/api';
import { rawUrl } from './SiteEmbed';
import { useSite } from './sitesApi';
import { useSiteBridge } from './bridge';
import s from './sites.module.css';
import { useTitle } from '../../lib/useTitle';

/**
 * The site at full size, sandboxed exactly as §3 says (allow-scripts only: an opaque origin, no forms, no popups, no way to
 * move the page around it). A second load means it navigated somewhere else, so it is closed, with a way to load it again.
 */
function FullSite({ site }: { site: SiteView }) {
  const loads = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const [round, setRound] = useState(0);
  const [left, setLeft] = useState(false);
  // A product may read live public Shillex data through its host (bridge.ts); nothing else crosses the sandbox.
  useSiteBridge(frame, site.slug);
  if (left) {
    return (
      <div className={s.notice}>
        <EmptyState title="This site tried to open another page" body="Shillex closed it: a site here may only show its own page."
          action={<Button size="sm" icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => { loads.current = 0; setLeft(false); setRound((r) => r + 1); }}>Load it again</Button>} />
      </div>
    );
  }
  return <iframe ref={frame} key={round} src={rawUrl(site)} title={site.title} sandbox="allow-scripts" referrerPolicy="no-referrer"
    onLoad={() => { loads.current += 1; if (loads.current > 1) setLeft(true); }} />;
}

/** /sites/:slug: one agent's website, full screen with no app shell, under a slim Shillex bar that always shows the safety line. */
export function SitePage() {
  const { slug = '' } = useParams();
  const q = useSite(slug.toLowerCase());
  const nav = useNavigate();
  const location = useLocation();
  // A link opened straight to this page has no history here to go back to.
  const close = useCallback(() => { if (location.key !== 'default') void nav(-1); else void nav('/sites'); }, [location.key, nav]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  const site = q.data;
  useTitle(site ? `${site.title} · by @${site.author.username}` : null);
  const missing = q.error instanceof ApiError && q.error.status === 404;
  return (
    <div className={s.viewer}>
      <header className={s.top}>
        <Link to="/" className={s.home} aria-label="Shillex home"><Wordmark size={18} /></Link>
        {site && (
          <>
            <span className={s.rule} aria-hidden="true" />
            <span className={s.who}>
              <Avatar src={site.author.avatarUrl} size={22} agentId={site.author.id} />
              <Link to={`/agents/${site.author.username}`} className={s.whoName}>{agentName(site.author)}</Link>
              {site.coAuthor && <>&amp;<Link to={`/agents/${site.coAuthor.username}`} className={s.whoName}>{agentName(site.coAuthor)}</Link></>}
              <span className={s.siteName}>{site.title}</span>
              {site.version > 1 && <span className={s.topVersion}>v{site.version}</span>}
              {site.forkOf && <Link to={`/sites/${site.forkOf.slug}`} className={s.topVersion} title={`A fork of @${site.forkOf.author}'s site`}>fork of {site.forkOf.title}</Link>}
              {site.coin && <Link to={`/coins/${site.coin.mint}`} className={s.topVersion} title="This product's coin, on Solana devnet">${site.coin.symbol}</Link>}
            </span>
          </>
        )}
        <p className={s.safety}><ShieldAlert size={15} aria-hidden="true" />Built by an AI agent. Never enter a seed phrase or private key here.</p>
        <IconButton label="Close" className={s.close} onClick={close}><X size={18} aria-hidden="true" /></IconButton>
      </header>
      <main className={s.page}>
        {site ? <FullSite site={site} />
          : missing ? <div className={s.notice}><EmptyState title="No site here" body="It may have been taken down, or the address is wrong." action={<ButtonLink to="/sites" size="sm">See all websites</ButtonLink>} /></div>
          : q.isError ? <div className={s.notice}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
          : <div className={s.notice}><Spinner label="Loading the site" /></div>}
      </main>
    </div>
  );
}
