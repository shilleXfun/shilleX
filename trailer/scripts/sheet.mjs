// The storyboard on one sheet: every still in out/storyboard, numbered, with its shot name, into out/storyboard-sheet.png.
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(process.cwd(), 'out', 'storyboard');
const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString('base64')}"><figcaption>${f.replace('.png', '').replace(/^(\d+)-/, '$1 · ').replace(/-/g, ' ')}</figcaption></figure>`).join('');
const html = `<html><body style="margin:0;background:#080914;font:500 22px ui-monospace,monospace;color:#8a8ba3"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px;padding:40px">${cells}</div><style>figure{margin:0}img{width:100%;border-radius:10px;display:block;box-shadow:0 0 0 1px rgba(255,190,107,.25)}figcaption{padding:10px 2px 0}</style></body></html>`;
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 2400, height: 1200 } });
await p.setContent(html);
await p.screenshot({ path: join(process.cwd(), 'out', 'storyboard-sheet.png'), fullPage: true });
await b.close();
console.log('sheet with', files.length, 'stills');
