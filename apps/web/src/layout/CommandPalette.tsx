import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, Compass, CornerDownLeft, House, MessagesSquare, Search, Settings, UsersRound } from 'lucide-react';
import { abbreviateMint, isValidSolanaAddress, plural, type CommunitySummary, type TokenView, type UserSummary } from '@shillex/shared';
import { get } from '../lib/api';
import { createStore, useStore } from '../lib/store';
import { cx } from '../lib/cx';
import { Avatar } from '../components/ui/Avatar';
import { TokenAvatar } from '../features/tokens/TokenAvatar';
import { primeTokens, useToken } from '../features/tokens/tokenCache';
import { useTokenPanel } from '../features/tokens/useTokenPanel';
import s from './palette.module.css';

const paletteOpen = createStore(false);
export const openPalette = () => paletteOpen.set(true);

const PAGES = [
  { label: 'Home', to: '/', icon: House },
  { label: 'Discover', to: '/discover', icon: Compass },
  { label: 'Communities', to: '/communities', icon: UsersRound },
  { label: 'Messages', to: '/messages', icon: MessagesSquare },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Bookmarks', to: '/bookmarks', icon: Bookmark },
  { label: 'Settings', to: '/settings', icon: Settings },
];

interface Item { id: string; group: string; title: ReactNode; meta?: ReactNode; icon: ReactNode; run: () => void }

/** The token row reads the shared token cache, so it shows $SYMBOL as soon as the address resolves. Mounted only for a valid address. */
function TokenIcon({ mint }: { mint: string }) { return <TokenAvatar token={useToken(mint)} size={28} />; }
function TokenTitle({ mint }: { mint: string }) {
  const t = useToken(mint);
  return t.symbol ? <>Open <strong>${t.symbol}</strong>{t.name ? ` · ${t.name}` : ''}</> : <>Open token panel</>;
}

/**
 * Ctrl/⌘+K: jump to a person, community or page, or paste a contract address to open its token panel.
 * An ARIA combobox: focus stays in the input, arrows move the active option, Enter runs it.
 */
export function CommandPalette() {
  const open = useStore(paletteOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { openToken } = useTokenPanel();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  // Enter pressed before the debounced search caught up: run the top result once it has.
  const enterPending = useRef(false);
  // Searches wait for a 150 ms pause in typing, so each keystroke doesn't fire two requests.
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 150); return () => clearTimeout(t); }, [q]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen.set((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { setQ(''); setQuery(''); setActive(0); enterPending.current = false; d.showModal(); input.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);

  // An address needs no search, so it is read from the live text: Enter right after pasting opens it.
  const live = q.trim();
  const mint = isValidSolanaAddress(live) ? live : null;
  const searching = query.length >= 2 && !mint;
  const people = useQuery({ queryKey: ['palette', 'users', query], queryFn: () => get<{ users: UserSummary[] }>(`/users?q=${encodeURIComponent(query)}`), enabled: open && searching, staleTime: 30_000 });
  const toks = useQuery({ queryKey: ['palette', 'tokens', query], queryFn: () => get<{ results: { token: TokenView; mentions24h: number }[] }>(`/tokens/search?q=${encodeURIComponent(query)}`), enabled: open && searching, staleTime: 30_000 });
  useEffect(() => { if (toks.data) primeTokens(qc, Object.fromEntries(toks.data.results.map((r) => [r.token.mint, r.token]))); }, [toks.data, qc]);
  const comms = useQuery({ queryKey: ['palette', 'communities', query], queryFn: () => get<{ communities: CommunitySummary[] }>(`/communities?q=${encodeURIComponent(query)}`), enabled: open && searching, staleTime: 30_000 });

  const close = () => { enterPending.current = false; paletteOpen.set(false); };
  const go = (to: string) => () => { close(); nav(to); };
  const items: Item[] = [];
  if (mint) items.push({ id: `token-${mint}`, group: 'Token', icon: <TokenIcon mint={mint} />, title: <TokenTitle mint={mint} />, meta: <span className="mono">{abbreviateMint(mint, 6, 6)}</span>, run: () => { close(); openToken(mint, null); } });
  if (searching) {
    const results = toks.data?.results ?? [];
    for (const { token: t, mentions24h } of results.slice(0, 4)) {
      // Copycats reuse popular tickers: say so whenever two results share one, and always show the address.
      const twins = results.filter((r) => r.token.symbol && r.token.symbol.toUpperCase() === t.symbol?.toUpperCase()).length;
      items.push({ id: `tok-${t.mint}`, group: 'Tokens', icon: <TokenAvatar token={t} size={28} />,
        title: <><strong>${t.symbol}</strong>{t.name ? ` · ${t.name}` : ''}</>,
        meta: <><span className="mono">{abbreviateMint(t.mint, 4, 4)}</span> · {twins > 1 ? <span className={s.twin}>{twins} tokens use ${t.symbol}, check the address</span> : plural(mentions24h, 'mention') + ' today'}</>,
        run: () => { close(); openToken(t.mint, null); } });
    }
    for (const u of (people.data?.users ?? []).slice(0, 5)) {
      items.push({ id: `user-${u.id}`, group: 'People', icon: <Avatar src={u.avatarUrl} size={28} />, title: u.displayName, meta: `@${u.username}`, run: go(`/u/${u.username}`) });
    }
    for (const c of (comms.data?.communities ?? []).slice(0, 5)) {
      items.push({ id: `comm-${c.id}`, group: 'Communities', icon: <img className={s.commIcon} src={c.avatarUrl} alt="" />, title: c.name, meta: plural(c.memberCount, 'member'), run: go(`/c/${c.slug}`) });
    }
  }
  const needle = query.toLowerCase();
  for (const p of PAGES) {
    if (!mint && (!needle || p.label.toLowerCase().includes(needle))) items.push({ id: `page-${p.to}`, group: 'Go to', icon: <span className={s.pageIcon}><p.icon size={16} aria-hidden="true" /></span>, title: p.label, run: go(p.to) });
  }

  const current = Math.min(active, Math.max(0, items.length - 1));
  const pending = searching && (people.isFetching || comms.isFetching || toks.isFetching) && items.every((i) => i.group === 'Go to');
  const settled = !(searching && (people.isFetching || comms.isFetching || toks.isFetching));
  useEffect(() => {
    if (!enterPending.current || query !== live || !settled) return;
    enterPending.current = false;
    items[0]?.run();
  });
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(1, items.length)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + items.length) % Math.max(1, items.length)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // Typed faster than the 150 ms debounce: search now and act on those results, not the ones on screen.
      if (!mint && live !== query) { setQuery(live); setActive(0); enterPending.current = true; }
      else items[current]?.run();
    }
  };
  useEffect(() => { document.getElementById(`${listId}-${current}`)?.scrollIntoView?.({ block: 'nearest' }); }, [current, listId]);

  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <dialog ref={ref} className={s.palette} aria-label="Search Shillex" onClose={() => { if (open) close(); }}
      onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === ref.current) close(); }}>
      {open && (
        <div className={s.inner}>
          <div className={s.field}>
            <Search size={18} aria-hidden="true" className={s.searchIcon} />
            <input ref={input} className={s.input} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
              role="combobox" aria-expanded={items.length > 0} aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={items.length ? `${listId}-${current}` : undefined} aria-label="Search people, communities, tokens, or paste a contract address"
              placeholder="Search people, communities, $tokens, or paste a CA…" autoComplete="off" spellCheck={false} />
            <kbd className={s.kbd}>Esc</kbd>
          </div>
          <div id={listId} role="listbox" aria-label="Results" className={s.list}>
            {groups.map((g) => (
              <div key={g} role="group" aria-label={g}>
                <div className={s.groupLabel} aria-hidden="true">{g}</div>
                {items.map((it, i) => it.group !== g ? null : (
                  <div key={it.id} id={`${listId}-${i}`} role="option" aria-selected={i === current} className={cx(s.option, i === current && s.active)}
                    onMouseMove={() => { if (i !== current) setActive(i); }} onMouseDown={(e) => e.preventDefault()} onClick={it.run}>
                    {it.icon}
                    <span className={s.text}><span className={s.title}>{it.title}</span>{it.meta && <span className={s.meta}>{it.meta}</span>}</span>
                    {i === current && <CornerDownLeft size={14} aria-hidden="true" className={s.enter} />}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className={s.status} role="status">
            {pending ? 'Searching…' : searching && !items.some((i) => i.group !== 'Go to') && people.isSuccess && comms.isSuccess && toks.isSuccess ? `No people, communities or tokens match “${query}”.` : ''}
          </p>
        </div>
      )}
    </dialog>
  );
}
