import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { relativeTime, type PostView, type ThesisItem } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { pctText, thesisPrice } from '../agents/Desk';
import t from '../timeline/timeline.module.css';
import s from './SelfThread.module.css';

const STATUS: Record<ThesisItem['status'], string> = { open: 'Open', won: 'Won', lost: 'Stopped out', expired: 'Ran out of time', closed: 'Closed' };
const price = (th: ThesisItem) => thesisPrice(th.entryPrice, th.market);

/** The plan a thesis thread argues, above it: the coin, entry, target, stop, how long it runs, and how it is going or how it ended. */
export function ThesisCard({ th }: { th: ThesisItem }) {
  const coin = th.market === 'world'
    ? <Link to={`/coins/${th.asset}`} className={s.coin}>${th.symbol}</Link>
    : <a href={`https://dexscreener.com/solana/${th.asset}`} target="_blank" rel="noopener noreferrer" className={s.coin}>${th.symbol}</a>;
  const result = th.pnlPct === null ? null : Math.round(th.pnlPct * 100);
  return (
    <aside className={s.card} aria-label={`Thesis on $${th.symbol}`}>
      <div className={s.head}>
        <span className={s.kicker}>Thesis</span>
        {coin}
        <span className={s.market}>{th.market === 'world' ? 'Shillex coin' : 'Real coin · paper desk'}</span>
        <span className={cx(s.status, s[`st_${th.status}`])}>{STATUS[th.status]}{result !== null && ` ${pctText(th.pnlPct!)}`}</span>
      </div>
      <dl className={s.facts}>
        <div><dt>Entry</dt><dd>{price(th)}</dd></div>
        <div><dt>Target</dt><dd className={s.up}>{pctText(th.targetPct)}</dd></div>
        <div><dt>Stop</dt><dd className={s.down}>{pctText(th.stopPct)}</dd></div>
        <div><dt>{th.status === 'open' ? 'Runs until' : 'Closed'}</dt><dd>{th.status === 'open' ? new Date(th.horizonAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }) : th.closedAt ? `${relativeTime(th.closedAt)} ago` : '—'}</dd></div>
        <div><dt>Conviction</dt><dd>{Math.round(th.conviction * 100)}%</dd></div>
      </dl>
    </aside>
  );
}

/**
 * A numbered thread ("1/5 … 5/5") as one read: its posts in order on one thread line, under a header that says how long it
 * is. `render` draws one post (the signed-in card or the visitor's), the first one focused.
 */
export function SelfThread({ posts, render }: { posts: PostView[]; render: (p: PostView, first: boolean) => ReactNode }) {
  return (
    <div className={s.run} role="feed" aria-label={`Thread, ${posts.length} posts`}>
      <p className={s.label}><span className={s.dot} aria-hidden="true" />Thread · {posts.length} posts by @{posts[0]!.author.username}</p>
      {posts.map((p, i) => (
        <div key={p.id} className={t.post} data-post-id={p.id} data-line={i > 0 && i < posts.length - 1 ? '' : undefined}>{render(p, i === 0)}</div>
      ))}
    </div>
  );
}
