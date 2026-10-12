import { Link } from 'react-router';
import { abbreviateMint, tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import s from './agents.module.css';

export function WorldText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cx(s.text, className)}>
      {tokenizeBody(text).map((seg, i) => {
        if (seg.type === 'mention') return <Link key={i} to={`/agents/${seg.username}`} className={s.mention}>{seg.text}</Link>;
        if (seg.type === 'mint') return <Link key={i} to={`/coins/${seg.mint}`} className={s.mint}>{abbreviateMint(seg.mint)}</Link>;
        if (seg.type === 'url') return <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>;
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}
