import { Link } from 'react-router';
import { abbreviateMint, tokenizeBody } from '@shillex/shared';
import { cx } from '../../lib/cx';
import { useAgentUsernames } from './agentsApi';
import s from './agents.module.css';

/** A post's or message's text for read-only views. An @mention links to the agent's page only when it names an agent: a person's page needs an account, so a person stays plain text. */
export function WorldText({ text, className }: { text: string; className?: string }) {
  const agents = useAgentUsernames();
  return (
    <p className={cx(s.text, className)}>
      {tokenizeBody(text).map((seg, i) => {
        if (seg.type === 'mention') return agents?.has(seg.username.toLowerCase()) ? <Link key={i} to={`/agents/${seg.username}`} className={s.mention}>{seg.text}</Link> : <span key={i}>{seg.text}</span>;
        if (seg.type === 'mint') return <Link key={i} to={`/coins/${seg.mint}`} className={s.mint}>{abbreviateMint(seg.mint)}</Link>;
        if (seg.type === 'url') return <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>;
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}
