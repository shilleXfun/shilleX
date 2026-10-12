import { useEffect, useRef, useState } from 'react';
import { ScrollRestoration, useLocation, useMatch, useNavigate, useOutlet } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from '../lib/motion';
import { LeftNav } from './LeftNav';
import { MobileTabBar } from './MobileTabBar';
import { MobileHeader } from './MobileHeader';
import { ReconnectBanner } from './ReconnectBanner';
import { Toaster } from '../components/ui/Toaster';
import { useTokenEvents } from '../features/tokens/tokenCache';
import { TokenPanelHost } from '../features/tokens/TokenPanelHost';
import { useRealtimeSync } from './useRealtimeSync';
import { RightRail } from './RightRail';
import { useSwarmPosts } from '../components/swarm/hooks';
import { useAgentPulses } from '../features/agents/pulses';
import { useHotkeys } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CommandPalette, openPalette } from './CommandPalette';
import s from './layout.module.css';

/** Focuses a `data-shortcut` target, retrying briefly while the page it lives on is still animating in. */
/** j/k: focus the next or previous post card, starting from the focused one or else the one in view. */
function stepPost(dir: 1 | -1) {
  const cards = [...document.querySelectorAll<HTMLElement>('main [data-post-card]')];
  if (!cards.length) return;
  const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-post-card]');
  let i = current ? cards.indexOf(current) + dir : -1;
  if (!current) {
    const inView = cards.findIndex((c) => c.getBoundingClientRect().bottom > 80);
    i = inView < 0 ? cards.length - 1 : dir === 1 ? inView : Math.max(0, inView - 1);
  }
  const next = cards[Math.min(cards.length - 1, Math.max(0, i))]!;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function focusShortcut(name: string, tries = 12) {
  const el = document.querySelector<HTMLElement>('[data-shortcut="' + name + '"]');
  if (el) el.focus();
  else if (tries > 0) setTimeout(() => focusShortcut(name, tries - 1), 60);
}

const route = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: dur.standard, ease: ease.out } },
  // The outgoing page ignores the pointer, so a quick tap can't land on the page being left.
  exit: { opacity: 0, y: -4, pointerEvents: 'none', transition: { duration: dur.micro } },
};

export function AppShell() {
  useTokenEvents();
  useRealtimeSync();
  useSwarmPosts();
  useAgentPulses();
  const { pathname } = useLocation();
  // One page per community and per inbox: switching channels or conversations animates inside the page, not the page.
  const parts = pathname.split('/');
  const pageKey = parts[1] === 'c' ? parts.slice(0, 3).join('/') : parts[1] === 'messages' ? '/messages' : pathname;
  // Captured per render: AnimatePresence keeps the exiting page's element, so it keeps rendering the old route.
  const outlet = useOutlet();
  // Conversation screens are immersive on mobile: no tab bar or global header (they render their own back header).
  const inChannel = useMatch('/c/:slug/:channelId');
  const inDm = useMatch('/messages/:id');
  const nav = useNavigate();
  // The rail only exists from 1200px (layout.module.css); below that it isn't mounted, so it fetches nothing.
  const wideEnoughForRail = useMediaQuery('(min-width: 1200px)');
  const [help, setHelp] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const first = useRef(true);
  // A new page moves focus to <main> so screen readers and keyboard users start at the top of the content.
  useEffect(() => { if (first.current) { first.current = false; return; } mainRef.current?.focus({ preventScroll: true }); }, [pageKey]);
  useHotkeys({
    // A page's own search box wins; elsewhere / opens the palette.
    '/': () => { if (document.querySelector('[data-shortcut="search"]')) focusShortcut('search'); else openPalette(); },
    // From another page, Home focuses its own composer once it mounts (the outgoing page may have a composer too).
    n: () => { if (pathname === '/' && document.querySelector('[data-shortcut="compose"]')) focusShortcut('compose'); else nav('/', { state: { compose: true } }); },
    'g h': () => nav('/'), 'g d': () => nav('/discover'), 'g c': () => nav('/communities'), 'g m': () => nav('/messages'), 'g n': () => nav('/notifications'),
    j: () => stepPost(1), k: () => stepPost(-1),
    '?': () => setHelp(true),
  });
  return (
    <div className={s.shell} data-immersive={!!(inChannel || inDm)} data-wide={parts[1] === 'c' || parts[1] === 'messages'}>
      <a href="#main" className={s.skip}>Skip to content</a>
      <ReconnectBanner />
      <aside className={s.left} aria-label="Primary"><LeftNav /></aside>
      <main id="main" ref={mainRef} className={s.center} tabIndex={-1}>
        <MobileHeader />
        {/* Keyed by path only: the token panel (?token=) and tabs (?tab=) change search, not the page. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={pageKey} className={s.page} variants={route} initial="hidden" animate="show" exit="exit">{outlet}</motion.div>
        </AnimatePresence>
      </main>
      {wideEnoughForRail && <aside className={s.right} aria-label="Activity"><RightRail /></aside>}
      <TokenPanelHost />
      <MobileTabBar />
      <Toaster />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
      <CommandPalette />
      <ScrollRestoration />
    </div>
  );
}
