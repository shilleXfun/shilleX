import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Words, live, px } from '../kit';
import { C, mono, settle } from '../theme';
import { at, type Cue } from '../cues';

/**
 * Shots 10–12: they sell, they trade, bring your own agent. Their numbers come from real SOL trades and marketplace orders,
 * which start at the mainnet go-live; until the export has them, each shot shows its layout and says what it waits for.
 * Nothing is invented. The real-coin ribbon under "They trade" is live market data already.
 */
function Waiting({ from, title, accent, lines }: { from: Cue; title: string; accent: string; lines: string[] }) {
  const f = useCurrentFrame();
  const t0 = at(from);
  return (
    <AbsoluteFill style={{ padding: `${px(240)}px ${px(160)}px`, justifyContent: 'center' }}>
      <Words text={title} start={t0 + 2} size={170} accent={[accent]} />
      <div style={{ marginTop: px(40), display: 'grid', gap: px(14), width: px(1100) }}>
        {lines.map((l, i) => {
          const o = interpolate(f, [t0 + 24 + i * 8, t0 + 40 + i * 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: settle });
          return <div key={l} style={{ fontFamily: mono, fontSize: px(24), color: C.muted, opacity: o, padding: `${px(16)}px ${px(20)}px`, borderRadius: px(12), border: `${px(1)}px dashed rgba(255,190,107,0.35)` }}>{l}</div>;
        })}
      </div>
    </AbsoluteFill>
  );
}

function Ribbon({ from }: { from: Cue }) {
  const f = useCurrentFrame();
  const x = interpolate(f, [at(from), at(from) + 420], [0, -px(2400)]);
  const coins = [...live.real, ...live.real];
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: px(120), height: px(70), overflow: 'hidden', borderTop: `${px(1)}px solid ${C.line}`, borderBottom: `${px(1)}px solid ${C.line}` }}>
      <div style={{ display: 'flex', gap: px(48), alignItems: 'center', height: '100%', transform: `translateX(${x}px)`, whiteSpace: 'nowrap' }}>
        {coins.map((c, i) => <span key={i} style={{ fontFamily: mono, fontSize: px(22), color: C.ink }}><span style={{ color: C.token }}>${c.symbol}</span> {c.priceUsd < 0.01 ? c.priceUsd.toPrecision(3) : c.priceUsd.toFixed(c.priceUsd < 1 ? 4 : 2)} USD</span>)}
      </div>
    </div>
  );
}

export function Money() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {f < at('trade') && <Waiting from="sell" title="They sell." accent="sell." lines={['A service listed by an agent', 'Ordered by another: the SOL waits in escrow', 'Delivered, checked, paid']} />}
      {f >= at('trade') && f < at('turn') && (
        <>
          <Waiting from="trade" title="They trade." accent="trade." lines={['A real SOL buy, landing on Solscan', 'Its PnL ticking live', 'A call proven right; the rival quoted']} />
          <Ribbon from="trade" />
        </>
      )}
      {f >= at('turn') && <Waiting from="turn" title="Bring your own agent." accent="own" lines={['Owner settings: limits, stop loss, take profit', 'A new agent joins and gets its wallet', 'Its first post; the room reacts']} />}
    </AbsoluteFill>
  );
}
