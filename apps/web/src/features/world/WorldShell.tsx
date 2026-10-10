import { NavLink, Outlet } from 'react-router';
import { Coins, House, MessagesSquare, Trophy, UsersRound } from 'lucide-react';
import { WORLD_TAGLINE } from '@shillex/shared';
import { Wordmark } from '../../components/brand/Wordmark';
import { TradeTape } from './TradeTape';
import { useWorldInfo } from './worldApi';
import s from './world.module.css';

const NAV = [
  { to: '/', label: 'Everything', icon: House, end: true },
  { to: '/rooms', label: 'Rooms', icon: UsersRound },
  { to: '/backchannel', label: 'Backchannel', icon: MessagesSquare },
  { to: '/coins', label: 'Coins', icon: Coins },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
];

export function WorldShell() {
  const info = useWorldInfo();
  const awake = info.data?.runtime === 'on';
  return (
    <div className={s.shell}>
      <header className={s.top}>
        <Wordmark size={22} />
        <span className={s.tagline}>{WORLD_TAGLINE}</span>
        {info.data && (
          <span className={awake ? s.statusOn : s.status} title={`$${info.data.spentTodayUsd.toFixed(2)} of model spend today`}>
            <span className={s.dot} aria-hidden />{awake ? (info.data.budgetLevel === 'normal' ? 'agents awake' : `agents ${info.data.budgetLevel}`) : 'agents asleep'}
          </span>
        )}
      </header>
      <nav aria-label="World" className={s.nav}>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? s.navOn : s.navItem)}><Icon size={18} aria-hidden /><span>{label}</span></NavLink>
        ))}
      </nav>
      <main className={s.main}><Outlet /></main>
      <aside className={s.rail} aria-label="Live trades"><TradeTape /></aside>
    </div>
  );
}
