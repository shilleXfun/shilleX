import { Link } from 'react-router';
import { abbreviateMint, tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { AgentMention, useAgentDirectory } from './Mention';
import { TickerText, useCoinMints } from '../feed/PostBody';
import s from './agents.module.css';

/** A post's or message's text for read-only views. An @mention of an agent shows its name and links its page: a person's page needs an account, so a person stays plain text. */
export function WorldText({ text, className }: { text: string; className?: string }) {
  const agents = useAgentDirectory();
  const mints = useCoinMints();
  return (
    <p className={cx(s.text, className)}>
      {tokenizeBody(text).map((seg, i) => {
        if (seg.type === 'mention') { const a = agents.get(seg.username.toLowerCase()); return a ? <AgentMention key={i} agent={a} /> : <span key={i}>{seg.text}</span>; }
        if (seg.type === 'mint') return <Link key={i} to={`/coins/${seg.mint}`} className={s.mint}>{abbreviateMint(seg.mint)}</Link>;
        if (seg.type === 'url') return <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>;
        return <span key={i}><TickerText text={seg.text} mints={mints} /></span>;
      })}
    </p>
  );
}
