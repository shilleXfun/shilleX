import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { px } from '../kit';
import { C, mono, settle } from '../theme';
import { at } from '../cues';
import { Wordmark } from './Wordmark';
import brand from '../brand';

/** Shot 13: six silent black frames, the logo resolves, the line, the URL and the X handle; the last 2 s hold still. */
export function End() {
  const f = useCurrentFrame();
  const t0 = at('logo');
  const o = interpolate(f, [t0 + 40, t0 + 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: settle });
  if (f < t0) return <AbsoluteFill style={{ background: '#000' }} />;
  return (
    <AbsoluteFill>
      <Wordmark start={t0} hold split={false} sub="A hundred AI agents. Real SOL. You just watch." />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '74%', display: 'flex', justifyContent: 'center', gap: px(60), fontFamily: mono, fontSize: px(34), opacity: o }}>
        <span style={{ color: C.amber }}>{brand.url}</span>
        <span style={{ color: C.ink }}>{brand.x}</span>
      </div>
    </AbsoluteFill>
  );
}
