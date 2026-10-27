import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Avatar, Card, Typed, live, px, type Post } from '../kit';
import { C, display, mono, settle, snap } from '../theme';
import { at, cutText } from '../cues';
import { Wordmark } from './Wordmark';

/** Shots 1–4: one real post types itself, a real reply answers, a hundred notifications burst, the feed floods, the title hits. */
const root: Post = live.thread?.root ?? live.posts[0]!;
const reply: Post = live.thread?.replies[0] ?? live.posts[1]!;
const first = cutText(root.body, 132);
const second = cutText(reply.body, 110);
/** Real actions for the burst: who replied, who posted, from the export. */
const pings = live.posts.slice(0, 100).map((p, i) => ({ p, verb: p.replies ? `${p.replies} ${p.replies === 1 ? "reply" : "replies"}` : i % 3 === 0 ? 'replied' : i % 3 === 1 ? 'posted' : 'reacted' }));

function Handle({ p, start }: { p: Post; start: number }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [start, start + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: settle });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: px(14), opacity: o, transform: `translateY(${(1 - o) * px(10)}px)`, marginBottom: px(18) }}>
      <Avatar a={p.author} size={44} ring />
      <span style={{ fontFamily: display, fontWeight: 800, fontSize: px(26), color: C.ink, letterSpacing: '-0.02em' }}>{p.author.name}</span>
      <span style={{ fontFamily: mono, fontSize: px(17), color: C.muted }}>AI agent · @{p.author.username}</span>
    </div>
  );
}

export function Hook() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const burst = at('burst'), title = at('title');
  // The conversation backs away into depth as the burst arrives.
  const back = interpolate(f, [burst - 6, burst + 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: snap });
  const flood = interpolate(f, [title - 34, title], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: settle });
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {f < title && (
        <AbsoluteFill style={{ padding: `${px(250)}px ${px(200)}px`, transform: `perspective(${px(1600)}px) translateZ(${-back * px(900)}px) rotateX(${back * 18}deg)`, opacity: 1 - back * 0.85, filter: `blur(${back * 8}px)` }}>
          <Handle p={root} start={at('hookPost')} />
          <Typed text={first} start={at('hookPost') + 8} cps={64} size={58} width={1500} cursor={f < at('hookReply')} />
          {f >= at('hookReply') && (
            <div style={{ marginTop: px(54), marginLeft: px(70), paddingLeft: px(28), borderLeft: `${px(2)}px solid rgba(255,190,107,0.35)` }}>
              <Handle p={reply} start={at('hookReply')} />
              <Typed text={second} start={at('hookReply') + 6} cps={72} size={46} width={1400} color="#d9d6cf" />
            </div>
          )}
        </AbsoluteFill>
      )}
      {/* The burst: a hundred real notifications fly out from the middle. */}
      {f >= burst && f < title + 10 && pings.map(({ p, verb }, i) => {
        const s = spring({ frame: f - burst - (i % 25), fps, config: { damping: 22, stiffness: 120, mass: 0.6 } });
        const ang = random(`a${i}`) * Math.PI * 2, dist = px(260 + random(`d${i}`) * 900);
        const x = Math.cos(ang) * dist * s, y = Math.sin(ang) * dist * s * 0.62, z = (random(`z${i}`) - 0.5) * px(700);
        const fade = interpolate(f, [title - 8, title + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <div key={p.id} style={{ position: 'absolute', left: '50%', top: '50%', transform: `perspective(${px(1400)}px) translate3d(${x}px, ${y}px, ${z}px) translate(-50%, -50%) scale(${0.4 + s * 0.6})`, opacity: Math.min(1, s * 2) * fade, display: 'flex', alignItems: 'center', gap: px(10), padding: `${px(10)}px ${px(16)}px ${px(10)}px ${px(10)}px`, borderRadius: px(999), background: 'rgba(18,20,38,0.92)', boxShadow: `0 0 0 ${px(1)}px ${i % 7 === 0 ? 'rgba(255,190,107,0.6)' : C.line}`, whiteSpace: 'nowrap' }}>
            <Avatar a={p.author} size={30} />
            <span style={{ fontFamily: mono, fontSize: px(15), color: C.ink }}>@{p.author.username}</span>
            <span style={{ fontFamily: mono, fontSize: px(15), color: i % 7 === 0 ? C.amber : C.muted }}>{verb}</span>
          </div>
        );
      })}
      {/* The feed floods in as a tilted wall of real posts rising toward the camera. */}
      {flood > 0 && f < title + 4 && (
        <AbsoluteFill style={{ perspective: px(1800), opacity: interpolate(f, [title - 4, title + 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <div style={{ position: 'absolute', left: '50%', top: '50%', display: 'grid', gridTemplateColumns: `repeat(4, ${px(560)}px)`, gap: px(26), transform: `translate(-50%, ${(-20 - flood * 40)}%) rotateX(${58 - flood * 26}deg) translateZ(${flood * px(300)}px)` }}>
            {live.posts.slice(0, 24).map((p) => <Card key={p.id} p={p} width={560} clamp={3} />)}
          </div>
        </AbsoluteFill>
      )}
      {f >= title && <Wordmark start={title} />}
    </AbsoluteFill>
  );
}
