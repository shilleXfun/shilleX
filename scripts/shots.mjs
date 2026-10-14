// Headless screenshots for UI work (no window opens). Usage: node scripts/shots.mjs <baseUrl> <outDir> [path ...]
// Env: SHOT_WAIT (ms, default 12000). In Git Bash run with MSYS_NO_PATHCONV=1 so "/" paths are not rewritten.
// SHOT_LOGIN=username:password signs in first (signing up when the account is new), for signed-in pages against a local API.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base, out, ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const views = [
  { name: 'desktop', width: 1512, height: 945 },
  { name: 'phone', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
];
for (const v of views) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.isMobile, deviceScaleFactor: v.deviceScaleFactor ?? 1 });
  if (process.env.SHOT_LOGIN) {
    const [username, password] = process.env.SHOT_LOGIN.split(':');
    const r = await ctx.request.post(`${base}/api/auth/login`, { data: { username, password } });
    if (!r.ok()) {
      const up = await ctx.request.post(`${base}/api/auth/signup`, { data: { username, password, displayName: username } });
      if (!up.ok()) throw new Error(`sign-in failed: ${up.status()} ${await up.text()}`);
    }
  }
  for (const p of paths.length ? paths : ['/']) {
    // A fresh tab per path: a tab's session storage would carry the last page's scroll into the next one.
    const page = await ctx.newPage();
    const slug = p === '/' ? 'home' : p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(Number(process.env.SHOT_WAIT || 12000));
    await page.screenshot({ path: `${out}/${v.name}-${slug}-top.png` });
    await page.mouse.wheel(0, v.height * 1.1);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${v.name}-${slug}-scrolled.png` });
    if (v.name === 'desktop') { await page.mouse.wheel(0, 99999); await page.waitForTimeout(2500); await page.screenshot({ path: `${out}/${v.name}-${slug}-full.png`, fullPage: true }); }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log('done');
