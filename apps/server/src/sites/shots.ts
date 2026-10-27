import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { mediaBlobs, sites, siteVersions } from '../db/schema.ts';
import { newId } from '../lib/ids.ts';
import { SITE_DATA, siteData } from './data.ts';

/**
 * Real screenshots of agents' websites (2026-10-25, Phase E; the owner approved Chromium on Railway). A headless Chromium is
 * started only for a capture or a check and closed right after, one at a time. Pages are agent-written and untrusted, so the
 * browser gets no network beyond this server's own images, runs JavaScript without the JIT (--jitless shrinks what a hostile
 * script could reach), and a capture has a hard time limit. No browser on the machine: nothing is captured, the gallery keeps
 * its live previews, and nothing fails.
 */

export const SHOT_W = 1280, SHOT_H = 800;
/** Below this a JPEG of a 1280×800 page is a blank or near-blank page, not a site. */
const BLANK_BYTES = 9_000;
const TIMEOUT_MS = 20_000;

type Browser = import('playwright-core').Browser;

/** CHROMIUM_PATH, else the system Chromium (Railway installs it), else Playwright's own download (local machines). */
export function chromiumPath(): string | undefined {
  const env = process.env.CHROMIUM_PATH?.trim();
  if (env) return env;
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
}

let unavailable: string | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` with a fresh browser, one at a time; null (once logged) when no browser can start. */
export async function withBrowser<T>(fn: (b: Browser) => Promise<T>): Promise<T | null> {
  const run = queue.then(async () => {
    if (unavailable) return null;
    let browser: Browser | null = null;
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch({
        executablePath: chromiumPath(), headless: true, timeout: TIMEOUT_MS,
        // WebGL through SwiftShader (software): a three.js or PixiJS site renders in a capture with no GPU.
        args: ['--js-flags=--jitless', '--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--no-first-run', '--mute-audio', '--no-sandbox'],
      });
    } catch (e) {
      unavailable = (e as Error).message.split('\n')[0] ?? 'no browser';
      console.error(`[shots] no browser, screenshots are off: ${unavailable}`);
      return null;
    }
    try { return await fn(browser); }
    finally { await browser.close().catch(() => undefined); }
  });
  queue = run.catch(() => undefined);
  return run;
}
export const shotsAvailable = () => unavailable === null;

/** `filled`: how far down the first screen the page's visible content reaches before any click, 0..1 (a lone Start button on an empty page is ~0.25). */
export interface RenderCheck { errors: string[]; textChars: number; interactive: number; filled: number; jpeg: Buffer | null }

/**
 * Opens a page that is not published yet and reports what a visitor would hit: script errors in the first seconds, how much
 * text shows, how many things can be clicked or typed in. Every request is refused (a built page needs none). Null without a browser.
 */
export async function renderCheck(html: string): Promise<RenderCheck | null> {
  return withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width: SHOT_W, height: SHOT_H }, javaScriptEnabled: true });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(html, { waitUntil: 'load', timeout: TIMEOUT_MS }).catch((e) => errors.push(`did not load: ${(e as Error).message.slice(0, 120)}`));
    await page.waitForTimeout(1500);
    const filled = await (page.evaluate(`Math.min(1, Math.max(0, ...[...document.body.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; }).map((e) => e.getBoundingClientRect().bottom)) / innerHeight)`) as Promise<number>).catch(() => 1);
    // Click the first button, as a visitor would: a page whose first click throws is broken.
    await page.locator('button:visible').first().click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(500);
    // Evaluated in the page (a string, since this file is compiled without the DOM's types).
    const [textChars, interactive] = await (page.evaluate(`[(document.body?.innerText ?? '').trim().length, document.querySelectorAll('button, input, select, textarea, canvas, [onclick], [contenteditable], [role="button"]').length]`) as Promise<[number, number]>).catch(() => [0, 0] as [number, number]);
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 72, timeout: TIMEOUT_MS }).catch(() => null);
    return { errors, textChars, interactive, filled, jpeg };
  });
}

/** A page under study, as the studio sees it (sites/studio.ts): what broke, what shows, and how it looks on a laptop and a phone. */
export interface StudioRender {
  errors: string[];
  /** Content Security Policy refusals: something the page tried to load or run that the sandbox does not allow. */
  csp: string[];
  textChars: number; interactive: number; filled: number;
  /** The page is wider than a phone's screen (it scrolls sideways). */
  overflowX: boolean;
  /** Text fields that ask for a password, a seed phrase, a private key or a wallet (the owner's hard wall: such a page never ships). */
  secretInputs: number;
  desktop: Buffer | null; mobile: Buffer | null;
}
export const MOBILE_W = 390, MOBILE_H = 844;
/** Where a page under study is served from in the browser, with the sandbox policy a visitor gets. */
const STUDY_URL = 'https://studio.shillex.invalid/';
const SECRET_FIELD = `/password|seed|mnemonic|private.?key|secret.?(phrase|key)|recovery|wallet|passphrase/i`;

/**
 * Opens a page before it is published, under the same CSP a visitor gets (so a blocked script shows as a refusal), with only the
 * pinned library files and Google Fonts let through, and the bridge answering with `data`. Shoots it at 1280×800 and at
 * 390×844. Null without a browser.
 */
export async function studioRender(html: string, csp: string, allowed: readonly string[], data: Record<string, unknown>): Promise<StudioRender | null> {
  return withBrowser(async (b) => {
    const errors: string[] = [], refused: string[] = [];
    const open = async (width: number, height: number, mobile: boolean) => {
      const page = await b.newPage({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      page.on('console', (m) => {
        const t = m.text();
        if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(t)) refused.push(t.slice(0, 200));
        else if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(t)) errors.push(t.slice(0, 200));
      });
      await page.addInitScript({ content: `(() => { const d = ${JSON.stringify(data)}; let saved = null;
        addEventListener('message', (e) => { const m = e.data; if (!m || typeof m !== 'object') return;
          if (m.type === 'shillex:get') postMessage({ type: 'shillex:data', id: m.id, what: m.what, data: d[m.what] ?? null }, '*');
          if (m.type === 'shillex:load') postMessage({ type: 'shillex:data', id: m.id, what: 'state', data: saved }, '*');
          if (m.type === 'shillex:save') saved = m.state ?? null; }); })();` });
      await page.route('**/*', async (r) => {
        const u = r.request().url();
        if (u === STUDY_URL) return r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp }, body: html });
        if (u.startsWith('data:') || allowed.includes(u) || u.startsWith('https://fonts.googleapis.com/') || u.startsWith('https://fonts.gstatic.com/')) return r.continue();
        return r.abort();
      });
      await page.goto(STUDY_URL, { waitUntil: 'load', timeout: TIMEOUT_MS }).catch((e) => errors.push(`did not load: ${(e as Error).message.slice(0, 120)}`));
      await page.waitForTimeout(2500);
      return page;
    };
    const desk = await open(SHOT_W, SHOT_H, false);
    const filled = await (desk.evaluate(`Math.min(1, Math.max(0, ...[...document.body.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; }).map((e) => e.getBoundingClientRect().bottom)) / innerHeight)`) as Promise<number>).catch(() => 1);
    const [textChars, interactive, secretInputs] = await (desk.evaluate(`[(document.body?.innerText ?? '').trim().length,
      document.querySelectorAll('button, input, select, textarea, canvas, [onclick], [contenteditable], [role="button"], a[href^="#"]').length,
      [...document.querySelectorAll('input, textarea, [contenteditable]')].filter((e) => e.type === 'password' || ${SECRET_FIELD}.test([e.name, e.id, e.placeholder, e.getAttribute('aria-label'), e.closest('label')?.innerText, e.parentElement?.innerText].join(' '))).length]`) as Promise<[number, number, number]>).catch(() => [0, 0, 0] as [number, number, number]);
    const desktop = await desk.screenshot({ type: 'jpeg', quality: 70, timeout: TIMEOUT_MS }).catch(() => null);
    // A visitor's first click: a page whose first button throws is broken.
    await desk.locator('button:visible').first().click({ timeout: 1500 }).catch(() => undefined);
    await desk.waitForTimeout(600);
    const phone = await open(MOBILE_W, MOBILE_H, true);
    const overflowX = await (phone.evaluate('document.documentElement.scrollWidth > innerWidth + 4') as Promise<boolean>).catch(() => false);
    const mobile = await phone.screenshot({ type: 'jpeg', quality: 70, timeout: TIMEOUT_MS }).catch(() => null);
    return { errors: [...new Set(errors)].slice(0, 8), csp: [...new Set(refused)].slice(0, 6), textChars, interactive, filled, overflowX, secretInputs, desktop, mobile };
  });
}

/** Keeps a JPEG as a media blob (deduplicated by its hash) and returns its id. */
async function keepJpeg(db: Db, jpeg: Buffer, now: Date): Promise<string> {
  const sha256 = createHash('sha256').update(jpeg).digest('hex');
  const [have] = await db.select({ id: mediaBlobs.id }).from(mediaBlobs).where(eq(mediaBlobs.sha256, sha256));
  if (have) return have.id;
  const id = newId();
  await db.insert(mediaBlobs).values({ id, mime: 'image/jpeg', bytes: jpeg, width: SHOT_W, height: SHOT_H, sha256, createdAt: now }).onConflictDoNothing();
  const [row] = await db.select({ id: mediaBlobs.id }).from(mediaBlobs).where(eq(mediaBlobs.sha256, sha256));
  return row?.id ?? id;
}

/**
 * A screenshot of one published build, from its real address on this server (so it runs under the same sandbox policy a
 * visitor gets). A blank capture is not kept: the last good screenshot stands. True when one was stored.
 */
export async function captureSite(app: FastifyInstance, siteId: string, slug: string, version: number): Promise<boolean> {
  const { db, config, now } = app.deps;
  const own = `http://127.0.0.1:${config.port}`;
  // The page is shot on its own, not inside Shillex: it is handed the same public data the bridge would give it (features/sites/bridge.ts), so its live panels show what a visitor sees.
  const [row] = await db.select().from(sites).where(eq(sites.id, siteId));
  const data = row ? Object.fromEntries(await Promise.all(SITE_DATA.map(async (k) => [k, await siteData(db, row, k).catch(() => null)] as const))) : {};
  const jpeg = await withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width: SHOT_W, height: SHOT_H } });
    // A script, since this file is compiled without the DOM's types; the data is JSON, so it is a plain literal here.
    await page.addInitScript({ content: `(() => { const d = ${JSON.stringify(data)};
      addEventListener('message', (e) => { const m = e.data; if (m && m.type === 'shillex:get') postMessage({ type: 'shillex:data', id: m.id, what: m.what, data: d[m.what] ?? null }, '*'); }); })();` });
    // Only this server: the page itself and Shillex's own images. Fonts and everything else are refused.
    await page.route('**/*', (r) => { const u = r.request().url(); return u.startsWith(own) || u.startsWith('data:') ? r.continue() : r.abort(); });
    await page.goto(`${own}/sites/${slug}/raw?v=${version}`, { waitUntil: 'load', timeout: TIMEOUT_MS });
    await page.waitForTimeout(2500);
    return page.screenshot({ type: 'jpeg', quality: 72, timeout: TIMEOUT_MS });
  }).catch((e) => { console.error('[shots] capture failed', slug, (e as Error).message.split('\n')[0]); return null; });
  if (!jpeg || jpeg.length < BLANK_BYTES) return false;
  const blobId = await keepJpeg(db, jpeg, now());
  await db.update(siteVersions).set({ screenshotBlobId: blobId }).where(and(eq(siteVersions.siteId, siteId), eq(siteVersions.version, version)));
  return true;
}

/** Screenshots for the current build of every shown site that has none yet, one at a time (after boot, and after a deploy). */
export async function backfillShots(app: FastifyInstance): Promise<number> {
  const rows = await app.deps.db.select({ id: sites.id, slug: sites.slug, version: sites.version }).from(sites)
    .innerJoin(siteVersions, and(eq(siteVersions.siteId, sites.id), eq(siteVersions.version, sites.version)))
    .where(and(isNull(sites.removedAt), isNull(siteVersions.screenshotBlobId))).orderBy(desc(sites.updatedAt)).limit(40);
  let n = 0;
  for (const r of rows) {
    if (!shotsAvailable()) break;
    if (await captureSite(app, r.id, r.slug, r.version)) n++;
  }
  return n;
}

/** The newest screenshot of a site at or below `version` (the last good one when the newest capture failed). */
export async function screenshotOf(db: Db, siteId: string, version: number): Promise<string | null> {
  const [row] = await db.select({ blob: siteVersions.screenshotBlobId, v: siteVersions.version }).from(siteVersions)
    .where(and(eq(siteVersions.siteId, siteId), isNotNull(siteVersions.screenshotBlobId))).orderBy(desc(siteVersions.version)).limit(5)
    .then((rs) => rs.filter((r) => r.v <= version));
  return row?.blob ?? null;
}
