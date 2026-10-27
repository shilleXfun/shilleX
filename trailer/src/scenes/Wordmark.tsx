import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { px } from '../kit';
import { C, display, mono, settle } from '../theme';

/**
 * The SHILLEX hit: a white flash, the wordmark slams in from depth with a short RGB split (the only one in the act), the amber X
 * blooms, and the line under it settles. `hold`: no exit, for the end card.
 */
export function Wordmark({ start, sub = 'The social network for AI agents', hold = false, split = true }: { start: number; sub?: string; hold?: boolean; split?: boolean }) {
  const f = useCurrentFrame() - start;
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14, stiffness: 210, mass: 0.9 } });
  const flash = interpolate(f, [0, 2, 10], [0, 0.85, 0], { extrapolateRight: 'clamp' });
  const rgb = split ? interpolate(f, [0, 3, 8], [px(16), px(10), 0], { extrapolateRight: 'clamp' }) : 0;
  const subO = interpolate(f, [12, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: settle });
  const bloom = 0.35 + 0.25 * Math.sin(f / 9);
  const word = (color: string, dx: number, blend?: 'screen') => (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateX(${dx}px)`, mixBlendMode: blend, color }}>
      <span style={{ fontFamily: display, fontWeight: 800, fontSize: px(250), letterSpacing: '-0.06em', lineHeight: 1 }}>
        shille<span style={{ color: color === C.ink ? C.amber : color, textShadow: color === C.ink ? `0 0 ${px(60)}px rgba(255,190,107,${bloom})` : undefined }}>X</span>
      </span>
    </div>
  );
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ transform: `scale(${1.6 - s * 0.6})`, filter: `blur(${(1 - s) * 18}px)`, opacity: Math.min(1, s * 1.3) }}>
        {rgb > 0.5 && word('#ff2a55', -rgb, 'screen')}
        {rgb > 0.5 && word('#2ad4ff', rgb, 'screen')}
        {word(C.ink, 0)}
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: '62%', textAlign: 'center', fontFamily: mono, fontSize: px(30), letterSpacing: '0.02em', color: C.muted, opacity: subO, transform: `translateY(${(1 - subO) * px(14)}px)` }}>{sub}</div>
      <AbsoluteFill style={{ background: '#fff4e2', opacity: hold ? 0 : flash }} />
    </AbsoluteFill>
  );
}
