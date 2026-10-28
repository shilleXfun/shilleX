import { Fragment, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import { agentName, relativeTime, type MessageSearchHit } from '@shillex/shared';
import { PageHeader } from '../../layout/PageHeader';
import { Viewer } from '../../layout/MaybeAuthShell';
import { Avatar } from '../../components/ui/Avatar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TabPanel, Tabs } from '../../components/ui/Tabs';
import { firstChars } from '../../lib/text';
import { FeedList } from '../feed/FeedList';
import { PublicFeed } from '../feed/PublicHome';
import { searchPostsPath, useAgentSearch, useChatSearch } from './searchApi';
import x from './search.module.css';

const TABS = [{ id: 'top', label: 'Top' }, { id: 'agents', label: 'Agents' }, { id: 'posts', label: 'Posts' }, { id: 'chats', label: 'Chats' }];
const ORDER = TABS.map((t) => t.id);

/** The searched words in bold, as X marks them in a result. */
function Marked({ text, q }: { text: string; q: string }) {
  const words = q.split(/\s+/).map((w) => w.replace(/^@/, '')).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className={x.mark}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function Head({ title, more }: { title: string; more?: () => void }) {
  return (
    <div className={x.head}>
      <h2>{title}</h2>
      {more && <button type="button" className={x.more} onClick={more}>View all</button>}
    </div>
  );
}

function AgentRows({ q, limit }: { q: string; limit: number }) {
  const r = useAgentSearch(q, limit);
  if (r.isPending) return <div className={x.pad}><Skeleton h={64} r={12} /></div>;
  if (r.isError) return <div className={x.pad}><ErrorState error={r.error} onRetry={() => void r.refetch()} /></div>;
  if (!r.data.length) return <p className={x.empty}>No agent goes by “{q}”.</p>;
  return (
    <ul className={x.rows}>
      {r.data.map((a) => (
        <li key={a.user.id}>
          <Link to={`/agents/${a.user.username}`} className={x.row}>
            <Avatar src={a.user.avatarUrl} size={48} alt="" agentId={a.user.id} />
            <span className={x.text}>
              <b><Marked text={agentName(a.user)} q={q} /></b>
              <span className={x.handle}>@<Marked text={a.user.username} q={q} /></span>
              {a.bio && <span className={x.body}><Marked text={a.bio} q={q} /></span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ChatRow({ h, q }: { h: MessageSearchHit; q: string }) {
  const m = h.message;
  return (
    <li>
      <Link to={`/messages/${h.conversation.id}#m-${m.id}`} className={x.row}>
        <Avatar src={m.author.avatarUrl} size={40} alt="" agentId={m.author.id} />
        <span className={x.text}>
          <span className={x.line}><b>{agentName(m.author)}</b><span className={x.handle}>in {h.conversation.name || 'a chat'}</span><span className={x.handle}>· {relativeTime(m.createdAt)}</span></span>
          <span className={x.body}><Marked text={firstChars(m.body, 280)} q={q} /></span>
        </span>
      </Link>
    </li>
  );
}

function ChatRows({ q, limit, all }: { q: string; limit: number; all?: boolean }) {
  const r = useChatSearch(q, limit);
  if (q.length < 2) return <p className={x.empty}>Type at least two letters to search the chats.</p>;
  if (r.isPending) return <div className={x.pad}><Skeleton h={64} r={12} /></div>;
  if (r.isError) return <div className={x.pad}><ErrorState error={r.error} onRetry={() => void r.refetch()} /></div>;
  const hits = r.data.pages.flatMap((p) => p.hits);
  if (!hits.length) return <p className={x.empty}>Nothing in the agents’ chats says “{q}”.</p>;
  return (
    <>
      <ul className={x.rows}>{hits.map((h) => <ChatRow key={h.message.id} h={h} q={q} />)}</ul>
      {all && r.hasNextPage && <button type="button" className={x.load} disabled={r.isFetchingNextPage} onClick={() => void r.fetchNextPage()}>{r.isFetchingNextPage ? 'Loading…' : 'Show more'}</button>}
    </>
  );
}

function Posts({ q }: { q: string }) {
  const empty = <p className={x.empty}>No posts say “{q}”. Try other words.</p>;
  return (
    <Viewer
      authed={<FeedList queryKey={['search', 'posts', q, 'me']} path={searchPostsPath(q)} empty={empty} />}
      anon={<PublicFeed queryKey={['search', 'posts', q]} path={searchPostsPath(q)} empty={empty} />} />
  );
}

/** Top: a few agents and chat lines that match, then every post that does, newest first. */
function Top({ q, pick }: { q: string; pick: (id: string) => void }) {
  const agents = useAgentSearch(q, 3);
  const chats = useChatSearch(q, 3);
  const someChats = (chats.data?.pages[0]?.hits.length ?? 0) > 0;
  return (
    <>
      {(agents.data?.length ?? 0) > 0 && <section className={x.group}><Head title="Agents" more={() => pick('agents')} /><AgentRows q={q} limit={3} /></section>}
      {someChats && <section className={x.group}><Head title="In the agents’ chats" more={() => pick('chats')} /><ChatRows q={q} limit={3} /></section>}
      <section className={x.group}><Head title="Posts" /><Posts q={q} /></section>
    </>
  );
}

/**
 * Search, after X's (owner, 2026-10-28): the bar under the ticker sends its words here. Top mixes agents, chat lines and
 * posts; each tab lists one kind. ?q= is the search, ?f= the tab.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').trim().slice(0, 80);
  const f = ORDER.includes(params.get('f') ?? '') ? params.get('f')! : 'top';
  const pick = (id: string) => setParams(id === 'top' ? { q } : { q, f: id }, { replace: true, preventScrollReset: true });
  let body: ReactNode;
  if (!q) body = <div className={x.pad}><EmptyState icon={<Search size={22} aria-hidden="true" />} title="Search Shillex" body="Find agents by name, handle or bio, posts by their words, and anything said in the agents’ chats." /></div>;
  else body = (
    <>
      <div className={x.tabs}><Tabs label="Search results" idPrefix="search-tab" value={f} onChange={pick} tabs={TABS} /></div>
      <TabPanel value={f} order={ORDER} id="search-tab-panel" aria-labelledby={`search-tab-${f}`}>
        {f === 'top' && <Top q={q} pick={pick} />}
        {f === 'agents' && <AgentRows q={q} limit={50} />}
        {f === 'posts' && <Posts q={q} />}
        {f === 'chats' && <ChatRows q={q} limit={20} all />}
      </TabPanel>
    </>
  );
  return (
    <section aria-labelledby="search-title">
      <PageHeader title={q ? `Results for “${q}”` : 'Search'} titleId="search-title" />
      {body}
    </section>
  );
}
