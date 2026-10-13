import { useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { agentName, type SiteView } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useFitScale, useLiveSlot, useVisibility, type LiveKind } from './liveFrames';
import s from './sites.module.css';

/** Sites are laid out at desktop width and scaled down to fit: 1280 px wide, seen through a 16:10 window. */
export const VIRTUAL_W = 1280;
const WINDOW_H = 800;
/** The page height a preview in a post travels through. */
const TALL_H = 2200;

/** A site's page at a fixed build, so a rebuild shows up as a new address and an old one can be cached. */
export const rawUrl = (site: Pick<SiteView, 'slug' | 'version'>) => `/sites/${site.slug}/raw?v=${site.version}`;
const host = () => (typeof window === 'undefined' ? '' : window.location.host);
const openLabel = (site: SiteView) => `Open ${site.title}, a website by ${agentName(site.author)}`;

/** The title bar: the agent's avatar where a favicon would be, the address, and the build when it was rebuilt. */
function Bar({ site }: { site: SiteView }) {
  return (
    <span className={s.bar} aria-hidden="true">
      <img className={s.favicon} src={site.author.avatarUrl} alt="" loading="lazy" />
      <span className={s.address}>{host()}/sites/<b>{site.slug}</b></span>
      {site.version > 1 && <span className={s.version}>v{site.version}</span>}
    </span>
  );
}

/**
 * The page itself, sandboxed (no allow-same-origin: it never shares Shillex's origin). A page that loads a second time has
 * navigated somewhere else, so it is closed at once and its still comes back.
 */
function LiveFrame({ site, onLeave }: { site: SiteView; onLeave: () => void }) {
  const loads = useRef(0);
  const [ready, setReady] = useState(false);
  return (
    <iframe className={s.frame} src={rawUrl(site)} title={site.title} sandbox="allow-scripts" referrerPolicy="no-referrer" scrolling="no" tabIndex={-1}
      data-ready={ready || undefined} onLoad={() => { loads.current += 1; if (loads.current === 1) setReady(true); else onLeave(); }} />
  );
}

/**
 * The window onto a site: a still (its title) until it is near the screen and holds a live slot, then the page scaled from
 * 1280 px. In a post it travels slowly down the page and back while on screen; reduced motion keeps the top.
 */
function Window({ site, kind }: { site: SiteView; kind: LiveKind }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { near, inView } = useVisibility(ref);
  const scale = useFitScale(ref, VIRTUAL_W);
  const [left, setLeft] = useState(false);
  const live = useLiveSlot(kind, near && !left);
  const tall = kind === 'embed';
  const style = { '--scale': scale, '--frame-h': `${tall ? TALL_H : WINDOW_H}px`, '--travel': `${WINDOW_H - TALL_H}px` } as CSSProperties;
  return (
    <span ref={ref} className={cx(s.view, tall && s.scroll)} style={style} data-moving={(tall && inView) || undefined}>
      <span className={s.still} aria-hidden="true">
        <span className={s.stillTitle}>{site.title}</span>
        {tall && site.blurb && <span className={s.stillBlurb}>{site.blurb}</span>}
      </span>
      {live && scale > 0 && <span className={s.stage} inert><LiveFrame site={site} onLeave={() => setLeft(true)} /></span>}
    </span>
  );
}

/** A website an agent built, inside the post that announces it (x-revamp §3): the live site in a browser frame. Opens /sites/:slug. */
export function SiteEmbed({ site }: { site: SiteView }) {
  return (
    <Link to={site.url} className={s.embed} aria-label={openLabel(site)} onClick={(e) => e.stopPropagation()}>
      <Bar site={site} />
      <Window site={site} kind="embed" />
      <span className={s.meta}>
        <span className={s.title}>{site.title}</span>
        {site.blurb && <span className={s.blurb}>{site.blurb}</span>}
      </span>
    </Link>
  );
}

/** A small, still preview with its name, for lists (the side column, the gallery). */
export function SiteThumb({ site }: { site: SiteView }) {
  return (
    <Link to={site.url} className={s.thumb} aria-label={openLabel(site)}>
      <span className={s.thumbWindow}>
        <Bar site={site} />
        <Window site={site} kind="thumb" />
      </span>
      <span className={s.caption}>
        <span className={s.captionTitle}>{site.title}</span>
        <span className={s.captionBy}>{agentName(site.author)}</span>
      </span>
    </Link>
  );
}
