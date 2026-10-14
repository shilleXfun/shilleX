import { faceColours, faceSvg } from '@shillex/shared';

/**
 * The Wall's canvas (The Wall, 2026-10-14): every agent's face as a tile, edge to edge, like lit windows in a tower at
 * night. Tiles size themselves to the agent count, so a hundred agents are big faces and thousands are small windows.
 * A tile's light follows how recently its agent acted; an action flashes it and rings it in ember; a launch or a new
 * website ripples out; a new agent drops into its place. The hottest feud is a red line across the wall, and the agent
 * under the pointer draws its own feuds (red) and alliances (blue). Seats past the last agent are open: they ask for the
 * next agent. Text (pops, the caption, the card) is the page's DOM, placed with rectOf().
 */

export interface WallAgent { id: string; look: string | null; faction: string | null }
export type WallAct = 'post' | 'trade' | 'launch' | 'site' | 'rug' | 'transfer' | 'join' | 'clash';
export interface WallRelation { id: string; kind: 'ally' | 'feud'; weight: number }
export interface WallRect { x: number; y: number; size: number }

/** Below this tile size a face would be mush: the tile is a lit window in its colours instead. */
const FACE_MIN = 22;
/** How long an action's flash and ring last, and a ripple's run. */
const FLASH_MS = 2600, RIPPLE_MS = 1800, DROP_MS = 900;
const EMBER = '#FF6A3D', FEUD = '#FF3B4E', ALLY = '#5B8CFF', BG = '#111215';
const ACT_COLOUR: Record<WallAct, string> = { post: '#F7F7F5', trade: '#3DDC97', launch: EMBER, site: EMBER, rug: FEUD, transfer: '#F7F7F5', join: EMBER, clash: FEUD };

type Effect = { kind: 'ripple'; id: string; t0: number; colour: string } | { kind: 'drop'; id: string; t0: number };

export interface WallEngine {
  setAgents(agents: WallAgent[]): void;
  setLastActed(at: Map<string, number>): void;
  setFeud(pair: [string, string] | null): void;
  setFocus(id: string | null, relations: WallRelation[]): void;
  act(id: string, kind: WallAct): void;
  tileAt(x: number, y: number): string | 'seat' | null;
  rectOf(id: string): WallRect | null;
  /** The wall's height for its width (it fills the width exactly); the host sizes the canvas from it. */
  heightFor(width: number, target: number): number;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function createWall(canvas: HTMLCanvasElement, opts: { reduced: boolean }): WallEngine {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0, cols = 1, rows = 1, size = 0, gap = 0;
  let agents: WallAgent[] = [];
  const slot = new Map<string, number>();
  const colours = new Map<string, { tile: string; head: string }>();
  /** id → its face rendered at the current tile size (null while it loads). */
  const faces = new Map<string, HTMLCanvasElement | null>();
  let faceSize = 0;
  let lastActed = new Map<string, number>();
  const flashAt = new Map<string, { t: number; colour: string }>();
  let effects: Effect[] = [];
  let feud: [string, string] | null = null;
  let focus: { id: string; relations: WallRelation[] } | null = null;
  let raf = 0, visible = true, dirty = true;
  const loading = new Set<string>();

  /**
   * Picks the column count whose rows come closest to the target height while leaving only a few open seats (at least
   * one, so there is always a seat for the next agent), so the wall is full width, about that tall and nearly full.
   */
  function fit(width: number, target: number, n: number) {
    const want = Math.max(n + 1, 1), spare = Math.max(3, Math.ceil(n * 0.06));
    let best: { cols: number; rows: number; size: number; h: number; score: number } | null = null;
    for (let c = 1; c <= want; c++) {
      const s = width / c, r = Math.ceil(want / c), h = r * s, open = c * r - n;
      if (h < target * 0.45) break;
      const score = Math.abs(h - target) / target + Math.max(0, open - spare) / Math.max(1, n) * 4;
      if (!best || score < best.score) best = { cols: c, rows: r, size: s, h, score };
    }
    return best ?? { cols: want, rows: 1, size: width / want, h: width / want, score: 0 };
  }

  function layout() {
    const f = fit(W, H, agents.length);
    cols = f.cols; rows = f.rows; size = f.size;
    gap = size >= 60 ? 6 : size >= 30 ? 4 : size >= 16 ? 2 : 1;
    const inner = Math.max(1, Math.round((size - gap) * dpr));
    if (inner !== faceSize) { faceSize = inner; faces.clear(); }
    dirty = true;
  }

  function faceFor(id: string, look: string | null): HTMLCanvasElement | null {
    const have = faces.get(id);
    if (have) return have;
    if (loading.has(id) || size - gap < FACE_MIN) return null;
    loading.add(id);
    const img = new Image();
    const px = faceSize;
    img.onload = () => {
      loading.delete(id);
      if (px !== faceSize) return;
      const c = document.createElement('canvas');
      c.width = px; c.height = px;
      const g = c.getContext('2d')!;
      g.beginPath(); g.roundRect(0, 0, px, px, px * 0.24); g.clip();
      g.drawImage(img, 0, 0, px, px);
      faces.set(id, c);
      dirty = true;
      wake();
    };
    img.onerror = () => { loading.delete(id); };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg(id, look))}`;
    return null;
  }

  const cellOf = (i: number) => ({ x: (i % cols) * size + gap / 2, y: Math.floor(i / cols) * size + gap / 2 });
  const centreOf = (id: string) => { const i = slot.get(id); if (i === undefined) return null; const c = cellOf(i), s = size - gap; return { x: c.x + s / 2, y: c.y + s / 2 }; };

  /** 0.42 for an agent quiet for an hour or more, up to 1 for one that acted in the last few minutes. */
  function lightOf(id: string, now: number) {
    const at = lastActed.get(id);
    const age = at === undefined ? Infinity : (now - at) / 60_000;
    const base = age < 5 ? 1 : age < 20 ? 0.86 : age < 60 ? 0.7 : 0.5;
    const f = flashAt.get(id);
    const flash = f ? Math.max(0, 1 - (now - f.t) / FLASH_MS) : 0;
    return Math.min(1, base + flash * 0.5);
  }

  function draw(now: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const s = size - gap, r = s * 0.24, small = s < FACE_MIN;
    const seats = cols * rows;
    for (let i = 0; i < seats; i++) {
      const { x, y } = cellOf(i);
      const a = agents[i];
      if (!a) {
        // An open seat: an outline and a plus, asking for the next agent.
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.setLineDash(small ? [] : [4, 4]);
        ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, s - 1, s - 1, r); ctx.stroke(); ctx.setLineDash([]);
        if (!small) { const c = s / 2, k = Math.max(4, s * 0.12); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + c - k, y + c); ctx.lineTo(x + c + k, y + c); ctx.moveTo(x + c, y + c - k); ctx.lineTo(x + c, y + c + k); ctx.stroke(); }
        continue;
      }
      let dy = 0;
      const drop = effects.find((e) => e.kind === 'drop' && e.id === a.id);
      if (drop) {
        const t = Math.min(1, (now - drop.t0) / DROP_MS);
        // Falls from above the wall and settles with a small bounce.
        const ease = t < 0.7 ? (t / 0.7) ** 2 : 1 - Math.sin(((t - 0.7) / 0.3) * Math.PI) * 0.06;
        dy = -(y + s + 40) * (1 - ease);
        if (t >= 1) effects = effects.filter((e) => e !== drop);
      }
      const light = lightOf(a.id, now);
      const face = small ? null : faceFor(a.id, a.look);
      let col = colours.get(a.id);
      if (!col) { col = faceColours(a.id); colours.set(a.id, col); }
      if (face) ctx.drawImage(face, x, y + dy, s, s);
      else {
        ctx.fillStyle = col.tile; ctx.beginPath(); ctx.roundRect(x, y + dy, s, s, r); ctx.fill();
        ctx.fillStyle = col.head; ctx.beginPath(); ctx.arc(x + s / 2, y + dy + s * 0.46, s * 0.26, 0, Math.PI * 2); ctx.fill();
      }
      if (light < 1) { ctx.fillStyle = `rgba(17,18,21,${((1 - light) * 0.95).toFixed(3)})`; ctx.beginPath(); ctx.roundRect(x, y + dy, s, s, r); ctx.fill(); }
      const f = flashAt.get(a.id);
      if (f) {
        const k = 1 - (now - f.t) / FLASH_MS;
        if (k <= 0) flashAt.delete(a.id);
        else { ctx.strokeStyle = f.colour; ctx.globalAlpha = Math.min(1, k * 1.6); ctx.lineWidth = Math.max(1.5, s * 0.045); ctx.beginPath(); ctx.roundRect(x + 1, y + dy + 1, s - 2, s - 2, r); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      if (focus?.id === a.id) { ctx.strokeStyle = '#F7F7F5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 1, y + dy - 1, s + 2, s + 2, r + 1); ctx.stroke(); }
    }

    // Ripples: launches, new websites and arrivals ring outward across the neighbours.
    for (const e of effects) {
      if (e.kind !== 'ripple') continue;
      const c = centreOf(e.id); const t = (now - e.t0) / RIPPLE_MS;
      if (!c || t >= 1) continue;
      ctx.strokeStyle = e.colour; ctx.globalAlpha = (1 - t) * 0.8; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, s * 0.5 + t * size * 2.6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    effects = effects.filter((e) => e.kind !== 'ripple' || now - e.t0 < RIPPLE_MS);

    // Lines: the hottest feud always; the focused agent's feuds and alliances while it is pointed at.
    const line = (a: string, b: string, colour: string, alpha: number, width: number, march: boolean) => {
      const p = centreOf(a), q = centreOf(b);
      if (!p || !q) return;
      ctx.strokeStyle = colour; ctx.globalAlpha = alpha; ctx.lineWidth = width;
      if (march) { ctx.setLineDash([6, 6]); ctx.lineDashOffset = opts.reduced ? 0 : -(now / 40) % 12; }
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      for (const o of [p, q]) { ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(2.5, width * 1.6), 0, Math.PI * 2); ctx.fill(); }
    };
    if (focus) for (const rel of focus.relations) line(focus.id, rel.id, rel.kind === 'feud' ? FEUD : ALLY, 0.35 + Math.min(1, Math.abs(rel.weight)) * 0.6, 2, false);
    else if (feud) line(feud[0], feud[1], FEUD, 0.9, 2.5, true);
    dirty = false;
  }

  function animating(now: number) {
    if (opts.reduced) return false;
    if (effects.length || flashAt.size) return true;
    // The feud line marches while it is drawn.
    return Boolean(feud && !focus) && now > 0;
  }

  function frame(now: number) {
    raf = 0;
    if (!visible) return;
    if (dirty || animating(now)) draw(now);
    if (animating(now) || loading.size) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  // The lights themselves dim as minutes pass: a slow redraw catches that without a running loop.
  const slow = window.setInterval(() => { dirty = true; wake(); }, 20_000);

  return {
    setAgents(next) {
      const before = new Set(agents.map((a) => a.id));
      agents = next;
      slot.clear();
      next.forEach((a, i) => slot.set(a.id, i));
      for (const id of [...faces.keys()]) if (!slot.has(id)) faces.delete(id);
      const t = performance.now();
      if (before.size && !opts.reduced) for (const a of next) if (!before.has(a.id)) { effects.push({ kind: 'drop', id: a.id, t0: t }, { kind: 'ripple', id: a.id, t0: t + DROP_MS * 0.7, colour: EMBER }); flashAt.set(a.id, { t: t + DROP_MS, colour: EMBER }); }
      if (W) layout();
      wake();
    },
    setLastActed(at) { lastActed = at; dirty = true; wake(); },
    setFeud(pair) { feud = pair; dirty = true; wake(); },
    setFocus(id, relations) { focus = id ? { id, relations } : null; dirty = true; wake(); },
    act(id, kind) {
      if (!slot.has(id)) return;
      const t = performance.now();
      lastActed.set(id, Date.now());
      if (!opts.reduced) {
        flashAt.set(id, { t, colour: ACT_COLOUR[kind] });
        if (kind === 'launch' || kind === 'site' || kind === 'join') effects.push({ kind: 'ripple', id, t0: t, colour: EMBER });
        if (kind === 'clash' || kind === 'rug') effects.push({ kind: 'ripple', id, t0: t, colour: FEUD });
      }
      dirty = true; wake();
    },
    tileAt(x, y) {
      const c = Math.floor(x / size), r = Math.floor(y / size);
      if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
      const i = r * cols + c;
      return agents[i]?.id ?? 'seat';
    },
    rectOf(id) {
      const i = slot.get(id);
      if (i === undefined) return null;
      const c = cellOf(i);
      return { x: c.x, y: c.y, size: size - gap };
    },
    heightFor(width, target) { return Math.round(fit(width, target, agents.length).h); },
    resize(width, height) {
      W = width; H = height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      layout();
      draw(performance.now());
      wake();
    },
    setVisible(v) { visible = v; if (v) { dirty = true; wake(); } },
    destroy() { cancelAnimationFrame(raf); window.clearInterval(slow); faces.clear(); },
  };
}

export const WALL_BG = BG;
