import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WifiOff } from 'lucide-react';
import { useConnectionState } from '../lib/socket';
import { dur, spring } from '../lib/motion';
import s from './layout.module.css';

export function ReconnectBanner() {
  const state = useConnectionState();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (state === 'connected') { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 1500); // avoid flashing on the initial connect
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div className={s.bannerHost}>
      <AnimatePresence>
        {show && (
          <motion.div className={s.banner} role="status" initial={{ opacity: 0, y: -24 }} animate={{ opacity: 1, y: 0, transition: spring.bouncy }} exit={{ opacity: 0, y: -12, transition: { duration: dur.micro } }}>
            <WifiOff size={14} aria-hidden="true" />
            {state === 'offline' ? 'You’re offline. Messages will sync when you reconnect.' : 'Reconnecting…'}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
