/**
 * The ten styles an agent's face is drawn in (lib/svg-art.ts avatarSvg). Each draws on a 68 × 68 field, centred at 34,
 * from the agent's stream `s`, its hue and a second hue; the field, its glow and the gradients `#c` (a lit core) and
 * `#l` (hue to second hue) are already in place.
 */
export type Face = (c: { s: () => number; hue: number; alt: number }) => string;

const F = (v: number) => v.toFixed(1);
const at = (r: number, a: number) => [34 + Math.cos(a) * r, 34 + Math.sin(a) * r] as const;
const core = (r: number) => `<circle cx="34" cy="34" r="${F(r + 3)}" fill="url(#l)" opacity=".25"/><circle cx="34" cy="34" r="${F(r)}" fill="url(#c)"/>`;

/** A neuron: a lit core, dendrites reaching out with glowing tips, some forking part way. */
const neuron: Face = ({ s, hue, alt }) => {
  const n = 5 + Math.floor(s() * 4), turn = s() * Math.PI * 2;
  const fibres: string[] = [], tips: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = turn + (i / n) * Math.PI * 2 + (s() - 0.5) * 0.7, len = 17 + s() * 12, bend = (s() - 0.5) * 1.1;
    const [qx, qy] = at(len * 0.55, a + bend), [x, y] = at(len, a);
    fibres.push(`<path d="M34 34Q${F(qx)} ${F(qy)} ${F(x)} ${F(y)}"/>`);
    tips.push(`<circle cx="${F(x)}" cy="${F(y)}" r="${F(1.3 + s() * 1.5)}"/>`);
    if (s() < 0.55) {
      const b = a + (s() < 0.5 ? 0.7 : -0.7), bl = len * (0.3 + s() * 0.25);
      fibres.push(`<path d="M${F(qx)} ${F(qy)}L${F(qx + Math.cos(b) * bl)} ${F(qy + Math.sin(b) * bl)}"/>`);
    }
  }
  return `<g fill="none" stroke="hsl(${hue} 90% 70%)" stroke-width="1.7" stroke-linecap="round" opacity=".88">${fibres.join('')}</g>`
    + `<g fill="hsl(${alt} 95% 78%)">${tips.join('')}</g>${core(7 + s() * 3.5)}`;
};

/** Orbits: one to three tilted ellipses, each carrying a moon, round a small sun. */
const orbits: Face = ({ s, hue, alt }) => {
  const n = 1 + Math.floor(s() * 3);
  let out = '';
  for (let i = 0; i < n; i++) {
    const rx = 19 + s() * 9 + i * 2, ry = 5 + s() * 9, rot = s() * 180, t = s() * Math.PI * 2;
    const mx = rx * Math.cos(t), my = ry * Math.sin(t), rr = (rot * Math.PI) / 180;
    const x = 34 + mx * Math.cos(rr) - my * Math.sin(rr), y = 34 + mx * Math.sin(rr) + my * Math.cos(rr);
    out += `<ellipse cx="34" cy="34" rx="${F(rx)}" ry="${F(ry)}" transform="rotate(${F(rot)} 34 34)" fill="none" stroke="hsl(${i % 2 ? alt : hue} 90% 70%)" stroke-width="1.5" opacity=".8"/>`
      + `<circle cx="${F(x)}" cy="${F(y)}" r="${F(2.2 + s() * 2)}" fill="hsl(${alt} 95% 76%)"/>`;
  }
  return out + core(6 + s() * 4);
};

/** A constellation: four to seven stars joined in a line, the brightest with a four-point glint. */
const constellation: Face = ({ s, hue, alt }) => {
  const n = 4 + Math.floor(s() * 4);
  const pts = Array.from({ length: n }, () => ({ x: 11 + s() * 46, y: 11 + s() * 46, r: 1.4 + s() * 2.4 }))
    .sort((p, q) => Math.atan2(p.y - 34, p.x - 34) - Math.atan2(q.y - 34, q.x - 34));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${F(p.x)} ${F(p.y)}`).join('') + (s() < 0.4 ? 'Z' : '');
  const big = pts.reduce((m, p) => (p.r > m.r ? p : m), pts[0]!);
  const g = 7 + s() * 4, x = big.x, y = big.y;
  const glint = `M${F(x)} ${F(y - g)}Q${F(x)} ${F(y)} ${F(x + g)} ${F(y)}Q${F(x)} ${F(y)} ${F(x)} ${F(y + g)}Q${F(x)} ${F(y)} ${F(x - g)} ${F(y)}Q${F(x)} ${F(y)} ${F(x)} ${F(y - g)}Z`;
  return `<path d="${line}" fill="none" stroke="hsl(${hue} 85% 72%)" stroke-width="1.1" opacity=".7"/>`
    + pts.map((p) => `<circle cx="${F(p.x)}" cy="${F(p.y)}" r="${F(p.r)}" fill="hsl(${p === big ? alt : hue} 95% ${p === big ? 82 : 76}%)"/>`).join('')
    + `<path d="${glint}" fill="hsl(${alt} 100% 88%)"/>`;
};

/** A bloom: petals round a centre, a second ring of smaller ones between them. */
const bloom: Face = ({ s, hue, alt }) => {
  const n = 5 + Math.floor(s() * 5), len = 15 + s() * 8, w = 3.5 + s() * 3.5, turn = s() * 360;
  let out = '';
  for (let i = 0; i < n; i++) out += `<ellipse cx="34" cy="${F(34 - len / 2 - 2)}" rx="${F(w)}" ry="${F(len / 2)}" transform="rotate(${F(turn + (i * 360) / n)} 34 34)" fill="hsl(${hue} 88% 64%)" opacity=".62"/>`;
  for (let i = 0; i < n; i++) out += `<ellipse cx="34" cy="${F(34 - len * 0.32)}" rx="${F(w * 0.6)}" ry="${F(len * 0.3)}" transform="rotate(${F(turn + ((i + 0.5) * 360) / n)} 34 34)" fill="hsl(${alt} 92% 70%)" opacity=".75"/>`;
  return out + `<circle cx="34" cy="34" r="${F(4 + s() * 2)}" fill="hsl(${alt} 100% 86%)"/>`;
};

/** An iris: fine rays round a dark pupil with a catchlight. */
const iris: Face = ({ s, hue, alt }) => {
  const R = 21 + s() * 4, p = 6 + s() * 4, n = 28 + Math.floor(s() * 18);
  let rays = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, [x1, y1] = at(p + 1.5, a), [x2, y2] = at(R * (0.65 + s() * 0.35), a);
    rays += `<path d="M${F(x1)} ${F(y1)}L${F(x2)} ${F(y2)}" stroke="hsl(${i % 3 ? hue : alt} 90% ${66 + (i % 2) * 8}%)"/>`;
  }
  return `<circle cx="34" cy="34" r="${F(R)}" fill="none" stroke="hsl(${alt} 85% 66%)" stroke-width="1.6" opacity=".8"/><g stroke-width="1.2" stroke-linecap="round" opacity=".85">${rays}</g>`
    + `<circle cx="34" cy="34" r="${F(p)}" fill="hsl(${hue} 60% 6%)"/><circle cx="${F(34 - p * 0.35)}" cy="${F(34 - p * 0.4)}" r="${F(p * 0.28)}" fill="#fff" opacity=".9"/>`;
};

/** Arcs: three to five broken rings, each a different length and turn. */
const arcs: Face = ({ s, hue, alt }) => {
  const n = 3 + Math.floor(s() * 3);
  let out = '';
  for (let i = 0; i < n; i++) {
    const r = 10 + i * (19 / n), a0 = s() * Math.PI * 2, sweep = Math.PI * (0.6 + s() * 1.2);
    const [x1, y1] = at(r, a0), [x2, y2] = at(r, a0 + sweep);
    out += `<path d="M${F(x1)} ${F(y1)}A${F(r)} ${F(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${F(x2)} ${F(y2)}" fill="none" stroke="hsl(${i % 2 ? alt : hue} 92% ${64 + i * 3}%)" stroke-width="${F(2 + s() * 2)}" stroke-linecap="round"/>`;
  }
  return out + `<circle cx="34" cy="34" r="${F(3 + s() * 2)}" fill="hsl(${alt} 100% 84%)"/>`;
};

/** A crystal: a cut stone, its facets in shades of the two hues meeting at an off-centre point. */
const crystal: Face = ({ s, hue, alt }) => {
  const k = 5 + Math.floor(s() * 4), turn = s() * Math.PI * 2, cx = 34 + (s() - 0.5) * 8, cy = 34 + (s() - 0.5) * 8;
  const v = Array.from({ length: k }, (_, i) => at(17 + s() * 8, turn + (i / k) * Math.PI * 2));
  const facets = v.map((p, i) => {
    const q = v[(i + 1) % k]!;
    return `<path d="M${F(cx)} ${F(cy)}L${F(p[0])} ${F(p[1])}L${F(q[0])} ${F(q[1])}Z" fill="hsl(${i % 3 === 0 ? alt : hue} ${70 + (i % 2) * 15}% ${38 + ((i * 37) % 30)}%)"/>`;
  }).join('');
  return `<g stroke="hsl(${hue} 100% 85%)" stroke-width=".7" stroke-linejoin="round" opacity=".95">${facets}</g>`;
};

/** A spiral of lights that grow as it winds out, turning from one hue to the other. */
const spiral: Face = ({ s, hue, alt }) => {
  const n = 26 + Math.floor(s() * 14), turns = 2.2 + s() * 1.6, dir = s() < 0.5 ? 1 : -1, t0 = s() * Math.PI * 2;
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), [x, y] = at(3 + t * 25, t0 + dir * t * turns * Math.PI * 2);
    out += `<circle cx="${F(x)}" cy="${F(y)}" r="${F(0.8 + t * 2.4)}" fill="hsl(${t < 0.5 ? hue : alt} 95% ${F(72 + t * 10)}%)" opacity="${(0.55 + t * 0.45).toFixed(2)}"/>`;
  }
  return out;
};

/** Waves: four to six lines rolling across, out of step with each other. */
const waves: Face = ({ s, hue, alt }) => {
  const n = 4 + Math.floor(s() * 3), freq = 1 + s() * 1.5, amp = 3 + s() * 4;
  let out = '';
  for (let i = 0; i < n; i++) {
    const y0 = 14 + (i * 40) / (n - 1), ph = s() * Math.PI * 2;
    let d = '';
    for (let x = 0; x <= 68; x += 4) d += `${x ? 'L' : 'M'}${x} ${F(y0 + Math.sin((x / 68) * Math.PI * 2 * freq + ph) * amp)}`;
    out += `<path d="${d}" fill="none" stroke="hsl(${i % 2 ? alt : hue} 92% ${62 + i * 3}%)" stroke-width="${F(1.6 + s() * 1.6)}" stroke-linecap="round" opacity=".85"/>`;
  }
  return out;
};

/** A mirrored glyph: a five-by-five grid of lights, symmetric left to right. */
const glyph: Face = ({ s, hue, alt }) => {
  let out = '';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (s() < 0.48) continue;
      const big = s() < 0.3, fill = `hsl(${big ? alt : hue} 95% ${big ? 78 : 70}%)`, r = big ? 4.4 : 3.6;
      for (const c of col === 2 ? [2] : [col, 4 - col]) out += `<rect x="${F(14 + c * 10 - r)}" y="${F(14 + row * 10 - r)}" width="${F(r * 2)}" height="${F(r * 2)}" rx="${F(r * 0.45)}" fill="${fill}"/>`;
    }
  }
  return out || core(8);
};

export const FACES: Face[] = [neuron, orbits, constellation, bloom, iris, arcs, crystal, spiral, waves, glyph];
