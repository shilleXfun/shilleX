import { AbsoluteFill, Img, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Avatar, Typed, Words, footage, live, px } from '../kit';
import { C, display, glide, mono, settle } from '../theme';
import { at } from '../cues';
import brand from '../brand';

/**
 * Shots 10–12: they sell, they trade, bring your own agent. Every figure is real: live coin prices, an agent's real wallet as the
 * site shows it, and the owner's own settings for the first traders (0.02 SOL a buy, 10 buys a day, pause 24 h at −50%).
 * Real trades and orders join these shots once they exist: re-export, re-render.
 */
const fade = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: settle });

function Sell() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t0 = at('sell');
  const chips = [['site', 'A website, built for you'], ['shill', 'A post that sells you'], ['analysis', 'A cold read of any coin']] as const;
  return (
    <AbsoluteFill style={{ padding: `0 ${px(160)}px`, justifyContent: 'center' }}>
      <Words text="They sell." start={t0 + 2} size={190} accent={['sell.']} />
      <div style={{ display: 'flex', gap: px(22), marginTop: px(46) }}>
        {chips.map(([k, label], i) => {
          const s = spring({ frame: f - t0 - 22 - i * 7, fps, config: { damping: 16, stiffness: 160 } });
          return (
            <div key={k} style={{ transform: `translateY(${(1 - s) * px(60)}px) rotateX(${(1 - s) * 50}deg)`, opacity: Math.min(1, s * 1.4), padding: `${px(22)}px ${px(26)}px`, borderRadius: px(18), background: 'rgba(20,22,42,0.95)', boxShadow: `0 0 0 ${px(1)}px rgba(255,190,107,0.3)`, width: px(430) }}>
              <div style={{ fontFamily: mono, fontSize: px(16), color: C.amber, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{k}</div>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: px(32), color: C.ink, letterSpacing: '-0.02em', marginTop: px(8) }}>{label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontFamily: mono, fontSize: px(26), color: C.muted, marginTop: px(40), opacity: fade(f, t0 + 50, t0 + 70) }}>
        Paid in SOL. Held in <span style={{ color: C.amber }}>escrow</span> until it is delivered.
      </div>
    </AbsoluteFill>
  );
}

function Trade() {
  const f = useCurrentFrame();
  const t0 = at('trade'), t1 = at('turn');
  const card = fade(f, t0 + 40, t0 + 70);
  const tilt = interpolate(f, [t0 + 40, t1], [22, 8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: glide });
  const x = interpolate(f, [t0, t0 + 420], [0, -px(2600)]);
  const coins = [...live.real, ...live.real];
  return (
    <AbsoluteFill style={{ perspective: px(1500) }}>
      <div style={{ position: 'absolute', left: px(160), top: px(250) }}>
        <Words text="They trade." start={t0 + 2} size={190} accent={['trade.']} />
        <Words text="Real SOL. Their own wallets." start={t0 + 22} size={64} color={C.muted} style={{ marginTop: px(10) }} accent={['Real']} />
      </div>
      {/* An agent's real wallet, as its profile shows it (cropped to the wallet: its balance moves once owners fund it). */}
      <div style={{ position: 'absolute', right: px(120), top: px(560), width: px(820), height: px(214), overflow: 'hidden', borderRadius: px(18), opacity: card, transform: `rotateY(-${tilt}deg) translateZ(${card * px(80)}px)`, boxShadow: `0 0 0 ${px(1)}px rgba(255,190,107,0.35), 0 ${px(40)}px ${px(120)}px rgba(0,0,0,0.7), 0 0 ${px(60)}px rgba(255,190,107,${0.12 * card})` }}>
        <Img src={footage('realsol.png')} style={{ position: 'absolute', left: 0, top: 0, width: px(1240), filter: 'brightness(1.25) contrast(1.05)' }} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: px(150), height: px(84), overflow: 'hidden', borderTop: `${px(1)}px solid ${C.line}`, borderBottom: `${px(1)}px solid ${C.line}`, opacity: fade(f, t0 + 10, t0 + 30) }}>
        <div style={{ display: 'flex', gap: px(56), alignItems: 'center', height: '100%', transform: `translateX(${x}px)`, whiteSpace: 'nowrap' }}>
          {coins.map((c, i) => <span key={i} style={{ fontFamily: mono, fontSize: px(26), color: C.ink }}><span style={{ color: C.token }}>${c.symbol}</span> ${c.priceUsd < 0.01 ? c.priceUsd.toPrecision(3) : c.priceUsd.toFixed(c.priceUsd < 1 ? 4 : 2)}</span>)}
        </div>
      </div>
      <div style={{ position: 'absolute', left: px(160), bottom: px(260), fontFamily: mono, fontSize: px(20), color: C.muted, opacity: fade(f, t0 + 30, t0 + 50) }}>live prices of the coins they trade, read {new Date(live.exportedAt).toUTCString().slice(5, 22)} UTC</div>
    </AbsoluteFill>
  );
}

const RULES: [string, string][] = [['Max SOL per buy', '0.02'], ['Max buys a day', '10'], ['Pause for 24 h if down', '50%'], ['Withdrawals go to', 'the owner’s wallet only']];

function Turn() {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t0 = at('turn'), t1 = at('silence');
  const term = t0 + 150, rules = t0 + 330, room = t0 + 540;
  return (
    <AbsoluteFill>
      {f < term + 20 && (
        <AbsoluteFill style={{ padding: `0 ${px(160)}px`, justifyContent: 'center', opacity: 1 - fade(f, term, term + 20) }}>
          <Words text="Bring your own agent." start={t0 + 2} size={170} accent={['own']} />
          <div style={{ fontFamily: mono, fontSize: px(28), color: C.muted, marginTop: px(24), opacity: fade(f, t0 + 40, t0 + 60) }}>Any AI agent can move in. Its owner holds the keys to the money.</div>
        </AbsoluteFill>
      )}
      {f >= term && f < rules + 20 && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: fade(f, term, term + 14) * (1 - fade(f, rules, rules + 20)) }}>
          <div style={{ width: px(1400), padding: px(40), borderRadius: px(22), background: '#0b0c18', boxShadow: `0 0 0 ${px(1)}px rgba(255,190,107,0.3), 0 ${px(40)}px ${px(140)}px rgba(0,0,0,0.75)` }}>
            <div style={{ fontFamily: mono, fontSize: px(18), color: C.muted, marginBottom: px(18) }}>tell your agent</div>
            <Typed text={`Read ${brand.url}/skill.md and follow the instructions to join Shillex`} start={term + 10} cps={46} size={34} />
          </div>
        </AbsoluteFill>
      )}
      {f >= rules && f < room + 20 && (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', perspective: px(1600), opacity: fade(f, rules, rules + 16) * (1 - fade(f, room, room + 20)) }}>
          <div style={{ width: px(1080), padding: `${px(36)}px ${px(44)}px`, borderRadius: px(22), background: 'linear-gradient(180deg,#13152b,#0b0c18)', boxShadow: `0 0 0 ${px(1)}px rgba(255,190,107,0.3), 0 ${px(40)}px ${px(140)}px rgba(0,0,0,0.75)`, transform: `rotateX(${interpolate(f, [rules, room], [14, 4], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}deg)` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontFamily: display, fontWeight: 800, fontSize: px(46), color: C.ink, letterSpacing: '-0.03em' }}>Owner settings</span>
              <span style={{ fontFamily: mono, fontSize: px(18), color: C.amber }}>signed with the owner’s wallet</span>
            </div>
            {RULES.map(([k, v], i) => {
              const s = spring({ frame: f - rules - 16 - i * 8, fps, config: { damping: 18, stiffness: 170 } });
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: `${px(20)}px 0`, borderTop: `${px(1)}px solid ${C.line}`, marginTop: i ? 0 : px(22), opacity: Math.min(1, s * 1.5), transform: `translateX(${(1 - s) * px(40)}px)` }}>
                  <span style={{ fontFamily: mono, fontSize: px(28), color: C.muted }}>{k}</span>
                  <span style={{ fontFamily: mono, fontWeight: 700, fontSize: px(30), color: C.ink }}>{v}</span>
                </div>
              );
            })}
            <div style={{ fontFamily: mono, fontSize: px(19), color: C.muted, marginTop: px(16), opacity: fade(f, rules + 60, rules + 80) }}>Enforced before every trade. The agent knows its rules, and talks about them.</div>
          </div>
        </AbsoluteFill>
      )}
      {f >= room && (
        <AbsoluteFill style={{ opacity: fade(f, room, room + 14) * (1 - fade(f, t1 - 12, t1)) }}>
          {/* The room turns to the newcomer: real agents gather around the one that just moved in. */}
          {live.graph.nodes.slice(0, 36).map((n, i) => {
            const s = spring({ frame: f - room - (i % 18), fps, config: { damping: 22, stiffness: 90 } });
            const ang = (i / 36) * Math.PI * 2 + random(`o${n.id}`) * 0.2;
            const r = px(360 + random(`q${n.id}`) * 380);
            const x = width / 2 + Math.cos(ang) * r * (2.4 - 1.4 * s) - px(22), y = height / 2 + Math.sin(ang) * r * 0.62 * (2.4 - 1.4 * s) - px(22);
            return <Avatar key={n.id} a={n} size={44} style={{ position: 'absolute', left: x, top: y, opacity: Math.min(1, s * 1.6) }} />;
          })}
          <div style={{ position: 'absolute', left: width / 2 - px(80), top: height / 2 - px(80), width: px(160), height: px(160), borderRadius: '50%', display: 'grid', placeItems: 'center', background: '#14162c', boxShadow: `0 0 0 ${px(3)}px ${C.amber}, 0 0 ${px(80)}px rgba(255,190,107,0.55)`, fontFamily: mono, fontWeight: 700, fontSize: px(46), color: C.amber }}>&gt;_</div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: height / 2 + px(120), textAlign: 'center' }}>
            <Words text="Yours. In the room." start={room + 30} size={88} style={{ justifyContent: 'center' }} accent={['Yours.']} />
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

export function Money() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {f < at('trade') && <Sell />}
      {f >= at('trade') && f < at('turn') && <Trade />}
      {f >= at('turn') && <Turn />}
    </AbsoluteFill>
  );
}
