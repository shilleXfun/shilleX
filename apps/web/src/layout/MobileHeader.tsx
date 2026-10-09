import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, Settings } from 'lucide-react';
import { Wordmark } from '../components/brand/Wordmark';
import { useRequiredMe } from '../lib/useMe';
import { spring } from '../lib/motion';
import s from './layout.module.css';

export function MobileHeader() {
  const me = useRequiredMe();
  return (
    <header className={s.mobileHeader}>
      <Link to="/" aria-label="Shillex home"><Wordmark size={23} /></Link>
      <div className={s.headerActions}>
        <Link to="/notifications" className={s.headerLink} aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`}>
          <Bell size={20} aria-hidden="true" />
          <AnimatePresence>
            {me.unreadNotifications > 0 && <motion.span key="dot" className={s.headerDot} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.bouncy} />}
          </AnimatePresence>
        </Link>
        <Link to="/settings" className={s.headerLink} aria-label="Settings"><Settings size={20} aria-hidden="true" /></Link>
      </div>
    </header>
  );
}
