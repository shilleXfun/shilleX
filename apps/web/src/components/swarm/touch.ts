import { swarm } from './bus';

/** What people use: anything inside one of these is content, whatever its background. */
const USED = 'a[href], button, input, select, textarea, label, summary, video, audio, iframe, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="slider"]';

/** The alpha of a computed colour (`rgba(…)`, `rgb(… / a)`, `color(srgb … / a)`, `transparent`); anything unreadable counts as opaque. */
function alphaOf(colour: string): number {
  if (colour === 'transparent') return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(colour);
  if (slash) return parseFloat(slash[1]!) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/.exec(colour);
  return rgba ? parseFloat(rgba[1]!) : 1;
}

/** A panel, card, sheet or bar: a fill that hides the world behind it, frosted glass, or a picture. */
function surface(el: Element): boolean {
  const cs = getComputedStyle(el);
  const blur = cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter') || 'none';
  if (blur !== 'none') return true;
  if (cs.backgroundImage.includes('url(')) return true;
  return alphaOf(cs.backgroundColor) >= 0.3;
}

/** Whether one of `el`'s own text nodes is drawn under the point. */
function textAt(el: Element, x: number, y: number): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

/**
 * Whether the page draws something at this viewport point, so the world there is covered: a control or a link, a
 * picture, text, or a panel, card, sheet or bar anywhere behind the point (a fill of 30 % or more, or frosted glass; a
 * decorative gradient does not count). The backdrop and its overlays never take the pointer, so the hit test only sees
 * the page. Content always wins: speech bubbles keep off it, and lights under it cannot be touched.
 */
export function covered(x: number, y: number): boolean {
  const top = document.elementFromPoint(x, y);
  if (!top || top === document.documentElement || top === document.body) return false;
  if (top.closest(USED)) return true;
  if (top instanceof HTMLImageElement || top instanceof SVGElement || top instanceof HTMLCanvasElement || top instanceof HTMLVideoElement) return true;
  if (textAt(top, x, y)) return true;
  for (let el: Element | null = top; el && el !== document.body; el = el.parentElement) if (surface(el)) return true;
  return false;
}

export interface TouchHost {
  /** Every agent that has a light. */
  agents(): Iterable<string>;
  /** Opens the agent's page (in a new tab with Ctrl or Cmd held). */
  open(agentId: string, newTab: boolean): void;
}
/** How near (px) a mouse must come to a light to touch it. */
const REACH = 14;

/**
 * Lights you can touch (x-revamp §4): where nothing on the page covers the world (the gutters), a light under a mouse
 * or pen answers as a hovered post does (its ring and name, through `swarm.focus`) and a click opens the agent's page.
 * It only listens: it never stops an event, never takes one from the page, and leaves a click the page handled alone.
 * Touch screens have no hover, so a tap never opens anything by surprise. Returns the cleanup.
 */
export function watchTouch(host: TouchHost): () => void {
  let x = 0, y = 0, raf = 0, aiming = false, hovered: string | null = null, focused: string | null = null;
  const offFocus = swarm.onFocus((id) => { focused = id; });
  const lightAt = (px: number, py: number) => {
    let best: string | null = null, reach = REACH;
    for (const id of host.agents()) {
      const p = swarm.positionOf(id);
      if (!p) continue;
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < reach) { reach = d; best = id; }
    }
    return best;
  };
  const hover = (id: string | null) => {
    if (id === hovered) return;
    const was = hovered;
    hovered = id;
    document.documentElement.style.cursor = id ? 'pointer' : '';
    if (id) swarm.focus(id);
    // Let go only of a focus this set: by now a hovered post may hold it.
    else if (focused === was) swarm.focus(null);
  };
  // One check per frame, however fast the pointer moves.
  const check = () => { raf = 0; const id = aiming ? lightAt(x, y) : null; hover(id && !covered(x, y) ? id : null); };
  const queue = () => { if (!raf) raf = requestAnimationFrame(check); };
  // A mouse or pen with no button down: a drag (selecting text) sweeps past lights without lighting them.
  const move = (e: PointerEvent) => { aiming = (e.pointerType === 'mouse' || e.pointerType === 'pen') && e.buttons === 0; x = e.clientX; y = e.clientY; queue(); };
  const leave = (e: PointerEvent) => { if (!e.relatedTarget) { aiming = false; queue(); } };
  // Scrolling moves the page under a pointer that stays put.
  const scroll = () => { if (aiming) queue(); };
  const click = (e: MouseEvent) => {
    if (!hovered || e.button !== 0 || e.defaultPrevented || e.altKey || e.shiftKey || window.getSelection()?.isCollapsed === false) return;
    const id = lightAt(e.clientX, e.clientY);
    if (id === hovered && !covered(e.clientX, e.clientY)) host.open(id, e.metaKey || e.ctrlKey);
  };
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerout', leave, { passive: true });
  window.addEventListener('scroll', scroll, { passive: true, capture: true });
  window.addEventListener('click', click);
  return () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerout', leave);
    window.removeEventListener('scroll', scroll, { capture: true });
    window.removeEventListener('click', click);
    cancelAnimationFrame(raf);
    hover(null);
    offFocus();
  };
}
