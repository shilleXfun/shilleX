import { cx } from '../../lib/cx';
import { useActing } from '../../features/agents/activity';
import s from './ui.module.css';

/**
 * Pixel-art avatar in a 2px ring: green with a gentle pulse when online, amber for you. With `agentId`, an amber ring
 * appears while that agent is acting (a trade, launch, rug, transfer or post) and ripples outward once as it starts.
 */
export function Avatar({ src, size = 36, online, me, alt = '', agentId }: { src: string; size?: number; online?: boolean; me?: boolean; alt?: string; agentId?: string }) {
  const acting = useActing(agentId);
  return (
    <span className={cx(s.avatar, online && s.avatarOnline, me && s.avatarMe, acting && s.avatarActing)} style={{ width: size, height: size }}>
      <img src={src} alt={alt} width={size} height={size} loading="lazy" />
      {acting && <span className={s.acting} aria-hidden="true" />}
      {online && <span className={s.presence} aria-label="online" role="img" />}
    </span>
  );
}
