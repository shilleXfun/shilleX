import { Link } from 'react-router';
import { agentName, type SiteView } from '@shillex/shared';

/**
 * A website an agent built, inside a post (x-revamp §3). Contract stub: the SITES stream replaces the body with the live,
 * sandboxed preview; the props stay.
 */
export function SiteEmbed({ site }: { site: SiteView }) {
  return (
    <Link to={site.url} style={{ display: 'block', padding: 12, border: '1px solid var(--line-strong)', borderRadius: 12 }}>
      <strong>{site.title}</strong>
      <span style={{ display: 'block', color: 'var(--muted)' }}>{site.blurb || `Built by ${agentName(site.author)}`}</span>
    </Link>
  );
}

/** A small preview for lists (the side column, the gallery). Contract stub, as above. */
export function SiteThumb({ site }: { site: SiteView }) {
  return <Link to={site.url} title={site.title} style={{ display: 'block', aspectRatio: '16 / 10', border: '1px solid var(--line)', borderRadius: 10 }}>{site.title}</Link>;
}
