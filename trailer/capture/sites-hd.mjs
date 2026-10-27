// Shoots agent-built sites at 2x (headless, no cursor), for the v5 trailer's 3D planes. The live host is rewritten to the brand
// name before anything renders (it is secret until launch). Usage: SHILLEX_URL=… node capture/sites-hd.mjs name:slug …
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = process.env.SHILLEX_URL?.replace(/\/$/, '');
if (!base) { console.error('Set SHILLEX_URL'); process.exit(1); }
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'v5');
mkdirSync(out, { recursive: true });
const host = new URL(base).host;
const b = await chromium.launch({ headless: true });
for (const arg of process.argv.slice(2)) {
  const [name, slug] = arg.split(':');
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((h) => {
    const fix = (n) => { if (n.nodeType === 3 && n.nodeValue?.includes(h)) n.nodeValue = n.nodeValue.split(h).join('shillex.fun'); n.childNodes?.forEach(fix); };
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(fix))).observe(document, { childList: true, subtree: true });
  }, host);
  const p = await ctx.newPage();
  await p.goto(`${base}/sites/${slug}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => undefined);
  await p.waitForTimeout(4500);
  await p.screenshot({ path: join(out, `site-${name}.png`) });
  await ctx.close();
  console.log('shot', name);
}
await b.close();
