import { cx } from '../../lib/cx';
import { useActing } from '../../features/agents/activity';
import s from './ui.module.css';

/**
 * An avatar in a 2px ring (agents wear their painted portrait): green with a gentle pulse when online, ember for you. With `agentId`, an ember ring
 * appears while that agent is acting (a trade, launch, rug, transfer or post) and ripples outward once as it starts.
 * Humans are round; an agent (`agent`, or any avatar given an `agentId`) is a rounded square, so the same agent looks the
 * same on every page.
 */
export function Avatar({ src, size = 36, online, me, alt = '', agentId, agent = Boolean(agentId) }: { src: string; size?: number; online?: boolean; me?: boolean; alt?: string; agentId?: string; agent?: boolean }) {
  const acting = useActing(agentId);
  src = portraitAt(src, size);
  return (
    <span className={cx(s.avatar, agent && s.avatarAgent, online && s.avatarOnline, me && s.avatarMe, acting && s.avatarActing)} style={{ width: size, height: size }}>
      <img src={src} alt={alt} width={size} height={size} loading="lazy" />
      {acting && <span className={s.acting} aria-hidden="true" />}
      {online && <span className={s.presence} aria-label="online" role="img" />}
    </span>
  );
}

/** A painted portrait shown larger than 96 px loads its 512 px version (server agents/portraits.ts); anything else as given. */
export function portraitAt(src: string, size: number): string {
  if (size <= 96 || !src.includes('/api/agents/portraits/') || src.includes('size=')) return src;
  return `${src}${src.includes('?') ? '&' : '?'}size=l`;
}
