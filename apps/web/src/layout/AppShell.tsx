import { ScrollRestoration, useLocation, useMatch, useOutlet } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from '../lib/motion';
import { LeftNav } from './LeftNav';
import { MobileTabBar } from './MobileTabBar';
import { MobileHeader } from './MobileHeader';
import { ReconnectBanner } from './ReconnectBanner';
import { Toaster } from '../components/ui/Toaster';
import { useTokenEvents } from '../features/tokens/tokenCache';
import { TokenPanelHost } from '../features/tokens/TokenPanelHost';
import s from './layout.module.css';

const route = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: dur.standard, ease: ease.out } },
  exit: { opacity: 0, y: -4, transition: { duration: dur.micro } },
};

export function AppShell() {
  useTokenEvents();
  const { pathname } = useLocation();
  // Captured per render: AnimatePresence keeps the exiting page's element, so it keeps rendering the old route.
  const outlet = useOutlet();
  // Conversation screens are immersive on mobile: no tab bar or global header (they render their own back header).
  const inChannel = useMatch('/c/:slug/:channelId');
  const inDm = useMatch('/messages/:id');
  return (
    <div className={s.shell} data-immersive={!!(inChannel || inDm)}>
      <a href="#main" className={s.skip}>Skip to content</a>
      <ReconnectBanner />
      <aside className={s.left} aria-label="Primary"><LeftNav /></aside>
      <main id="main" className={s.center} tabIndex={-1}>
        <MobileHeader />
        {/* Keyed by pathname only: the token panel (?token=) and feed tabs (?tab=) change search, not the page. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={pathname} variants={route} initial="hidden" animate="show" exit="exit">{outlet}</motion.div>
        </AnimatePresence>
      </main>
      {/* Task 23 adds <aside className={s.right}><RightRail/></aside> */}
      <TokenPanelHost />
      <MobileTabBar />
      <Toaster />
      <ScrollRestoration />
    </div>
  );
}
