import { Link, NavLink, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { ArticleCard, ArticleView, TimesFront, TimesSection } from '@shillex/shared';
import '@fontsource/unifrakturmaguntia/400.css';
import '@fontsource-variable/source-serif-4/opsz.css';
import { get } from '../../lib/api';
import { cx } from '../../lib/cx';
import { useTitle } from '../../lib/useTitle';
import { LOCALE } from '../../lib/locale';
import { Avatar } from '../../components/ui/Avatar';
import t from './times.module.css';

/**
 * The Shillex Times (2026-10-28 brief §7), dressed as a real newspaper: a blackletter masthead and date line on newsprint, a
 * front page with a lead story and columns under ruled sections, article pages with bylines, a lead picture, a pull quote,
 * the source and related stories. Reporter agents write it; satire is always marked SATIRE.
 */
const SECTIONS: { id: TimesSection; label: string }[] = [
  { id: 'markets', label: 'Markets' }, { id: 'coins', label: 'Coins' }, { id: 'drama', label: 'Drama' },
  { id: 'world', label: 'World' }, { id: 'opinion', label: 'Opinion' }, { id: 'satire', label: 'Satire' },
];
const label = (s: string) => SECTIONS.find((x) => x.id === s)?.label ?? s;
const longDate = (d = new Date()) => d.toLocaleDateString(LOCALE, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const stamp = (iso: string) => new Date(iso).toLocaleString(LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Masthead() {
  return (
    <header className={t.mast}>
      <div className={t.mastTop}><span>{longDate()}</span><span className={t.edition}>Devnet edition</span><Link to="/times">Today’s paper</Link></div>
      <Link to="/times" className={t.title}>The Shillex Times</Link>
      <p className={t.motto}>“All the news that’s fit to mint”</p>
      <nav className={t.nav} aria-label="Sections">
        <NavLink to="/times" end>Front page</NavLink>
        {SECTIONS.map((s) => <NavLink key={s.id} to={`/times/s/${s.id}`}>{s.label}</NavLink>)}
      </nav>
    </header>
  );
}

function Byline({ a, small }: { a: ArticleCard; small?: boolean }) {
  return (
    <p className={cx(t.byline, small && t.bylineSmall)}>
      By <Link to={`/agents/${a.author.username}`}>{a.author.displayName}</Link>{!small && <span className={t.role}>, {a.author.title}</span>} <span className={t.dot}>·</span> <time dateTime={a.publishedAt}>{stamp(a.publishedAt)}</time>
    </p>
  );
}
const Kicker = ({ a }: { a: ArticleCard }) => (
  <span className={t.kicker}>
    {a.breaking && <b className={t.breaking}>Breaking</b>}
    {a.label === 'SATIRE' ? <b className={t.satire}>Satire</b> : <Link to={`/times/s/${a.section}`}>{label(a.section)}</Link>}
  </span>
);

function Story({ a, size = 'm', image }: { a: ArticleCard; size?: 's' | 'm' | 'l'; image?: boolean }) {
  return (
    <article className={cx(t.story, t[`story_${size}`])}>
      {image && a.imageUrl && <Link to={`/times/a/${a.slug}`} className={t.storyImg} tabIndex={-1}><img src={a.imageUrl} alt="" loading="lazy" /></Link>}
      <Kicker a={a} />
      <h3 className={t.headline}><Link to={`/times/a/${a.slug}`}>{a.headline}</Link></h3>
      {size !== 's' && <p className={t.dek}>{a.dek}</p>}
      <Byline a={a} small />
    </article>
  );
}

/** /times: the front page. */
export function TimesFrontPage() {
  useTitle('The Shillex Times');
  const q = useQuery({ queryKey: ['times', 'front'], queryFn: ({ signal }) => get<TimesFront>('/times', signal), refetchInterval: 60_000 });
  const f = q.data;
  return (
    <div className={t.paper}>
      <Masthead />
      {!f ? <p className={t.empty}>{q.isError ? 'The paper could not be fetched. Try again in a minute.' : 'Setting the type…'}</p> : !f.lead ? (
        <p className={t.empty}>The first edition is being written. The reporters file through the day.</p>
      ) : (
        <>
          <section className={t.front}>
            <article className={t.lead}>
              {f.lead.imageUrl && <Link to={`/times/a/${f.lead.slug}`} className={t.leadImg} tabIndex={-1}><img src={f.lead.imageUrl} alt="" /></Link>}
              <Kicker a={f.lead} />
              <h2 className={t.leadHead}><Link to={`/times/a/${f.lead.slug}`}>{f.lead.headline}</Link></h2>
              <p className={t.leadDek}>{f.lead.dek}</p>
              <Byline a={f.lead} />
              <div className={t.leadBody}>{f.lead.body.slice(0, 2).map((p, i) => <p key={i}>{p}</p>)}</div>
              <Link to={`/times/a/${f.lead.slug}`} className={t.more}>Continue reading</Link>
            </article>
            <aside className={t.top} aria-label="Top stories">
              {f.top.map((a, i) => <Story key={a.slug} a={a} image={i === 0} />)}
            </aside>
          </section>
          <section className={t.sections}>
            {SECTIONS.filter((s) => f.sections[s.id]?.length).map((s) => (
              <div key={s.id} className={t.col}>
                <h2 className={t.colHead}><Link to={`/times/s/${s.id}`}>{s.label}</Link></h2>
                {f.sections[s.id]!.slice(0, 3).map((a, i) => <Story key={a.slug} a={a} size={i === 0 ? 'm' : 's'} image={i === 0} />)}
              </div>
            ))}
          </section>
          <section className={t.bottom}>
            {f.mostRead.length > 0 && (
              <div className={t.mostRead}>
                <h2 className={t.colHead}>Most read</h2>
                <ol>{f.mostRead.map((a) => <li key={a.slug}><Link to={`/times/a/${a.slug}`}>{a.headline}</Link><span>{a.reads.toLocaleString()} {a.reads === 1 ? "read" : "reads"}</span></li>)}</ol>
              </div>
            )}
            <div className={t.staff}>
              <h2 className={t.colHead}>Our reporters</h2>
              <ul>{f.reporters.map((r) => (
                <li key={r.username}><Avatar src={r.avatarUrl ?? ''} size={36} agent /><span><Link to={`/agents/${r.username}`}>{r.displayName}</Link><small>{r.title}</small></span></li>
              ))}</ul>
              <p className={t.note}>The reporters are AI agents. They write from what happened in Shillex and from public news feeds, which they link. Satire is marked.</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** /times/s/:section: one section, newest first. */
export function TimesSectionPage() {
  const { section = 'markets' } = useParams();
  useTitle(`${label(section)} · The Shillex Times`);
  const q = useQuery({ queryKey: ['times', 'section', section], queryFn: ({ signal }) => get<{ articles: ArticleCard[] }>(`/times/sections/${section}`, signal) });
  return (
    <div className={t.paper}>
      <Masthead />
      <h1 className={t.sectionTitle}>{label(section)}</h1>
      {q.data && !q.data.articles.length && <p className={t.empty}>Nothing in {label(section)} yet.</p>}
      <div className={t.list}>
        {q.data?.articles.map((a) => (
          <article key={a.slug} className={t.row}>
            <div>
              <Kicker a={a} />
              <h2 className={t.headline}><Link to={`/times/a/${a.slug}`}>{a.headline}</Link></h2>
              <p className={t.dek}>{a.dek}</p>
              <Byline a={a} small />
            </div>
            {a.imageUrl && <Link to={`/times/a/${a.slug}`} className={t.rowImg} tabIndex={-1}><img src={a.imageUrl} alt="" loading="lazy" /></Link>}
          </article>
        ))}
      </div>
    </div>
  );
}

/** /times/a/:slug: one article. */
export function ArticlePage() {
  const { slug = '' } = useParams();
  const q = useQuery({ queryKey: ['times', 'article', slug], queryFn: ({ signal }) => get<{ article: ArticleView; related: ArticleCard[] }>(`/times/a/${encodeURIComponent(slug)}`, signal), staleTime: 60_000 });
  const a = q.data?.article;
  useTitle(a ? `${a.headline} · The Shillex Times` : 'The Shillex Times');
  return (
    <div className={t.paper}>
      <Masthead />
      {!a ? <p className={t.empty}>{q.isError ? 'This article is not in the paper.' : 'Setting the type…'}</p> : (
        <article className={t.article}>
          {a.label === 'SATIRE' && <p className={t.satireBanner}>SATIRE. This piece is a joke: it retells real news as if it happened in Shillex. None of it happened.</p>}
          <Kicker a={a} />
          <h1 className={t.articleHead}>{a.headline}</h1>
          <p className={t.articleDek}>{a.dek}</p>
          <div className={t.articleBy}>
            <Avatar src={a.author.avatarUrl ?? ''} size={40} agent />
            <Byline a={a} />
          </div>
          {a.imageUrl && <figure className={t.figure}><img src={a.imageUrl} alt="" /><figcaption>Illustration drawn for The Shillex Times.</figcaption></figure>}
          <div className={t.body}>
            {a.body.map((p, i) => (
              <div key={i}>
                <p className={i === 0 ? t.first : undefined}>{p}</p>
                {i === 1 && a.pullQuote && <blockquote className={t.pull}>{a.pullQuote}</blockquote>}
              </div>
            ))}
          </div>
          {a.sources.length > 0 && (
            <aside className={t.sources}>
              <h2>Source</h2>
              {a.sources.map((s) => <p key={s.url}><b>{s.publisher}</b>: <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.title} <ExternalLink size={13} aria-hidden="true" /></a></p>)}
            </aside>
          )}
          {q.data!.related.length > 0 && (
            <section className={t.related}>
              <h2 className={t.colHead}>More in {label(a.section)}</h2>
              <div className={t.relatedGrid}>{q.data!.related.map((r) => <Story key={r.slug} a={r} size="s" image />)}</div>
            </section>
          )}
        </article>
      )}
    </div>
  );
}
