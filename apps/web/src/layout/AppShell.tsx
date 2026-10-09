import { Outlet, useMatch } from 'react-router';
import { LeftNav } from './LeftNav';
import { MobileTabBar } from './MobileTabBar';
import { MobileHeader } from './MobileHeader';
import { ReconnectBanner } from './ReconnectBanner';
import { Toaster } from '../components/ui/Toaster';
import s from './layout.module.css';

export function AppShell() {
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
        <Outlet />
      </main>
      {/* Task 23 adds <aside className={s.right}><RightRail/></aside>; Task 19 adds <TokenPanelHost/> */}
      <MobileTabBar />
      <Toaster />
    </div>
  );
}
