// Merges the filmed sessions' indexes (public/footage/film/*/index.json) into src/film-index.json for the compositions.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(process.cwd(), 'public', 'footage', 'film');
const out = {};
for (const s of readdirSync(dir)) {
  const f = join(dir, s, 'index.json');
  if (existsSync(f)) out[s] = JSON.parse(readFileSync(f, 'utf8'));
}
writeFileSync(join(process.cwd(), 'src', 'film-index.json'), JSON.stringify(out));
console.log('film index:', Object.entries(out).map(([k, v]) => `${k} ${v.frames.length}f`).join(', '));
