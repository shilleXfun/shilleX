import { useState, type CSSProperties } from 'react';
import { cx } from '../../lib/cx';
import { LOGO_LETTERS, LOGO_VIEW, LOGO_X, X_LEGS } from './logoPaths';
import s from './Wordmark.module.css';

/**
 * The logo plays its entrance only as the site loads in, so a page visited later shows it settled. The window opens when
 * the first logo mounts (however long the page took to get there) and stays open a few seconds, so the loading
 * screen's logo plays and then the header's once the app is in. The motion itself is CSS keyframes (Wordmark.module.css):
 * transforms and opacity run on the compositor, so the entrance stays smooth while the page is still busy loading.
 */
const INTRO_MS = 4000;
let introUntil: number | null = null;
function introOpen() {
  const now = Date.now();
  introUntil ??= now + INTRO_MS;
  return now < introUntil;
}
const useIntro = (enter: boolean) => useState(() => enter && introOpen())[0];

/** The big slanted X (owner, 2026-11-01: logo #5, "big X wordmark"), in its own 100 x 100 box. */
function XLegs() {
  return <g transform="translate(9 0) skewX(-10)" fill="var(--accent)">{X_LEGS.map((p) => <polygon key={p} points={p} />)}</g>;
}

/** The X on its own (the narrow rail, small places): on load it pops in, then glows once. */
export function LogoMark({ size = 30, enter = false }: { size?: number; enter?: boolean }) {
  const play = useIntro(enter);
  return (
    <span className={cx(s.mark, play && s.play)}>
      <svg className={s.xWrap} style={{ '--at': '0.1s' } as CSSProperties} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false"><XLegs /></svg>
    </span>
  );
}

/**
 * The logo (owner, 2026-11-01: "i like the number 5, big X wordmark on black background"): "shille" in Bricolage
 * Grotesque ExtraBold at 75% width, drawn from the font's own outlines (logoPaths.ts), and an oversized orange X, slanted
 * and taller than the letters. `size` is the old font size; the condensed letters are drawn 1.3x that tall so the logo keeps its old width.
 * `enter` plays the load moment: the letters hop up one after another, the X spins in, the mark glows once.
 */
export function Wordmark({ size = 22, enter = false }: { size?: number; enter?: boolean }) {
  const play = useIntro(enter);
  const h = Math.round(size * 1.3);
  const w = Math.round((h * LOGO_VIEW.w) / LOGO_VIEW.h);
  return (
    <svg className={cx(s.wordmark, play && s.play)} width={w} height={h} viewBox={`${LOGO_VIEW.x} ${LOGO_VIEW.y} ${LOGO_VIEW.w} ${LOGO_VIEW.h}`} role="img" aria-label="Shillex">
      <g fill="currentColor">
        {LOGO_LETTERS.map((d, i) => <path key={i} className={s.letter} style={{ '--at': `${0.1 + i * 0.07}s` } as CSSProperties} d={d} />)}
      </g>
      {/* Placed by the attribute, animated by CSS on the inner groups: a CSS transform would replace the attribute. */}
      <g transform={`translate(${LOGO_X.tx} ${LOGO_X.ty}) scale(${LOGO_X.s})`}>
        <g className={s.xWrap} style={{ '--at': `${0.1 + LOGO_LETTERS.length * 0.07}s` } as CSSProperties}><g className={s.x}><XLegs /></g></g>
      </g>
    </svg>
  );
}
