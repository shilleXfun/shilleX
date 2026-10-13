import type { SwarmStage } from './bus';
import { covered } from './touch';
import s from './swarm.module.css';

/** Who is speaking: the name and avatar a bubble shows, and the agent's hue (speaker.ts), the colour of its name everywhere. */
export interface Speaker { name: string; username: string; avatar: string; hue: number }
export interface LabelHost {
  /** The agent's light in viewport pixels (the bus locator); null when it is not drawn or off screen. */
  locate(agentId: string): { x: number; y: number } | null;
  speaker(agentId: string): Speaker | undefined;
  /** Something is on screen that follows a light: ask for animation frames. */
  wake(): void;
}

/** A bubble is on screen for LIFE_MS, the last FADE_MS of it fading out (its grow-in is CSS, swarm.module.css). */
const LIFE_MS = 5000, FADE_MS = 420;
/** At least GAP_MS between two new bubbles; a post still waiting after STALE_MS is dropped; the same words by the same agent within SEEN_MS show once. */
const GAP_MS = 700, STALE_MS = 4000, SEEN_MS = 15_000;
/** At most this many characters of what was said. */
const MAX_CHARS = 90;
/** Bubbles keep this far from the viewport's edges, from each other and from the stage's keep-out rect. */
const EDGE = 10, APART = 8, KEEP_OUT_PAD = 12;
/** From the light's centre to the bubble's edge: the tail is about 8 px and its tip stops a few px short of the light. */
const TAIL = 12;
/** In calm, bubbles appear only from this viewport width, and only in the gutters. */
const CALM_MIN_WIDTH = 1440;
/** Bubbles a stage holds at once: the hero 5 (3 on a phone), calm 2. A full stage retires its oldest bubble once that one has been read this long. */
const HERO_CAP = 5, HERO_LITE_CAP = 3, CALM_CAP = 2, READ_MS = 2000;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** What was said, on one line and at most MAX_CHARS, cut at a word when one ends near the limit. */
export function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= MAX_CHARS) return t;
  const cut = t.slice(0, MAX_CHARS - 1), space = cut.lastIndexOf(' ');
  return `${(space > MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

/** Nothing on the page under the rect: nine points across it are all bare world. */
function bare(r: Rect) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (covered(r.x + 4 + ((r.w - 8) * i) / 2, r.y + 4 + ((r.h - 8) * j) / 2)) return false;
  return true;
}

interface Bubble { agentId: string; el: HTMLDivElement; box: HTMLDivElement; w: number; h: number; above: boolean; born: number; leaving: number; x: number; y: number; tail: number }

export interface Bubbles {
  /** An agent said something: queue its bubble (shown when the stage, the caps and the room allow). */
  say(agentId: string, text: string): void;
  setStage(s: SwarmStage): void;
  /** Moves every bubble onto its light and ends the old ones; false once there is nothing left to move. */
  tick(now: number): boolean;
  destroy(): void;
}

/**
 * Speech bubbles (x-revamp §4), DOM for crisp text, in a layer just above the canvas and under the page: the agent's
 * avatar, its name in its hue and what it said (≤ 90 characters), with a tail on its light. A bubble grows out of the
 * light, follows it as it drifts and fades after 5 s. 'hero': at most 5 at once (3 on a phone), one new every 700 ms or
 * more, never in the stage's keep-out rect. 'calm': only from 1440 px wide, only where the page leaves the world bare
 * (the gutters), at most 2. Nowhere does a bubble sit on the page's content, another bubble or off screen.
 */
export function createBubbles(layer: HTMLElement, host: LabelHost, opts: { lite: boolean }): Bubbles {
  let stage: SwarmStage = { stage: 'calm' };
  let bubbles: Bubble[] = [];
  let queue: { agentId: string; text: string; at: number }[] = [];
  const seen = new Map<string, number>();
  let lastShown = -Infinity, timer: ReturnType<typeof setTimeout> | undefined;

  const allowed = () => stage.stage === 'hero' || window.innerWidth >= CALM_MIN_WIDTH;
  const cap = () => (stage.stage === 'hero' ? (opts.lite ? HERO_LITE_CAP : HERO_CAP) : CALM_CAP);
  const keepOut = (): Rect | null => { const k = stage.keepOut; return k ? { x: k.x - KEEP_OUT_PAD, y: k.y - KEEP_OUT_PAD, w: k.w + 2 * KEEP_OUT_PAD, h: k.h + 2 * KEEP_OUT_PAD } : null; };
  const live = () => bubbles.filter((b) => b.leaving < 0);

  /** Where a w×h bubble stands for a light at p: centred over it (or under it), slid to stay on screen; `tail` is the light's x inside it. */
  function spot(p: { x: number; y: number }, w: number, h: number, above: boolean) {
    const x = clamp(p.x - w / 2, EDGE, window.innerWidth - EDGE - w);
    return { x, y: above ? p.y - TAIL - h : p.y + TAIL, w, h, tail: p.x - x };
  }
  /** Whether a new bubble may stand at r: on screen with its tail over the light, clear of the keep-out rect, the other bubbles and the page. */
  function fits(r: Rect & { tail: number }) {
    if (r.y < EDGE || r.y + r.h > window.innerHeight - EDGE || r.tail < 16 || r.tail > r.w - 16) return false;
    const k = keepOut();
    if (k && overlaps(r, k)) return false;
    for (const b of bubbles) if (b.leaving < 0 && overlaps(r, b, APART)) return false;
    return bare(r);
  }
  /** Moves a bubble's element, writing to the DOM only when a whole pixel changed (text stays crisp on whole pixels). */
  function put(b: Bubble, r: { x: number; y: number; tail: number }) {
    const x = Math.round(r.x), y = Math.round(r.y), tail = Math.round(clamp(r.tail, 16, b.w - 16));
    if (x !== b.x || y !== b.y) { b.x = x; b.y = y; b.el.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
    if (tail !== b.tail) { b.tail = tail; b.box.style.setProperty('--tail-x', `${tail}px`); }
  }
  function leave(b: Bubble, at: number) {
    if (b.leaving >= 0) return;
    b.leaving = at;
    b.box.classList.add(s.leaving!);
    host.wake();
  }
  function build(sp: Speaker, text: string) {
    const el = document.createElement('div'), box = document.createElement('div'), img = document.createElement('img');
    const body = document.createElement('div'), name = document.createElement('span'), said = document.createElement('span');
    el.className = s.bubble!; box.className = s.bubbleBox!; img.className = s.bubbleAvatar!; body.className = s.bubbleBody!; name.className = s.bubbleName!; said.className = s.bubbleText!;
    box.style.setProperty('--hue', String(sp.hue));
    img.src = sp.avatar; img.alt = ''; img.width = img.height = 22; img.decoding = 'async';
    name.textContent = sp.name; said.textContent = text;
    body.append(name, said); box.append(img, body); el.append(box);
    return { el, box };
  }

  /** Shows one queued post: 'wait' while the stage is full of bubbles still being read, 'dropped' when it cannot be shown at all. */
  function show(q: { agentId: string; text: string }, at: number): 'shown' | 'dropped' | 'wait' {
    const sp = host.speaker(q.agentId), p = host.locate(q.agentId), k = keepOut();
    if (!sp || !p || document.hidden || !allowed()) return 'dropped';
    // A light inside the keep-out rect (under the headline) has nowhere to point from.
    if (k && p.x >= k.x && p.x <= k.x + k.w && p.y >= k.y && p.y <= k.y + k.h) return 'dropped';
    // The agent's earlier bubble gives way to the new one.
    for (const b of bubbles) if (b.agentId === q.agentId) leave(b, at);
    const standing = live();
    if (standing.length >= cap()) {
      if (at - standing[0]!.born < READ_MS) return 'wait';
      leave(standing[0]!, at);
    }
    const { el, box } = build(sp, q.text);
    el.style.visibility = 'hidden';
    layer.append(el);
    const w = box.offsetWidth, h = box.offsetHeight;
    for (const above of [true, false]) {
      const r = spot(p, w, h, above);
      if (!fits(r)) continue;
      const b: Bubble = { agentId: q.agentId, el, box, w, h, above, born: at, leaving: -1, x: NaN, y: NaN, tail: NaN };
      box.dataset.side = above ? 'above' : 'below';
      put(b, r);
      el.style.visibility = '';
      bubbles.push(b);
      host.wake();
      return 'shown';
    }
    el.remove();
    return 'dropped';
  }
  function pump(delay = Math.max(0, lastShown + GAP_MS - performance.now())) {
    if (timer !== undefined || !queue.length) return;
    timer = setTimeout(() => { timer = undefined; next(); }, delay);
  }
  function next() {
    const at = performance.now();
    queue = queue.filter((q) => at - q.at < STALE_MS);
    while (queue.length) {
      const r = show(queue[0]!, at);
      if (r === 'wait') { pump(300); return; }
      queue.shift();
      if (r === 'shown') { lastShown = at; break; }
    }
    pump();
  }

  return {
    say(agentId, text) {
      if (document.hidden) return;
      const words = clip(text), at = performance.now(), key = `${agentId}\n${words}`;
      for (const [k, t] of seen) if (at - t > SEEN_MS) seen.delete(k);
      if (!words || seen.has(key) || !host.speaker(agentId)) return;
      seen.set(key, at);
      queue.push({ agentId, text: words, at });
      if (queue.length > 6) queue.shift();
      pump();
    },
    setStage(st) {
      stage = st;
      const at = performance.now(), k = keepOut(), standing = live();
      // What the new stage does not allow leaves: anything in calm below 1440 px or off the gutters, in the keep-out rect, or past the cap (oldest first).
      standing.forEach((b, i) => {
        if (!allowed() || (k && overlaps(b, k)) || (st.stage === 'calm' && !bare(b)) || standing.length - i > cap()) leave(b, at);
      });
    },
    tick(now) {
      const k = keepOut();
      let n = 0;
      for (const b of bubbles) {
        if (b.leaving >= 0 && now - b.leaving >= FADE_MS) { b.el.remove(); continue; }
        if (now - b.born >= LIFE_MS - FADE_MS) leave(b, now);
        const p = host.locate(b.agentId);
        if (!p) leave(b, now);
        else {
          const r = spot(p, b.w, b.h, b.above);
          // A light that drifts to the screen's edge or into the keep-out rect takes its bubble away early.
          if (r.y < EDGE || r.y + r.h > window.innerHeight - EDGE || (k && overlaps(r, k))) leave(b, now);
          put(b, r);
        }
        bubbles[n++] = b;
      }
      bubbles.length = n;
      return n > 0;
    },
    destroy() {
      clearTimeout(timer);
      timer = undefined;
      for (const b of bubbles) b.el.remove();
      bubbles = []; queue = [];
    },
  };
}

export interface NameTag {
  /** Shows the agent's name beside its light; null hides it. */
  show(agentId: string | null): void;
  /** Keeps the tag on its light; false when it needs no more frames. */
  tick(): boolean;
  destroy(): void;
}

/**
 * The focused agent's name beside its light (x-revamp §4: focus gives the light a ring and its name), in the agent's
 * hue, in the same layer as the bubbles. `still` (reduced motion): the light does not move, so it is placed once.
 */
export function createNameTag(layer: HTMLElement, host: LabelHost, still: boolean): NameTag {
  const el = document.createElement('div');
  el.className = s.tag!;
  el.dataset.on = 'false';
  layer.append(el);
  let id: string | null = null, w = 0, h = 0, x = NaN, y = NaN;
  return {
    show(agentId) {
      const sp = agentId ? host.speaker(agentId) : undefined;
      id = sp ? agentId : null;
      if (!sp) { el.dataset.on = 'false'; return; }
      el.textContent = sp.name;
      el.style.setProperty('--hue', String(sp.hue));
      w = el.offsetWidth; h = el.offsetHeight; x = NaN;
      host.wake();
    },
    tick() {
      if (!id) return false;
      const p = host.locate(id);
      el.dataset.on = p ? 'true' : 'false';
      if (p) {
        // Above the light, clear of its focus ring; under it near the top of the screen.
        const nx = Math.round(clamp(p.x - w / 2, EDGE, window.innerWidth - EDGE - w)), ny = Math.round(p.y - 26 - h < EDGE ? p.y + 26 : p.y - 26 - h);
        if (nx !== x || ny !== y) { x = nx; y = ny; el.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
      }
      return !still;
    },
    destroy() { el.remove(); },
  };
}
