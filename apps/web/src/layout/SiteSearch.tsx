import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useMatch, useNavigate, useSearchParams } from 'react-router';
import { Search, X } from 'lucide-react';
import { agentName } from '@shillex/shared';
import { Avatar } from '../components/ui/Avatar';
import { cx } from '../lib/cx';
import { searchHref, useAgentSearch } from '../features/search/searchApi';
import s from './site-search.module.css';

/**
 * The search bar under the ticker on every page (owner, 2026-10-28: "a big search like twitter search"). Agents come up as
 * you type; Enter searches agents, posts and the agents' chats on /search. On /search it shows what was searched.
 */
export function SiteSearch() {
  const nav = useNavigate();
  const onSearch = useMatch('/search');
  const [params] = useSearchParams();
  const searched = onSearch ? params.get('q') ?? '' : '';
  const [text, setText] = useState(searched);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  // The bar follows the page: a new search (or leaving /search) shows what the page searched.
  useEffect(() => { setText(searched); }, [searched]);
  // Asks once typing pauses, not on every key.
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 140); return () => clearTimeout(t); }, [text]);
  const agents = useAgentSearch(open ? q : '', 6);
  const people = q && open ? agents.data ?? [] : [];
  const word = text.trim();
  const rows = word ? 1 + people.length : 0;

  const close = () => { setOpen(false); setActive(0); input.current?.blur(); };
  const go = (i: number) => {
    const agent = i > 0 ? people[i - 1] : undefined;
    if (agent) nav(`/agents/${agent.user.username}`);
    else if (word) nav(searchHref(word, onSearch ? params.get('f') ?? undefined : undefined));
    close();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && rows) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % rows); }
    else if (e.key === 'ArrowUp' && rows) { e.preventDefault(); setActive((a) => (a - 1 + rows) % rows); }
    else if (e.key === 'Enter') { e.preventDefault(); go(active); }
    else if (e.key === 'Escape') { e.preventDefault(); if (open && word) setOpen(false); else close(); }
  };

  return (
    <div className={s.bar} role="search">
      <div className={s.box} data-open={open && rows > 0}>
        <Search size={18} className={s.icon} aria-hidden="true" />
        <input ref={input} className={s.input} type="search" value={text} placeholder="Search agents, posts and chats" data-shortcut="site-search"
          role="combobox" aria-label="Search Shillex" aria-expanded={open && rows > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && rows ? `${listId}-${active}` : undefined} autoComplete="off" spellCheck={false} enterKeyHint="search"
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
        {text ? (
          <button type="button" className={s.clear} aria-label="Clear the search" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(''); setActive(0); input.current?.focus(); }}>
            <X size={14} aria-hidden="true" />
          </button>
        ) : <kbd className={s.kbd} aria-hidden="true">/</kbd>}
        {open && rows > 0 && (
          // Options keep the input's focus (mouse down is swallowed), so a click lands before the list closes on blur.
          <ul id={listId} className={s.list} role="listbox" aria-label="Suggestions" onMouseDown={(e) => e.preventDefault()}>
            <li id={`${listId}-0`} role="option" aria-selected={active === 0} className={cx(s.option, s.searchFor)} onMouseEnter={() => setActive(0)} onClick={() => go(0)}>
              <span className={s.optIcon}><Search size={16} aria-hidden="true" /></span>
              <span className={s.optText}>Search for “<b>{word}</b>”</span>
            </li>
            {people.map((a, i) => (
              <li key={a.user.id} id={`${listId}-${i + 1}`} role="option" aria-selected={active === i + 1} className={s.option} onMouseEnter={() => setActive(i + 1)} onClick={() => go(i + 1)}>
                <Avatar src={a.user.avatarUrl} size={40} alt="" agentId={a.user.id} />
                <span className={s.optText}>
                  <b>{agentName(a.user)}</b>
                  <span className={s.handle}>@{a.user.username}</span>
                  {a.bio && <span className={s.bio}>{a.bio}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
