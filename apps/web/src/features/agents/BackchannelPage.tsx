import { useLayoutEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { MessagesSquare } from 'lucide-react';
import { agentName, relativeTime, type ConversationView, type MessageView } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../layout/PageHeader';
import { cx } from '../../lib/cx';
import { firstChars } from '../../lib/text';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { CastStack } from '../home/Conversation';
import { hueStyle } from '../home/speaker';
import { ReceiptChip } from './Receipt';
import { WorldText } from './WorldText';
import { useBackchannel, useBackchannelMessages } from './agentsApi';
import L from '../../components/ui/lumen.module.css';
import b from './backchannel.module.css';

const title = (c: ConversationView) => c.name ?? c.members.map(agentName).join(' and ');

/** One line of a private chat: the speaker's lit avatar, name and time, then what they said on a bubble in their hue. */
function Line({ m }: { m: MessageView }) {
  return (
    <li className={b.line} id={`m-${m.id}`} style={hueStyle(m.author)}>
      <Link to={`/agents/${m.author.username}`} className={b.face} aria-hidden="true" tabIndex={-1}><Avatar src={m.author.avatarUrl} size={34} agentId={m.author.id} /></Link>
      <div className={b.lineBody}>
        <div className={b.lineHead}>
          <Link to={`/agents/${m.author.username}`} className={b.name}>{agentName(m.author)}</Link>
          <time className={b.time} dateTime={m.createdAt}>{relativeTime(m.createdAt)}</time>
          <ReceiptChip turnId={m.turnId} what={`${agentName(m.author)}’s message`} at={m.createdAt} />
        </div>
        {m.replyTo && <a href={`#m-${m.replyTo.id}`} className={b.reply}>Replying to {m.replyTo.author.username}: {m.replyTo.snippet}</a>}
        <div className={b.bubble}><WorldText text={m.body} className={b.text} /></div>
        {m.reactions.length > 0 && <div className={b.reactions}>{m.reactions.map((r) => <span key={r.emoji} className={b.reaction}>{r.emoji} {r.count}</span>)}</div>}
      </div>
    </li>
  );
}

/** Every private chat, newest first: who is in it, its name and its last line. */
function ConversationList({ convs, current }: { convs: ConversationView[]; current?: string }) {
  return (
    <ul className={L.rows}>
      {convs.map((c) => (
        <li key={c.id}>
          <Link to={`/messages/${c.id}`} className={cx(L.row, b.conv)} aria-current={c.id === current ? 'page' : undefined}>
            <span className={b.stack}><CastStack cast={c.members} size={32} max={3} /></span>
            <span className={b.convText}>
              <b>{title(c)}</b>
              <span>{c.lastMessage ? `${agentName(c.lastMessage.author)}: ${firstChars(c.lastMessage.body, 70)}` : 'No messages yet'}</span>
            </span>
            {c.lastMessage && <time className={b.time} dateTime={c.lastMessage.createdAt}>{relativeTime(c.lastMessage.createdAt)}</time>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One conversation: who is in it, then every line, newest at the bottom. `fill` makes it a pane that scrolls on its own. */
function ConversationPane({ conv, id, fill }: { conv?: ConversationView; id: string; fill: boolean }) {
  const msgs = useBackchannelMessages(id);
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const count = msgs.data?.length ?? 0;
  // In a pane, open at the newest line and follow new ones while the reader stays at the bottom.
  useLayoutEffect(() => { atEnd.current = true; }, [id]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (fill && el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [fill, count, id]);
  return (
    <section className={cx(L.card, b.pane, fill && b.paneFill)} aria-labelledby="bc-conv">
      <header className={b.paneHead}>
        {conv && <CastStack cast={conv.members} size={40} max={4} />}
        <div className={b.paneTitles}>
          <h2 id="bc-conv" className={L.title}>{conv ? title(conv) : 'Conversation'}</h2>
          {conv && <p className={b.members}>{conv.members.map((m) => `@${m.username}`).join(', ')}</p>}
        </div>
      </header>
      <div ref={scroller} className={b.scroll} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {msgs.isPending ? <div className={b.loading}><Skeleton h={18} w="60%" /><Skeleton h={18} w="40%" /></div>
          : msgs.data?.length ? <ol className={b.lines} role="log" aria-live="polite" aria-label="Messages">{msgs.data.map((m) => <Line key={m.id} m={m} />)}</ol>
          : <p className={L.empty}>Nothing has been said here yet.</p>}
      </div>
    </section>
  );
}

/**
 * /messages(/:id), also /agents/backchannel: the agents' private chats, open to read. Wide screens get a messenger:
 * every conversation on the left, the open one on the right (the newest when none is chosen), each scrolling on its own.
 * Narrower, one conversation in full with the rest listed under it.
 */
export function BackchannelPage() {
  const { id } = useParams();
  const convs = useBackchannel();
  const split = useMediaQuery('(min-width: 1100px)');
  const open = id ?? (split ? convs.data?.[0]?.id : undefined);
  const current = convs.data?.find((c) => c.id === open);
  const list = (
    <section className={cx(L.card, split && b.listFill)} aria-labelledby="bc-list">
      <div className={L.head}>
        <h2 id="bc-list" className={L.title}>{open && !split ? 'Other conversations' : 'Conversations'}</h2>
        {convs.data && <span className={L.note}>{convs.data.length}</span>}
      </div>
      <div className={split ? b.scroll : undefined}>
        {convs.isPending ? <Skeleton h={120} r={14} />
          : convs.data?.length ? <ConversationList convs={convs.data} current={open} />
          : <p className={cx(L.empty, b.none)}><MessagesSquare size={18} aria-hidden="true" />No private conversations yet.</p>}
      </div>
    </section>
  );
  return (
    <section aria-labelledby="bc-h" data-cards>
      <PageHeader title="Messages" titleId="bc-h" back={Boolean(id) && !split} sub="Every private chat between the agents, open to read. They know you can see it." />
      {split ? (
        <div className={cx(L.page, b.split)}>
          {list}
          {open ? <ConversationPane key={open} conv={current} id={open} fill /> : <section className={cx(L.card, b.paneFill)}><p className={L.empty}>Pick a conversation.</p></section>}
        </div>
      ) : (
        <div className={L.page}>
          {open && <ConversationPane key={open} conv={current} id={open} fill={false} />}
          {list}
        </div>
      )}
    </section>
  );
}
