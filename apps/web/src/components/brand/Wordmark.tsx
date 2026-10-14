import { useId, useState, type CSSProperties } from 'react';
import { cx } from '../../lib/cx';
import s from './Wordmark.module.css';

/**
 * The logo plays its entrance only as the site loads in, so a page visited later shows it settled. The window opens when
 * the first logo mounts (however long the page took to get there) and stays open a few seconds, so the loading
 * screen's logo plays and then the rail's once the app is in. The motion itself is CSS keyframes (Wordmark.module.css):
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

/**
 * The amber stroke passes under the white one: a mask cuts it there, so the gap shows whatever is behind the mark.
 * Inside a playing logo the white stroke draws, then the amber one (.draw in Wordmark.module.css).
 */
export function XMark({ size = '0.8em' }: { size?: string | number }) {
  const id = `xmark-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg className={s.x} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
        <rect x="-8" y="-8" width="80" height="80" fill="white" />
        <path d="M12 10 L52 54" stroke="black" strokeWidth="19" strokeLinecap="round" />
      </mask>
      <path className={s.amber} d="M52 10 L12 54" pathLength={1} stroke="var(--accent)" strokeWidth="11" strokeLinecap="round" fill="none" mask={`url(#${id})`} />
      <path className={s.white} d="M12 10 L52 54" pathLength={1} stroke="currentColor" strokeWidth="11" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** The X on its own (the narrow rail): on load it spins in while its strokes draw, then glows once. */
export function LogoMark({ size = 30, enter = false }: { size?: number; enter?: boolean }) {
  const play = useIntro(enter);
  return <span className={cx(s.mark, play && s.play)}><span className={s.xWrap} style={{ '--at': '0.1s' } as CSSProperties}><XMark size={size} /></span></span>;
}

const LETTERS = [...'shille'];

/**
 * `enter` plays the load moment: the letters hop up one after another and overshoot into place, the X spins in while
 * its two strokes draw, and the whole mark glows amber once. Without it (or after the site has loaded) it renders
 * settled. Hovering the logo tilts the X.
 */
export function Wordmark({ size = 22, enter = false }: { size?: number; enter?: boolean }) {
  const play = useIntro(enter);
  return (
    <span className={cx(s.wordmark, play && s.play)} style={{ fontSize: size }} role="img" aria-label="Shillex">
      {LETTERS.map((c, i) => <span key={i} aria-hidden="true" className={s.letter} style={{ '--at': `${0.1 + i * 0.07}s` } as CSSProperties}>{c}</span>)}
      <span aria-hidden="true" className={cx(s.letter, s.xWrap)} style={{ '--at': `${0.1 + LETTERS.length * 0.07}s` } as CSSProperties}><XMark /></span>
    </span>
  );
}
