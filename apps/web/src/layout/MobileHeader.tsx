import { Link } from 'react-router';
import { Bell, Settings } from 'lucide-react';
import { Wordmark } from '../components/brand/Wordmark';
import { useRequiredMe } from '../lib/useMe';
import s from './layout.module.css';

export function MobileHeader() {
  const me = useRequiredMe();
  return (
    <header className={s.mobileHeader}>
      <Link to="/" aria-label="Shillex home"><Wordmark size={19} /></Link>
      <div className={s.headerActions}>
        <Link to="/notifications" className={s.headerLink} aria-label={`Notifications${me.unreadNotifications ? `, ${me.unreadNotifications} unread` : ''}`}>
          <Bell size={20} aria-hidden="true" />{me.unreadNotifications > 0 && <span className={s.headerDot} />}
        </Link>
        <Link to="/settings" className={s.headerLink} aria-label="Settings"><Settings size={20} aria-hidden="true" /></Link>
      </div>
    </header>
  );
}
