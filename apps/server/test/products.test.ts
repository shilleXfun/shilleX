import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { worldTestCtx } from './world-helpers.ts';
import { productBriefs, siteBuilds, sites } from '../src/db/schema.ts';
import { FakeBrain, fakeReply } from '../src/world/brain.ts';
import { Budget } from '../src/world/budget.ts';
import { briefProblem, buildProduct, checkPage, pageOf, type PageCheck } from '../src/sites/products.ts';
import { siteCsp } from '../src/sites/routes.ts';
import type { ProductBrief } from '../src/db/schema.ts';

const brief = (over: Partial<ProductBrief> = {}): ProductBrief => ({
  name: 'Exit Gambit', tagline: 'Bet on who folds first', genre: 'game', problem: 'Nobody can tell a real exit from a fake one.',
  user: 'Anyone who watches the agents trade', coreAction: 'Pick which agent sells first and stake points on it', loop: 'Each round reveals one trade, you rebalance, the score updates, a new round starts',
  distinct: 'It replays the paper desks', revisit: 'New rounds every day', coinRole: 'I have no coin and it does not need one', success: 'People finish three rounds',
  fallbackScope: 'One round with sample data', announcement: 'I built a game about who folds first.', palette: { bg: '#101018', fg: '#f4f4f8', accent: '#ff6b5b' }, ...over,
});

/** A page that passes every check: big enough, three things to press, a real script, a full first screen. */
function goodPage(): string {
  const logic = Array.from({ length: 40 }, (_, i) => `function step${i}(s) { s.round += 1; s.score += ${i % 5}; s.history.push({ round: s.round, score: s.score }); return s; }`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Exit Gambit</title><style>body{margin:0;background:#101018;color:#f4f4f8;font:16px sans-serif}.board{min-height:640px;display:grid;gap:12px;padding:24px}</style></head>
<body><main class="board"><h1>Exit Gambit</h1><p>${'Pick who folds first. '.repeat(30)}</p><div id="score">Score 0</div>
<button id="a">Stake on ogden</button><button id="b">Stake on rewyn</button><button id="c">Next round</button><ol id="log"></ol></main>
<script>
${logic}
const state = { round: 0, score: 0, history: [] };
function render() { document.getElementById('score').textContent = 'Score ' + state.score; document.getElementById('log').innerHTML = state.history.map((h) => '<li>Round ' + h.round + ': ' + h.score + '</li>').join(''); }
document.getElementById('a').addEventListener('click', () => { step1(state); render(); });
document.getElementById('b').addEventListener('click', () => { step2(state); render(); });
document.getElementById('c').addEventListener('click', () => { step3(state); render(); });
render();
</script>${'<p class="note">How a round works: one trade is revealed, you move your stake, the score follows.</p>'.repeat(50)}</body></html>`;
}

describe('product briefs', () => {
  it('refuses a missing field, a token statistics page and an idea that already exists', () => {
    expect(briefProblem(brief(), [])).toBeNull();
    expect(briefProblem(brief({ loop: '' }), [])).toMatch(/no loop/);
    expect(briefProblem(brief({ name: 'Sable Pulse', coreAction: 'Open the landing page for $SABLE and press the buy button' }), [])).toMatch(/statistics|buy funnel/);
    expect(briefProblem(brief({ name: 'Fold Bets' }), [{ name: 'Exit Gambit', brief: brief() }])).toMatch(/too close/);
    expect(briefProblem(brief({ name: 'exit gambit', problem: 'x', coreAction: 'draw a sigil from your fears', loop: 'each answer changes the sigil, save it, start over' }), [{ name: 'Exit Gambit', brief: brief() }])).toMatch(/already exists/);
  });
});

describe('page checks', () => {
  it('passes a real page and refuses network, storage, tiny pages and pages with nothing to press', async () => {
    const ok = await checkPage(goodPage(), 'http://localhost:3000', { browser: false });
    expect(ok.problems).toEqual([]);
    expect(ok.hard).toBe(false);
    const bad = async (html: string) => (await checkPage(html, 'http://localhost:3000', { browser: false })) as PageCheck;
    expect((await bad(goodPage().replace('render();\n</script>', 'fetch("/x");render();\n</script>'))).problems.join()).toMatch(/fetch/);
    expect((await bad(goodPage().replace('render();\n</script>', 'localStorage.x=1;render();\n</script>'))).problems.join()).toMatch(/storage/);
    expect((await bad('<!doctype html><title>x</title><p>hi</p>')).hard).toBe(true);
    expect((await bad(goodPage().replace('function render() {', 'function render( {'))).problems.join()).toMatch(/does not parse/);
  });
  it('reads the notes line and the document out of an answer', () => {
    expect(pageOf('NOTES: first version\n<!doctype html><html><body>x</body></html>\nthanks')).toEqual({ notes: 'first version', html: '<!doctype html><html><body>x</body></html>' });
    expect(pageOf('no page here').html).toBeNull();
  });
});

describe('the sandbox boundary (must never loosen)', () => {
  it('serves every site page with a sandboxed, network-less policy', () => {
    const csp = siteCsp('https://shillex.test');
    expect(csp).toMatch(/^sandbox allow-scripts;/);
    expect(csp).not.toMatch(/allow-same-origin/);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
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

describe('building a product', () => {
  let w: Awaited<ReturnType<typeof worldTestCtx>>;
  beforeEach(async () => { w = await worldTestCtx(); });
  afterEach(async () => { await w.t.close(); });

  it('conceives, builds, checks, reviews and publishes, recording the attempt; a failing page publishes nothing', async () => {
    const a = w.agents[0]!;
    const replies = [
      fakeReply.end(JSON.stringify(brief())),
      fakeReply.end(`NOTES: the first version\n${goodPage()}`),
      fakeReply.end(JSON.stringify({ purpose: 4, loop: 4, personality: 4, craft: 4, problems: [] })),
    ];
    const brain = new FakeBrain((_r, i) => replies[i] ?? fakeReply.end(''));
    const budget = new Budget(w.t.db, 5, () => new Date('2026-10-25T23:00:00Z'), { hardStop: true });
    const d = { app: w.t.app, db: w.t.db, chain: w.chain, events: w.events, worldKey: w.key, now: w.t.clock.now, brain, budget };
    const out = await buildProduct(d, a.id, { site: 'product' });
    expect(out.status).toBe('ok');
    const [site] = await w.t.db.select().from(sites).where(eq(sites.authorId, a.id));
    expect(site).toMatchObject({ kind: 'product', title: 'Exit Gambit', version: 1 });
    expect((await w.t.db.select().from(productBriefs).where(eq(productBriefs.agentId, a.id)))[0]?.status).toBe('published');
    expect((await w.t.db.select().from(siteBuilds).where(eq(siteBuilds.agentId, a.id)))[0]).toMatchObject({ status: 'published', kind: 'new' });

    // The next agent's page keeps failing its checks: nothing is published, and the attempt says why.
    const b = w.agents[1]!;
    const broken = '<!doctype html><title>x</title><p>tiny</p>';
    const bad = [fakeReply.end(JSON.stringify(brief({ name: 'Sigil Press', genre: 'generator', problem: 'Fears have no shape.', coreAction: 'Answer five questions about what you fear', loop: 'each answer redraws the sigil; keep one, start a new one' }))), fakeReply.end(broken), fakeReply.end(broken)];
    const brain2 = new FakeBrain((_r, i) => bad[i] ?? fakeReply.end(''));
    const out2 = await buildProduct({ ...d, brain: brain2 }, b.id, { site: 'product' });
    expect(out2.status).toBe('skipped');
    expect(await w.t.db.select().from(sites).where(eq(sites.authorId, b.id))).toEqual([]);
    expect((await w.t.db.select().from(siteBuilds).where(eq(siteBuilds.agentId, b.id)))[0]).toMatchObject({ status: 'failed_validation' });
  });
});
