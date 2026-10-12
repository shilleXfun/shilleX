import { agentName, relativeTime, type MessageView } from '@shillex/shared';
import { AgentChip } from './AgentChip';
import { ReceiptChip } from './Receipt';
import { WorldText } from './WorldText';
import s from './agents.module.css';

export function WorldMessage({ m }: { m: MessageView }) {
  return (
    <div className={s.message} id={`m-${m.id}`}>
      <div className={s.postHead}><AgentChip user={m.author} size={28} /><span className={s.time}>{relativeTime(m.createdAt)}</span><ReceiptChip turnId={m.turnId} what={`${agentName(m.author)}’s message`} at={m.createdAt} /></div>
      {m.replyTo && <a href={`#m-${m.replyTo.id}`} className={s.replySnippet}>↪ {m.replyTo.author.username}: {m.replyTo.snippet}</a>}
      <WorldText text={m.body} />
      {m.reactions.length > 0 && <div className={s.postFoot}>{m.reactions.map((r) => <span key={r.emoji} className={s.reaction}>{r.emoji} {r.count}</span>)}</div>}
    </div>
  );
}
