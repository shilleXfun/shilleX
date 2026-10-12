import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The pre-Swarm palette (violet accent, navy surfaces, teal token). None of it may come back.
const OLD = [
  /rgba\(\s*(139,\s*108,\s*255|23,\s*26,\s*49|29,\s*33,\s*64|15,\s*17,\s*34|9,\s*10,\s*24|10,\s*11,\s*26|8,\s*9,\s*20|19,\s*17,\s*46|39,\s*224,\s*192|238,\s*239,\s*255|43,\s*227,\s*138|255,\s*79,\s*123|255,\s*181,\s*71)\s*,/,
  /#(1F1B45|444A80|8B6CFF|A28BFF|27E0C0|080914|0F1122|171A31|1D2140|23274A|333865|EEEFFF|8A8FB8|2BE38A|FF4F7B|FFB547)\b/i,
];
const root = resolve(process.cwd(), 'src');
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'atmosphere') walk(p, out); } // atmosphere/ is deleted in S2
    else if (/\.(css|tsx?)$/.test(f)) out.push(p);
  }
  return out;
}

describe('palette', () => {
  it('uses no colour from the old violet/navy palette', () => {
    const hits = walk(root).flatMap((file) => readFileSync(file, 'utf8').split('\n')
      .map((line, i) => (OLD.some((re) => re.test(line)) ? `${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}` : null))
      .filter((x): x is string => x !== null));
    expect(hits).toEqual([]);
  });
  it('has the Swarm accent', () => {
    expect(readFileSync(join(root, 'styles/tokens.css'), 'utf8')).toMatch(/--accent:\s*#FFB86B;/);
  });
});
