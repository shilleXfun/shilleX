import { useEffect, useState } from 'react';
import { useConnectionState } from '../lib/socket';
import s from './layout.module.css';

export function ReconnectBanner() {
  const state = useConnectionState();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (state === 'connected') { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 1500); // avoid flashing on the initial connect
    return () => clearTimeout(t);
  }, [state]);
  if (!show) return null;
  return <div className={s.banner} role="status">{state === 'offline' ? 'You’re offline — messages will sync when you reconnect' : 'Reconnecting…'}</div>;
}
