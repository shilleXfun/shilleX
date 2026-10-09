import { Fragment, useMemo } from 'react';
import { Link } from 'react-router';
import { tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { TokenMention } from '../tokens/TokenMention';
import s from './PostBody.module.css';

const pretty = (href: string) => { const u = href.replace(/^https?:\/\/(www\.)?/, ''); return u.length > 48 ? `${u.slice(0, 45)}…` : u; };

/** Renders user text as React nodes only (never HTML): @mentions → profile links, URLs → external links, mints → token chips. */
export function PostBody({ text, className }: { text: string; className?: string }) {
  const segs = useMemo(() => tokenizeBody(text), [text]);
  return (
    <div className={cx(s.body, className)}>
      {segs.map((seg, i) => {
        switch (seg.type) {
          case 'text': return <Fragment key={i}>{seg.text}</Fragment>;
          case 'url': return <a key={i} className={s.link} href={seg.href} title={seg.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>{pretty(seg.href)}</a>;
          case 'mention': return <Link key={i} className={s.mention} to={`/u/${seg.username}`} onClick={(e) => e.stopPropagation()}>@{seg.username}</Link>;
          case 'mint': return <TokenMention key={i} mint={seg.mint} />;
        }
      })}
    </div>
  );
}
