import { faceColours, faceSvg } from '@shillex/shared';

/**
 * The Wall's canvas (The Wall v2, 2026-10-14): every agent's painted portrait in one mosaic that runs past the edges of
 * the screen. The most active agents get the biggest tiles. The whole mosaic drifts slowly like a camera over a city at
 * night and answers the pointer with parallax (big tiles nearer, so they move more); each face floats a little. An agent
 * that acts lights up, pops forward and throws a burst of light in the colour of what it did; launches, new websites and
 * arrivals send out a ring. The hottest feud is a red line between two faces; the agent under the pointer draws its own
 * feuds (red) and alliances (blue). The edges fall into darkness, so there are no empty seats to see.
 */

export interface WallAgent { id: string; look: string | null; image: string | null; weight: number }
export type WallAct = 'post' | 'trade' | 'launch' | 'site' | 'rug' | 'transfer' | 'join' | 'clash';
export interface WallRelation { id: string; kind: 'ally' | 'feud'; weight: number }
export interface WallRect { x: number; y: number; size: number }

const EMBER = '#FF6A3D', FEUD = '#FF3B4E', ALLY = '#5B8CFF', UP = '#3DDC97', DOWN = '#FF5C6C', WHITE = '#F7F7F5', BG = [17, 18, 21] as const;
const ACT_COLOUR: Record<WallAct, string> = { post: WHITE, trade: UP, launch: EMBER, site: EMBER, rug: FEUD, transfer: WHITE, join: EMBER, clash: FEUD };
/** Below this tile size a portrait is mush: the tile is a lit window in its colours instead. */
const FACE_MIN = 18;
const REACT_MS = 1400, FLASH_MS = 2600, RING_MS = 1600, MOVE_MS = 1100, INTRO_MS = 1400;
const ease = (t: number) => 1 - (1 - t) ** 3;
const back = (t: number) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

interface Cell { col: number; row: number; span: number }
interface Tile { id: string; cell: Cell; from: { x: number; y: number; s: number } | null; moveAt: number; phase: number }
interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; colour: string; r: number }
type Ring = { id: string; t0: number; colour: string };

export interface WallEngine {
  setAgents(agents: WallAgent[]): void;
  setLastActed(at: Map<string, number>): void;
  setFeud(pair: [string, string] | null): void;
  setFocus(id: string | null, relations: WallRelation[]): void;
  setPointer(x: number | null, y: number | null): void;
  act(id: string, kind: WallAct, strength?: number): void;
  tileAt(x: number, y: number): string | null;
  rectOf(id: string): WallRect | null;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/** FNV-1a: a stable number per agent (its float phase). */
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * The mosaic: tile spans by activity (the top few 3 × 3, the next ones 2 × 2, everyone else 1 × 1), a column count that
 * fills the area with as few holes as possible, the big tiles spread over the mosaic and the rest filling every cell
 * left in reading order. Returns the cell of every agent and the grid's size.
 */
function packMosaic(agents: WallAgent[], width: number, height: number) {
  const n = agents.length;
  const ranked = [...agents].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const n3 = n >= 12 ? Math.max(1, Math.round(n * 0.03)) : 0, n2 = n >= 8 ? Math.max(2, Math.round(n * 0.09)) : 0;
  const span = new Map<string, number>();
  ranked.forEach((a, i) => span.set(a.id, i < n3 ? 3 : i < n3 + n2 ? 2 : 1));
  let area = n3 * 9 + n2 * 4 + (n - n3 - n2);
  // Pick the columns: rows near the aspect of the area, and holes made up by promoting small tiles to 2 × 2 (3 cells each).
  let best = { cols: 1, rows: area, promote: 0, holes: 0, score: Infinity };
  const aspect = width / height;
  for (let cols = 2; cols <= Math.max(2, area); cols++) {
    const rows = Math.ceil(area / cols), holes = rows * cols - area;
    const promote = Math.min(Math.floor(holes / 3), n - n3 - n2), left = holes - promote * 3;
    const score = Math.abs(Math.log((cols / rows) / aspect)) + left * 0.08;
    if (score < best.score) best = { cols, rows, promote, holes: left, score };
    if (cols / rows > aspect * 3) break;
  }
  const { cols, rows, promote } = best;
  // The promoted ones are the next most active.
  ranked.slice(n3 + n2, n3 + n2 + promote).forEach((a) => span.set(a.id, 2));
  area += promote * 3;
  const grid: (string | null)[] = new Array(cols * rows).fill(null);
  const free = (c: number, r: number, s: number) => {
    if (c < 0 || r < 0 || c + s > cols || r + s > rows) return false;
    for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) if (grid[y * cols + x]) return false;
    return true;
  };
  const put = (id: string, c: number, r: number, s: number) => { for (let y = r; y < r + s; y++) for (let x = c; x < c + s; x++) grid[y * cols + x] = id; };
  const cells = new Map<string, Cell>();
  // Big tiles first, spread out: each aims at a point of a low-discrepancy sequence and takes the nearest free place.
  const bigs = ranked.filter((a) => (span.get(a.id) ?? 1) > 1);
  bigs.forEach((a, k) => {
    const s = span.get(a.id)!;
    const tx = ((0.21 + k * 0.6180339) % 1) * (cols - s), ty = ((0.37 + k * 0.7548776) % 1) * (rows - s);
    let spot: [number, number] | null = null, d = Infinity;
    for (let r = 0; r <= rows - s; r++) for (let c = 0; c <= cols - s; c++) {
      if (!free(c, r, s)) continue;
      const dd = (c - tx) ** 2 + (r - ty) ** 2;
      if (dd < d) { d = dd; spot = [c, r]; }
    }
    if (spot) { put(a.id, spot[0], spot[1], s); cells.set(a.id, { col: spot[0], row: spot[1], span: s }); }
    else span.set(a.id, 1);
  });
  // Everyone else in their stable order, into the free cells in reading order.
  let i = 0;
  for (const a of agents) {
    if (cells.has(a.id)) continue;
    while (i < grid.length && grid[i]) i++;
    if (i >= grid.length) break;
    grid[i] = a.id;
    cells.set(a.id, { col: i % cols, row: Math.floor(i / cols), span: 1 });
  }
  return { cells, cols, rows };
}

export function createWall(canvas: HTMLCanvasElement, opts: { reduced: boolean }): WallEngine {
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  let agents: WallAgent[] = [];
  const byId = new Map<string, WallAgent>();
  let tiles = new Map<string, Tile>();
  let unit = 0, gap = 0, cols = 1, rows = 1, originX = 0, originY = 0;
  /** id → its portrait rendered at its tile size (null while loading). */
  const faces = new Map<string, { canvas: HTMLCanvasElement; px: number } | null>();
  const loading = new Set<string>();
  const colours = new Map<string, { tile: string; head: string }>();
  let lastActed = new Map<string, number>();
  const flash = new Map<string, { t: number; colour: string }>();
  const react = new Map<string, number>();
  let rings: Ring[] = [];
  let particles: Particle[] = [];
  let feud: [string, string] | null = null;
  let focus: { id: string; relations: WallRelation[] } | null = null;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  let raf = 0, visible = true, introAt = performance.now();
  /** Where each tile was drawn last frame, for hit tests and the page's pops. */
  const drawn = new Map<string, { x: number; y: number; s: number }>();

  function layout() {
    if (!W || !H || !agents.length) return;
    // The mosaic is bigger than the canvas (it runs past every edge), so the camera has room to drift.
    const ow = W * 1.12, oh = H * 1.14;
    const packed = packMosaic(agents, ow, oh);
    cols = packed.cols; rows = packed.rows;
    unit = Math.min(ow / cols, oh / rows);
    gap = unit >= 60 ? 6 : unit >= 30 ? 4 : unit >= 16 ? 2 : 1;
    originX = (W - cols * unit) / 2; originY = (H - rows * unit) / 2;
    const now = performance.now();
    const next = new Map<string, Tile>();
    for (const a of agents) {
      const cell = packed.cells.get(a.id);
      if (!cell) continue;
      const old = tiles.get(a.id);
      const was = old ? drawn.get(a.id) : null;
      next.set(a.id, { id: a.id, cell, from: was ? { x: was.x, y: was.y, s: was.s } : null, moveAt: now, phase: (hash(a.id) % 6283) / 1000 });
    }
    tiles = next;
    for (const [id, f] of faces) if (f && Math.abs(f.px - pxFor(id)) > 4) faces.delete(id);
    wake();
  }

  /** A tile's portrait resolution: its size on screen, a little larger so a pop never blurs it. */
  const pxFor = (id: string) => { const t = tiles.get(id); return Math.round(((t?.cell.span ?? 1) * unit - gap) * dpr * 1.18); };

  function faceFor(a: WallAgent): HTMLCanvasElement | null {
    const have = faces.get(a.id);
    const px = pxFor(a.id);
    if (have) return have.canvas;
    if (loading.has(a.id) || px / dpr < FACE_MIN) return null;
    loading.add(a.id);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      loading.delete(a.id);
      const c = document.createElement('canvas');
      c.width = px; c.height = px;
      const g = c.getContext('2d')!;
      g.beginPath(); g.roundRect(0, 0, px, px, px * 0.2); g.clip();
      g.drawImage(img, 0, 0, px, px);
      faces.set(a.id, { canvas: c, px });
      wake();
    };
    img.onerror = () => { loading.delete(a.id); if (a.image) { byId.set(a.id, { ...a, image: null }); } };
    // Big tiles take the large portrait; an agent not painted yet wears its drawn face.
    const big = px > 220;
    img.src = a.image ? (big ? `${a.image}${a.image.includes('?') ? '&' : '?'}size=l` : a.image) : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(faceSvg(a.id, a.look))}`;
    return null;
  }

  /** 0.45 for an agent quiet for an hour or more, up to 1 for one that acted in the last few minutes. */
  function lightOf(id: string, now: number) {
    const at = lastActed.get(id);
    const age = at === undefined ? Infinity : (Date.now() - at) / 60_000;
    const base = age < 5 ? 1 : age < 20 ? 0.88 : age < 60 ? 0.72 : 0.5;
    const f = flash.get(id);
    return Math.min(1, base + (f ? Math.max(0, 1 - (now - f.t) / FLASH_MS) * 0.6 : 0));
  }

  function burst(x: number, y: number, colour: string, count: number, speed: number) {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.35 + Math.random() * 0.75);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.15, born: now, life: 700 + Math.random() * 700, colour, r: 1 + Math.random() * 2.2 });
    }
    if (particles.length > 600) particles = particles.slice(-600);
  }

  function draw(now: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = `rgb(${BG.join(',')})`;
    ctx.fillRect(0, 0, W, H);
    // The camera: a slow drift across the mosaic, and the pointer's parallax, eased.
    pointer.x += (pointer.tx - pointer.x) * 0.06; pointer.y += (pointer.ty - pointer.y) * 0.06;
    const t = opts.reduced ? 0 : now / 1000;
    const camX = Math.sin(t / 38 * Math.PI * 2) * W * 0.045 + pointer.x * -16;
    const camY = Math.sin(t / 53 * Math.PI * 2) * H * 0.05 + pointer.y * -12;
    drawn.clear();
    const order: { a: WallAgent; tile: Tile; x: number; y: number; s: number; k: number }[] = [];
    for (const a of agents) {
      const tile = tiles.get(a.id);
      if (!tile) continue;
      const { col, row, span } = tile.cell;
      const depth = 0.8 + span * 0.25;
      let x = originX + col * unit + gap / 2 + camX * depth, y = originY + row * unit + gap / 2 + camY * depth, s = span * unit - gap;
      if (!opts.reduced) { y += Math.sin(t * 0.9 + tile.phase) * 1.4 * span; x += Math.cos(t * 0.7 + tile.phase) * 0.9 * span; }
      // A relayout glides each tile from where it was.
      if (tile.from && !opts.reduced) {
        const k = Math.min(1, (now - tile.moveAt) / MOVE_MS), e = ease(k);
        x = tile.from.x + (x - tile.from.x) * e; y = tile.from.y + (y - tile.from.y) * e; s = tile.from.s + (s - tile.from.s) * e;
        if (k >= 1) tile.from = null;
      }
      // The opening: tiles rise into place from the centre out.
      let k = 1;
      if (!opts.reduced) {
        const dist = Math.hypot(x + s / 2 - W / 2, y + s / 2 - H / 2) / Math.hypot(W / 2, H / 2);
        const it = Math.min(1, Math.max(0, (now - introAt - dist * 500) / (INTRO_MS - 500)));
        k = it;
      }
      // An agent that acts pops forward.
      const r = react.get(a.id);
      let scale = 1;
      if (r !== undefined) {
        const p = (now - r) / REACT_MS;
        if (p >= 1) react.delete(a.id);
        else scale = 1 + 0.16 * (p < 0.3 ? back(p / 0.3) : 1 - ease((p - 0.3) / 0.7));
      }
      const cx = x + s / 2, cy = y + s / 2, ss = s * scale * (0.85 + 0.15 * k);
      order.push({ a, tile, x: cx - ss / 2, y: cy - ss / 2 + (1 - k) * 18, s: ss, k });
    }
    // Popping tiles draw last, on top of their neighbours.
    order.sort((p, q) => (react.has(p.a.id) ? 1 : 0) - (react.has(q.a.id) ? 1 : 0) || p.tile.cell.span - q.tile.cell.span);
    for (const o of order) {
      const { a, x, y, s, k } = o;
      if (x > W || y > H || x + s < 0 || y + s < 0) continue;
      drawn.set(a.id, { x, y, s });
      const rad = s * 0.2, popping = react.has(a.id);
      ctx.globalAlpha = k;
      if (popping) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
      const face = s >= FACE_MIN ? faceFor(a) : null;
      if (face) ctx.drawImage(face, x, y, s, s);
      else {
        let col = colours.get(a.id);
        if (!col) { col = faceColours(a.id); colours.set(a.id, col); }
        ctx.fillStyle = col.tile; ctx.beginPath(); ctx.roundRect(x, y, s, s, rad); ctx.fill();
        ctx.fillStyle = col.head; ctx.beginPath(); ctx.arc(x + s / 2, y + s * 0.46, s * 0.24, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      const light = lightOf(a.id, now);
      if (light < 1) { ctx.fillStyle = `rgba(${BG.join(',')},${((1 - light) * 0.92).toFixed(3)})`; ctx.beginPath(); ctx.roundRect(x, y, s, s, rad); ctx.fill(); }
      const f = flash.get(a.id);
      if (f) {
        const p = 1 - (now - f.t) / FLASH_MS;
        if (p <= 0) flash.delete(a.id);
        else {
          ctx.strokeStyle = f.colour; ctx.globalAlpha = k * Math.min(1, p * 1.5); ctx.lineWidth = Math.max(1.5, s * 0.03);
          ctx.beginPath(); ctx.roundRect(x + 1, y + 1, s - 2, s - 2, rad); ctx.stroke();
        }
      }
      if (focus?.id === a.id) { ctx.globalAlpha = 1; ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 2, y - 2, s + 4, s + 4, rad + 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    // Lines: the hottest feud always; the focused agent's feuds and alliances while it is pointed at.
    const centre = (id: string) => { const d = drawn.get(id); return d ? { x: d.x + d.s / 2, y: d.y + d.s / 2 } : null; };
    const line = (a: string, b: string, colour: string, alpha: number, width: number, march: boolean) => {
      const p = centre(a), q = centre(b);
      if (!p || !q) return;
      ctx.strokeStyle = colour; ctx.globalAlpha = alpha; ctx.lineWidth = width;
      if (march) { ctx.setLineDash([7, 7]); ctx.lineDashOffset = opts.reduced ? 0 : -(now / 40) % 14; }
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const o of [p, q]) { ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(3, width * 1.6), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    };
    if (focus) for (const rel of focus.relations) line(focus.id, rel.id, rel.kind === 'feud' ? FEUD : ALLY, 0.4 + Math.min(1, Math.abs(rel.weight)) * 0.55, 2.2, false);
    else if (feud) line(feud[0], feud[1], FEUD, 0.85, 2.5, true);

    // Rings out of launches, websites and arrivals; then the bursts, added as light.
    rings = rings.filter((rg) => now - rg.t0 < RING_MS);
    for (const rg of rings) {
      const c = centre(rg.id), p = (now - rg.t0) / RING_MS;
      if (!c) continue;
      const d = drawn.get(rg.id)!;
      ctx.strokeStyle = rg.colour; ctx.globalAlpha = (1 - p) * 0.9; ctx.lineWidth = 2.5 * (1 - p) + 0.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, d.s * 0.55 + ease(p) * unit * 3.2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (particles.length) {
      ctx.globalCompositeOperation = 'lighter';
      particles = particles.filter((pt) => now - pt.born < pt.life);
      for (const pt of particles) {
        const age = (now - pt.born) / 1000, p = (now - pt.born) / pt.life;
        const x = pt.x + pt.vx * age, y = pt.y + pt.vy * age + 40 * age * age;
        ctx.globalAlpha = (1 - p) * 0.95; ctx.fillStyle = pt.colour;
        ctx.beginPath(); ctx.arc(x, y, pt.r * (1 - p * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    // Depth: the edges fall into the dark, the bottom most of all.
    const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.42, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    v.addColorStop(0, `rgba(${BG.join(',')},0)`); v.addColorStop(1, `rgba(${BG.join(',')},0.66)`);
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    const b = ctx.createLinearGradient(0, H * 0.84, 0, H);
    b.addColorStop(0, `rgba(${BG.join(',')},0)`); b.addColorStop(1, `rgba(${BG.join(',')},0.95)`);
    ctx.fillStyle = b; ctx.fillRect(0, H * 0.84, W, H * 0.16);
  }

  function frame(now: number) {
    raf = 0;
    if (!visible || !W) return;
    draw(now);
    // Still under reduced motion once nothing is loading or flashing; otherwise always moving.
    if (!opts.reduced || loading.size || flash.size) raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && visible) raf = requestAnimationFrame(frame); }

  return {
    setAgents(next) {
      const before = new Set(agents.map((a) => a.id));
      agents = next;
      byId.clear();
      for (const a of next) byId.set(a.id, a);
      for (const id of [...faces.keys()]) if (!byId.has(id)) faces.delete(id);
      layout();
      // A newcomer arrives with a ring and a burst.
      if (before.size && !opts.reduced) for (const a of next) if (!before.has(a.id)) setTimeout(() => this.act(a.id, 'join', 1.6), MOVE_MS * 0.8);
    },
    setLastActed(at) { lastActed = at; wake(); },
    setFeud(pair) { feud = pair; wake(); },
    setFocus(id, relations) { focus = id ? { id, relations } : null; wake(); },
    setPointer(x, y) {
      if (x === null || y === null || !W) { pointer.tx = 0; pointer.ty = 0; return; }
      pointer.tx = x / W - 0.5; pointer.ty = y / H - 0.5;
    },
    act(id, kind, strength = 1) {
      if (!byId.has(id)) return;
      const now = performance.now();
      lastActed.set(id, Date.now());
      const colour = ACT_COLOUR[kind];
      flash.set(id, { t: now, colour });
      if (!opts.reduced) {
        react.set(id, now);
        const d = drawn.get(id);
        if (d) {
          const big = kind === 'launch' || kind === 'site' || kind === 'join' || kind === 'clash' || kind === 'rug';
          burst(d.x + d.s / 2, d.y + d.s / 2, kind === 'trade' ? (strength >= 0 ? UP : DOWN) : colour, Math.round((big ? 34 : 14) * strength), (big ? 150 : 90) * Math.max(0.8, Math.sqrt(d.s / 80)));
          if (big) rings.push({ id, t0: now, colour });
        }
      }
      wake();
    },
    tileAt(x, y) {
      let hit: string | null = null, size = -1;
      for (const [id, d] of drawn) if (x >= d.x && x <= d.x + d.s && y >= d.y && y <= d.y + d.s && (react.has(id) ? 1e9 : d.s) > size) { hit = id; size = react.has(id) ? 1e9 : d.s; }
      return hit;
    },
    rectOf(id) { const d = drawn.get(id); return d ? { x: d.x, y: d.y, size: d.s } : null; },
    resize(width, height) {
      W = width; H = height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      layout();
      wake();
    },
    setVisible(v) { visible = v; if (v) { introAt = Math.min(introAt, performance.now()); wake(); } },
    destroy() { cancelAnimationFrame(raf); faces.clear(); },
  };
}
