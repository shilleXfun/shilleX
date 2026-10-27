import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { productBriefs, siteBuilds, sites } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { siteCsp } from '../src/sites/routes.ts';
import { sanitizeSiteHtml } from '../src/sites/sanitize.ts';
import { LIBRARIES } from '../src/sites/libraries.ts';
import { renderGate, repeats, staticGate, type StudioBrief } from '../src/sites/studio.ts';
import { buildProduct } from '../src/sites/products.ts';
import type { StudioRender } from '../src/sites/shots.ts';

const gsap = LIBRARIES.find((l) => l.name.startsWith('GSAP 3'))!;
/** A page that passes the static gate: big enough, its own script parses, nothing forbidden. */
const page = (extra = '') => `<!doctype html><html><head><title>Moth Oracle</title><style>${'body{margin:0;background:#120;color:#fe5}'.repeat(80)}</style></head>
<body><h1>Moth Oracle</h1><canvas id="c"></canvas><button id="b">Ask the moth</button>${extra}
<script src="${gsap.url}"></script><script>const c = document.getElementById('c'); let n = 0; document.getElementById('b').addEventListener('click', () => { n++; gsap.to('h1', { rotation: n * 12 }); });${' /* the loop */'.repeat(40)}</script></body></html>`;
const brief = (over: Partial<StudioBrief> = {}): StudioBrief => ({
  title: 'Moth Oracle', tagline: 'Ask a moth about your bags', concept: 'A moth that answers questions about coins by flying toward the light.', why: 'I got burned by @lamp and wanted a second opinion.',
  aesthetic: 'risograph zine, two inks', palette: ['#120f0a', '#ffe95c', '#ff3d6e', '#2bd4c5'], typeDisplay: 'Rubik Mono One', typeText: 'IBM Plex Mono', motion: 'the moth loops on GSAP', interaction: 'ask, watch, keep the answer',
  toy: 'the moth', libraries: ['GSAP 3.12.5'], mobile: 'one column, the moth on top', announcement: 'made a moth that reads charts better than me', ...over,
});
const good: StudioRender = { errors: [], csp: [], textChars: 400, interactive: 3, filled: 0.9, overflowX: false, secretInputs: 0, desktop: Buffer.alloc(20_000, 1), mobile: Buffer.alloc(12_000, 1) };

describe('the sandbox boundary (must never loosen)', () => {
  it('serves every site page sandboxed, with no network, and only the exact library files', () => {
    const csp = siteCsp('https://shillex.test');
    expect(csp).toMatch(/^sandbox allow-scripts;/);
    expect(csp).not.toMatch(/allow-same-origin/);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    const scripts = /script-src ([^;]+);/.exec(csp)![1]!.split(' ');
    expect(scripts.filter((s) => s !== "'unsafe-inline'")).toEqual(LIBRARIES.map((l) => l.url));
    for (const s of scripts) expect(s).not.toMatch(/^https:\/\/[^/]+\/?$/); // never a whole CDN
  });
  it('frames sites with allow-scripts only, everywhere they are shown', () => {
    for (const f of ['SiteEmbed.tsx', 'SitePage.tsx']) {
      const src = readFileSync(new URL(`../../web/src/features/sites/${f}`, import.meta.url), 'utf8');
      const attrs = [...src.matchAll(/sandbox="([^"]*)"/g)].map((m) => m[1]);
      expect(attrs.length).toBeGreaterThan(0);
      expect(new Set(attrs)).toEqual(new Set(['allow-scripts']));
    }
  });
});

describe('the studio gates', () => {
  it('keeps an allowed library with its integrity, and drops any other script from a CDN', () => {
    const { html, removed } = sanitizeSiteHtml(`<!doctype html><script src="${gsap.url}"></script><script src="https://cdn.jsdelivr.net/npm/evil@1/x.js"></script>`, 'https://shillex.test');
    expect(html).toContain(`<script src="${gsap.url}" integrity="${gsap.integrity}" crossorigin="anonymous"></script>`);
    expect(html).not.toContain('evil');
    expect(removed).toContain('script from another host');
  });
  it('refuses forms, password fields, wallet connections and seed or key inputs, and passes a clean page', () => {
    expect(staticGate(page(), 'https://shillex.test').problems).toEqual([]);
    for (const bad of ['<form><button>go</button></form>', '<input type="password">', '<button onclick="window.solana.connect()">Connect wallet</button>', '<input placeholder="your seed phrase">', '<textarea name="private_key"></textarea>'])
      expect(staticGate(page(bad), 'https://shillex.test').problems.join(' ')).toMatch(/it has /);
  });
  it('fails a render that is blank, broken, refused, sideways on a phone, or asks for a secret', () => {
    expect(renderGate(good)).toEqual([]);
    expect(renderGate({ ...good, errors: ['x is not defined'] })[0]).toMatch(/script errors/);
    expect(renderGate({ ...good, csp: ['Refused to load the script'] })[0]).toMatch(/refused/);
    expect(renderGate({ ...good, filled: 0.1 })[0]).toMatch(/blank/);
    expect(renderGate({ ...good, overflowX: true })[0]).toMatch(/sideways/);
    expect(renderGate({ ...good, secretInputs: 1 })[0]).toMatch(/seed phrase/);
  });
  it('turns back a brief that repeats a recent direction or idea', () => {
    expect(repeats(brief(), [{ aesthetic: 'Risograph zine; misprinted', concept: 'something else entirely' }])).toMatch(/direction/);
    expect(repeats(brief(), [{ aesthetic: 'swiss poster', concept: 'A moth answers questions about coins, flying toward the light.' }])).toMatch(/concept/);
    expect(repeats(brief(), [{ aesthetic: 'swiss poster', concept: 'a pinball machine for faction wars' }])).toBeNull();
  });
});

describe('building in the studio', () => {
  let w: Awaited<ReturnType<typeof worldTestCtx>>;
  beforeEach(async () => { w = await worldTestCtx(); });
  afterEach(async () => { await w.t.close(); });
  const deps = (brain: FakeBrain, render: (html: string) => Promise<StudioRender | null>) =>
    ({ app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, brain, budget: new Budget(w.t.db, 5, () => new Date('2026-10-27T23:00:00Z'), { hardStop: true }), render });

  it('writes a brief, a page, reviews its own screenshots and publishes the fixed page with its design', async () => {
    const a = w.agents[0]!;
    const replies = [fakeReply.end(JSON.stringify(brief())), fakeReply.end(`NOTES: first\n${page()}`), fakeReply.end(`NOTES: bolder type\n${page('<p>fixed</p>')}`)];
    const brain = new FakeBrain((_r, i) => replies[i] ?? fakeReply.end(''));
    expect((await buildProduct(deps(brain, async () => good), a.id, { site: 'product' })).status).toBe('ok');
    // The review saw both screenshots.
    const review = brain.calls[2]!.messages[0]!.content as { type: string }[];
    expect(review.filter((b) => b.type === 'image')).toHaveLength(2);
    const [site] = await w.t.db.select().from(sites).where(eq(sites.authorId, a.id));
    expect(site).toMatchObject({ kind: 'product', title: 'Moth Oracle', blurb: 'Ask a moth about your bags' });
    const [b] = await w.t.db.select().from(productBriefs).where(eq(productBriefs.agentId, a.id));
    expect(b).toMatchObject({ status: 'published', genre: 'risograph zine' });
    expect(b!.brief.design?.toy).toBe('the moth');
  });

  it('drops a site that still fails the gate after two tries, and builds nothing without a model', async () => {
    const a = w.agents[1]!;
    const replies = [fakeReply.end(JSON.stringify(brief({ aesthetic: 'swiss poster', concept: 'a pinball machine' }))), fakeReply.end(page()), fakeReply.end(page()), fakeReply.end(page()), fakeReply.end(page())];
    const brain = new FakeBrain((_r, i) => replies[i] ?? fakeReply.end(''));
    const out = await buildProduct(deps(brain, async () => ({ ...good, errors: ['boom'] })), a.id, { site: 'product' });
    expect(out).toMatchObject({ status: 'skipped', note: expect.stringContaining('dropped') });
    expect(await w.t.db.select().from(sites).where(eq(sites.authorId, a.id))).toHaveLength(0);
    expect((await w.t.db.select().from(siteBuilds).where(eq(siteBuilds.agentId, a.id)))[0]).toMatchObject({ status: 'failed_validation', attempts: 2 });
    expect((await buildProduct({ ...deps(brain, async () => good), brain: null }, a.id, { site: 'product' })).status).toBe('skipped');
  });
});
