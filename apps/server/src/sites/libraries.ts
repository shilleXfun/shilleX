/**
 * The script libraries an agent's site may load (2026-10-27, owner: "three.js, GSAP, Tone.js, matter.js, p5.js, PixiJS, chart.js,
 * canvas-confetti"). Each is one file at a pinned version, named by its exact URL in the page's CSP (a path, not a whole CDN, so
 * nothing else can be pulled in through cdnjs or jsdelivr) and loaded with its integrity hash (computed from the file on
 * 2026-10-27). The sanitizer keeps a <script src> only when it is one of these, and writes the integrity in itself.
 */
export interface Library { name: string; url: string; integrity: string; global: string; use: string }

export const LIBRARIES: readonly Library[] = [
  { name: 'three.js r128', url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', integrity: 'sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu', global: 'THREE', use: '3D scenes in WebGL (no addons: write your own controls)' },
  { name: 'GSAP 3.12.5', url: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js', integrity: 'sha384-g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt', global: 'gsap', use: 'timelines, easing, staggered motion' },
  { name: 'GSAP ScrollTrigger 3.12.5', url: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js', integrity: 'sha384-Z3REaz79l2IaAZqJsSABtTbhjgOUYyV3p90XNnAPCSHg3EMTz1fouunq9WZRtj3d', global: 'ScrollTrigger', use: 'scroll-driven motion (load after GSAP, then gsap.registerPlugin(ScrollTrigger))' },
  { name: 'Tone.js 14.8.49', url: 'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js', integrity: 'sha384-c6Uo4N9c3SOEigMVzP6IshUG1wQ5uMp3xeoQFiHWAQ86joWdgyajkvopySyKy/Z6', global: 'Tone', use: 'synths and sequencing (start audio only after a click: await Tone.start())' },
  { name: 'matter.js 0.19.0', url: 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js', integrity: 'sha384-OqQP3UcU7efkEYDRjGmQou2uEvzGFGRtwdYXTjnupeB9cWogSgQ4BOhyklFBYbBR', global: 'Matter', use: '2D physics' },
  { name: 'p5.js 1.9.0', url: 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js', integrity: 'sha384-bOv+b6RV+dlZvdQAx6+cJ+FK9ab8JCSVWyJ1JPhMVQjPW+4C8V2cOKK+qZDfnRnx', global: 'p5', use: 'generative drawing and sketches' },
  { name: 'PixiJS 7.3.2', url: 'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.3.2/pixi.min.js', integrity: 'sha384-3wqglGMjR9U1G89jiQ7NAkDL25fFnegjLwujmJu5o5AvOwEAf/ysfl8uBtBw7Eum', global: 'PIXI', use: 'fast 2D sprites and games in WebGL' },
  { name: 'Chart.js 4.4.1', url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js', integrity: 'sha384-bs/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW+S3zjqSKR5ZEaD', global: 'Chart', use: 'charts (style them: no default look)' },
  { name: 'canvas-confetti 1.9.2', url: 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js', integrity: 'sha384-xgNdoEQu0JeBEAN3/f7mrS+EPOsrmARCvhS7PEpk7QI2wvo4YOF3xY3EjQGKHAY9', global: 'confetti', use: 'bursts of confetti on a win' },
];

const BY_URL = new Map(LIBRARIES.map((l) => [l.url, l]));
/** The library a <script src> names, or null when it is not exactly one of the allowed files. */
export const libraryAt = (src: string): Library | null => BY_URL.get(src.trim()) ?? null;
/** The CSP script-src sources: the exact files, nothing broader. */
export const LIBRARY_SOURCES = LIBRARIES.map((l) => l.url).join(' ');
/** How the build prompt lists them: the exact tag to copy for each. */
export const LIBRARY_LIST = LIBRARIES.map((l) => `- ${l.name} (global ${l.global}; ${l.use}): <script src="${l.url}"></script>`).join('\n');
