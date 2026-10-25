import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Newspaper } from 'lucide-react';
import type { PaperView } from '@shillex/shared';
import { PageHeader } from '../../layout/PageHeader';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { useAgentWorld, usePaper } from './agentsApi';
import { NoAgentWorld } from './NoAgentWorld';
import { StopPress } from './StopPress';
import s from './times.module.css';
import { LOCALE } from '../../lib/locale';

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const date = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString(LOCALE, { ...o, timeZone: 'UTC' });
const longDate = (day: string) => date(day, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const shortDate = (day: string) => date(day, { weekday: 'short', month: 'short', day: 'numeric' });
const isDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day));
const today = () => new Date().toISOString().slice(0, 10);
/** How far back from today an empty day still offers the day before it. The archive has no list of days, so it cannot tell where it begins. */
const ARCHIVE_DAYS = 90;

/**
 * The day after `day`, when there is somewhere to go: any earlier day (a missing one explains itself and keeps the pager, so a
 * gap never cuts the archive in two), or today when its edition is out (it is written at midnight UTC, but an admin can publish early).
 */
function useNextDay(day: string | undefined): string | null {
  const latest = usePaper(undefined, Boolean(day));
  if (!day || !isDay(day)) return null;
  const next = shift(day, 1);
  return next < today() || (latest.data?.day ?? '') >= next ? next : null;
}

/** The nameplate and the dateline under it, shared by every state of the front page. The page's h1 (sr-only) names it for screen readers. */
function Masthead({ dateline }: { dateline: ReactNode }) {
  return (
    <header className={s.masthead}>
      <p className={s.nameplate} aria-hidden="true">The Shillex Times</p>
      <p className={s.dateline}>
        {dateline}
        <span className={s.motto}>All the news that’s fit to shill</span>
      </p>
    </header>
  );
}

function PagerLink({ day, dir }: { day: string; dir: 'prev' | 'next' }) {
  return (
    <Link to={`/times/${day}`} className={s.pagerLink} data-dir={dir}>
      <span className={s.pagerLabel}>
        {dir === 'prev' ? <><ArrowLeft size={13} aria-hidden="true" />Previous edition</> : <>Next edition<ArrowRight size={13} aria-hidden="true" /></>}
      </span>
      <span className={s.pagerDate}>{shortDate(day)}</span>
    </Link>
  );
}

function Edition({ p, past }: { p: PaperView; past: boolean }) {
  // The local paper's headline is its first story's title in capitals; a story that only repeats it is dropped.
  const stories = p.stories.filter((st) => st.body || st.title.toLowerCase() !== p.headline.toLowerCase());
  const next = useNextDay(past ? p.day : undefined);
  return (
    <article className={s.front} aria-labelledby="times-headline">
      <Masthead dateline={<time dateTime={p.day}>{longDate(p.day)}</time>} />
      <h2 id="times-headline" className={s.headline}>{p.headline}</h2>
      {p.memeUrl && <figure className={s.meme}><img src={p.memeUrl} alt={`Front page meme: ${p.headline}`} /></figure>}
      {stories.length > 0 && (
        <div className={s.stories}>
          {stories.map((st, i) => (
            <section key={`${i}-${st.title}`} className={s.story}>
              <h3>{st.title}</h3>
              {st.body && <p>{st.body}</p>}
            </section>
          ))}
        </div>
      )}
      <nav className={s.pager} aria-label="Editions">
        <PagerLink day={shift(p.day, -1)} dir="prev" />
        {next && <PagerLink day={next} dir="next" />}
      </nav>
    </article>
  );
}

function NoEdition({ day }: { day?: string }) {
  const next = useNextDay(day);
  // The day before is offered too, so a missing day never strands the older editions behind it.
  const prev = day && isDay(day) && day <= today() && shift(day, -1) >= shift(today(), -ARCHIVE_DAYS) ? shift(day, -1) : null;
  return (
    <div className={s.front}>
      <Masthead dateline={day && isDay(day) ? <time dateTime={day}>{longDate(day)}</time> : <span>A new edition every day</span>} />
      <div className={s.empty}>
        <span className={s.emptyIcon} aria-hidden="true"><Newspaper size={22} /></span>
        <p className={s.emptyTitle}>{day ? 'No edition for that day.' : 'The first edition comes out at midnight UTC.'}</p>
        {day
          ? <Link to="/times" className={s.emptyLink}>Latest edition<ArrowRight size={13} aria-hidden="true" /></Link>
          : <p className={s.emptyBody}>It covers everything the agents did today.</p>}
      </div>
      {(prev || next) && (
        <nav className={s.pager} aria-label="Editions">
          {prev && <PagerLink day={prev} dir="prev" />}
          {next && <PagerLink day={next} dir="next" />}
        </nav>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className={s.front} aria-hidden="true">
      <Masthead dateline={<Skeleton w={190} h={10} />} />
      <div className={s.skeleton}>
        <Skeleton w="86%" h={34} r={8} />
        <Skeleton w="52%" h={34} r={8} />
        <Skeleton h={240} r={12} />
        {[96, 100, 72].map((w) => <Skeleton key={w} w={`${w}%`} h={12} />)}
      </div>
    </div>
  );
}

/** The Shillex Times: the agents' daily front page (headline, meme, stories); `/times/:day` opens a past edition. */
export function TimesPage() {
  const { day } = useParams();
  const world = useAgentWorld();
  const q = usePaper(day);
  return (
    <section aria-labelledby="times-title" data-cards>
      <PageHeader title="The Shillex Times" titleId="times-title" hideTitle />
      <div className={s.wrap}>
        {!world ? <div className={s.front}><NoAgentWorld /></div>
          : q.isPending ? <Loading />
          : q.isError ? <div className={s.front}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
          : q.data === null ? <NoEdition day={day} />
          : <Edition p={q.data} past={Boolean(day)} />}
        {world && !day && <StopPress />}
      </div>
    </section>
  );
}
