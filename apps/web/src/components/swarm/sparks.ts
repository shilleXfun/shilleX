import { hexA, hueHex, mixHex } from './palette';

/** A spark flies for FLY_MS, then flashes where it landed for FLASH_MS. */
const FLY_MS = 650, FLASH_MS = 260;
/** Every spark lands (its promise resolves) by this long after it started, even if frames stop coming. */
const SAFETY_MS = FLY_MS + 400;
/** How much of the path the trail covers behind the core. */
const TRAIL = 0.22;

type P = { x: number; y: number };
interface Spark { ax: number; ay: number; qx: number; qy: number; bx: number; by: number; t0: number; col: string; landed: boolean; done: () => void; safety: ReturnType<typeof setTimeout> }

export interface Sparks {
  /** Flies a spark from `from` to `to` (viewport pixels) in the agent's hue; resolves when it lands. */
  fly(from: P, to: P, hue: number): Promise<void>;
  /** Lands every spark at once (the tab was hidden). */
  finish(): void;
  destroy(): void;
}

/**
 * Sparks (x-revamp §4) on a full-viewport canvas above the page: a bright core with a short trail, flying along a curve
 * from an agent's light to the point where its reaction lands (about 650 ms), then a small flash there. The canvas only
 * draws, and is only visible, while a spark is in the air. `lite` (phones): a shorter, thinner trail and a smaller core.
 */
export function createSparks(canvas: HTMLCanvasElement, opts: { lite: boolean }): Sparks | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const c: CanvasRenderingContext2D = ctx;
  const cores = new Map<string, HTMLCanvasElement>();
  const steps = opts.lite ? 6 : 12, coreSize = opts.lite ? 16 : 22, width = opts.lite ? 1.8 : 2.6;
  let sparks: Spark[] = [], raf = 0, W = 0, H = 0, D = 0;

  /** The core: white-hot, then the agent's hue, then nothing. */
  function core(col: string) {
    let g = cores.get(col);
    if (g) return g;
    g = document.createElement('canvas'); g.width = g.height = 64;
    const x = g.getContext('2d');
    if (x) {
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.16, mixHex(col, '#ffffff', 0.5)); grad.addColorStop(0.42, hexA(col, 0.5)); grad.addColorStop(1, hexA(col, 0));
      x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    }
    cores.set(col, g);
    return g;
  }
  /** The buffer follows the viewport (a phone's pixel ratio stops at 1.5); resizing clears it, so only when it changed. */
  function size() {
    const w = window.innerWidth, h = window.innerHeight, d = Math.min(opts.lite ? 1.5 : 2, window.devicePixelRatio || 1);
    if (w === W && h === H && d === D) return;
    W = w; H = h; D = d;
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
    c.setTransform(d, 0, 0, d, 0, 0);
  }
  function land(sp: Spark) {
    if (sp.landed) return;
    sp.landed = true;
    clearTimeout(sp.safety);
    sp.done();
  }
  /** In flight at progress k: eased out of the light and into the landing, the trail tapering and fading behind the core. */
  function flight(sp: Spark, k: number) {
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    c.strokeStyle = sp.col; c.lineCap = 'round';
    let u = Math.max(0, e - TRAIL), iu = 1 - u;
    let x0 = iu * iu * sp.ax + 2 * iu * u * sp.qx + u * u * sp.bx, y0 = iu * iu * sp.ay + 2 * iu * u * sp.qy + u * u * sp.by;
    for (let i = 1; i <= steps; i++) {
      u = Math.max(0, e - TRAIL + (TRAIL * i) / steps); iu = 1 - u;
      const x = iu * iu * sp.ax + 2 * iu * u * sp.qx + u * u * sp.bx, y = iu * iu * sp.ay + 2 * iu * u * sp.qy + u * u * sp.by, f = i / steps;
      c.globalAlpha = f * f * 0.9; c.lineWidth = 0.6 + f * width;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x, y); c.stroke();
      x0 = x; y0 = y;
    }
    c.globalAlpha = 1;
    c.drawImage(core(sp.col), x0 - coreSize / 2, y0 - coreSize / 2, coreSize, coreSize);
  }
  /** Landed, at progress f of the flash: a ring opening where it hit, and the core fading into it. */
  function flash(sp: Spark, f: number) {
    const r = 3 + 13 * (1 - (1 - f) ** 3), s = coreSize * (1 - 0.6 * f);
    c.globalAlpha = (1 - f) * 0.85; c.strokeStyle = sp.col; c.lineWidth = 1.5;
    c.beginPath(); c.arc(sp.bx, sp.by, r, 0, Math.PI * 2); c.stroke();
    c.globalAlpha = 1 - f;
    c.drawImage(core(sp.col), sp.bx - s / 2, sp.by - s / 2, s, s);
    c.globalAlpha = 1;
  }
  function frame() {
    raf = 0;
    const now = performance.now();
    size();
    c.clearRect(0, 0, W, H);
    let n = 0;
    for (const sp of sparks) {
      const age = now - sp.t0;
      if (age >= FLY_MS) land(sp);
      if (age >= FLY_MS + FLASH_MS) continue;
      if (age >= FLY_MS) flash(sp, (age - FLY_MS) / FLASH_MS);
      else flight(sp, Math.max(0, age) / FLY_MS);
      sparks[n++] = sp;
    }
    sparks.length = n;
    if (n) raf = requestAnimationFrame(frame);
    else canvas.style.visibility = 'hidden';
  }
  function finish() {
    for (const sp of sparks) land(sp);
    sparks = [];
    cancelAnimationFrame(raf);
    raf = 0;
    c.clearRect(0, 0, W, H);
    canvas.style.visibility = 'hidden';
  }

  return {
    fly(from, to, hue) {
      return new Promise<void>((resolve) => {
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy);
        if (len < 4) { resolve(); return; }
        size();
        // Bowed upward, like a spark thrown from the light.
        let nx = -dy / len, ny = dx / len;
        if (ny > 0) { nx = -nx; ny = -ny; }
        const bend = Math.min(220, len * 0.32);
        const sp: Spark = {
          ax: from.x, ay: from.y, qx: (from.x + to.x) / 2 + nx * bend, qy: (from.y + to.y) / 2 + ny * bend, bx: to.x, by: to.y,
          t0: performance.now(), col: hueHex(hue), landed: false, done: resolve, safety: setTimeout(() => land(sp), SAFETY_MS),
        };
        sparks.push(sp);
        canvas.style.visibility = 'visible';
        if (!raf) raf = requestAnimationFrame(frame);
      });
    },
    finish,
    destroy: finish,
  };
}
