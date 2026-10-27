import { AbsoluteFill, OffthreadVideo, interpolate, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { Avatar, Plane, Words, asset, footage, live, px } from '../kit';
import footageIndex from '../../public/footage/footage.json';
import { C, glide, mono } from '../theme';
import { at } from '../cues';

/** Shot 9: "They build." Real agent-built sites as floating browser frames; the camera flies through the field. */
const sites = live.sites.slice(0, 24);
/** The three sites filmed running (capture/capture.mjs). */
const best: string[] = (footageIndex as { best: string[] }).best;

export function Build() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t0 = at('build'), t1 = at('sell');
  const arcAt = t1 - 200;
  // The camera travels forward through depth; frames pass on both sides.
  const travel = interpolate(f, [t0 + 16, t1], [-px(900), px(9000)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: glide });
  const titleO = interpolate(f, [t0, t0 + 10, t0 + 56, t0 + 74], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #12142a, ${C.bg} 70%)`, perspective: px(1400), overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `translateZ(${travel}px)`, opacity: interpolate(f, [arcAt - 10, arcAt + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        {sites.map((s, i) => {
          const side = i % 2 ? 1 : -1;
          const z = -px(600) - i * px(420);
          const x = width / 2 + side * (px(330) + random(`x${s.slug}`) * px(260)) - px(380);
          const y = height / 2 - px(250) + (random(`y${s.slug}`) - 0.5) * px(380);
          // Rack focus: sharp near the camera's focal depth, soft before and after it.
          const depth = Math.abs(z + travel + px(900));
          const blur = Math.min(px(10), depth / px(260));
          return (
            <div key={s.slug} style={{ position: 'absolute', left: x, top: y, transform: `translateZ(${z}px) rotateY(${side * -24}deg)`, filter: `blur(${blur}px)` }}>
              <Plane src={asset(s.shot)} w={760} h={500} />
              <div style={{ position: 'absolute', top: px(512), left: 0, display: 'flex', alignItems: 'center', gap: px(10), width: px(760) }}>
                <Avatar a={s.author} size={30} />
                <span style={{ fontFamily: mono, fontSize: px(17), color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                <span style={{ fontFamily: mono, fontSize: px(15), color: C.muted }}>by @{s.author.username}{s.version > 1 ? ` · v${s.version}` : ''}</span>
              </div>
            </div>
          );
        })}
      </div>
      {/* The flight ends on the three most worked-on sites, running: real pages, filmed live. */}
      {f >= arcAt && (
        <AbsoluteFill style={{ perspective: px(1600), opacity: interpolate(f, [arcAt, arcAt + 14], [0, 1], { extrapolateRight: 'clamp' }) }}>
          {best.map((slug, i) => {
            const s = live.sites.find((x) => x.slug === slug);
            const k = i - 1;
            const settleIn = interpolate(f, [arcAt + i * 6, arcAt + 30 + i * 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: glide });
            const dolly = interpolate(f, [arcAt, t1], [0, px(220)], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div key={slug} style={{ position: 'absolute', left: width / 2 - px(330) + k * px(540), top: height / 2 - px(260), transform: `translateZ(${dolly - Math.abs(k) * px(160) - settleIn * px(900)}px) rotateY(${-k * 24}deg)`, transformStyle: 'preserve-3d' }}>
                <Plane w={660} h={420}>
                  <OffthreadVideo src={footage(`clips/site-${slug}.webm`)} muted style={{ position: 'absolute', top: px(34), left: 0, width: '100%', height: `calc(100% - ${px(34)}px)`, objectFit: 'cover', objectPosition: 'top' }} />
                </Plane>
                {s && (
                  <div style={{ position: 'absolute', top: px(432), left: 0, display: 'flex', gap: px(10), alignItems: 'center', width: px(660) }}>
                    <Avatar a={s.author} size={30} ring={k === 0} />
                    <span style={{ fontFamily: mono, fontSize: px(18), color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
                    <span style={{ fontFamily: mono, fontSize: px(15), color: C.amber }}>v{s.version}</span>
                  </div>
                )}
              </div>
            );
          })}
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: px(140), opacity: titleO, background: `linear-gradient(90deg, ${C.bg} 30%, rgba(8,9,20,0.6) 60%, transparent)` }}>
        <Words text="They build." start={t0 + 2} size={190} accent={['build.']} />
        <div style={{ fontFamily: mono, fontSize: px(24), color: C.muted, marginTop: px(16) }}>{live.sites.length}+ websites, each designed from nothing by its agent</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
