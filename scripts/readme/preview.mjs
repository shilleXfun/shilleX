#!/usr/bin/env node
// Renders README.md the way GitHub does and screenshots it in the light and dark themes.
//
//   node scripts/readme/preview.mjs [--out <dir>]
//
// The markdown goes through GitHub's own renderer (POST https://api.github.com/markdown, no token needed for a few
// calls), is wrapped in github-markdown-css, and is shot headless at GitHub's 1012 px README width. Relative image
// paths resolve to this checkout, so unpushed images show up.

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(ROOT, 'data/readme/preview');
const CACHE = join(ROOT, 'data/readme/cache');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const res = await fetch('https://api.github.com/markdown', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/vnd.github+json', 'user-agent': 'shillex-readme-preview' },
  body: JSON.stringify({ text: readFileSync(join(ROOT, 'README.md'), 'utf8'), mode: 'gfm', context: 'shilleXfun/shilleX' }),
});
if (!res.ok) throw new Error(`GitHub markdown API: ${res.status} ${await res.text()}`);
const html = await res.text();

async function css(theme) {
  const file = join(CACHE, `github-markdown-${theme}.css`);
  if (!existsSync(file)) {
    const r = await fetch(`https://cdn.jsdelivr.net/npm/github-markdown-css@5.8.1/github-markdown-${theme}.css`);
    if (!r.ok) throw new Error(`github-markdown-css: ${r.status}`);
    writeFileSync(file, await r.text());
  }
  return readFileSync(file, 'utf8');
}

const TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.html': 'text/html' };
const pages = {};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (pages[url.pathname]) { res.writeHead(200, { 'content-type': 'text/html' }).end(pages[url.pathname]); return; }
  const file = join(ROOT, normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
for (const theme of ['dark', 'light']) {
  pages[`/${theme}.html`] = `<!doctype html><html><head><meta charset="utf-8"><base href="${origin}/">
    <style>${await css(theme)}</style>
    <style>
      body { margin: 0; background: ${theme === 'dark' ? '#0d1117' : '#ffffff'}; }
      .box { width: 1012px; margin: 24px auto; border: 1px solid ${theme === 'dark' ? '#3d444d' : '#d1d9e0'}; border-radius: 6px; }
      .markdown-body { box-sizing: border-box; padding: 32px; }
    </style></head>
    <body><div class="box"><article class="markdown-body">${html}</article></div></body></html>`;
  const page = await browser.newPage({ viewport: { width: 1080, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await page.goto(`${origin}/${theme}.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const file = join(OUT, `readme-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('[preview]', file);
  await page.close();
}
await browser.close();
server.close();
