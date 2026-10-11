import { describe, it, expect } from 'vitest';
import { imageInfo } from '../src/lib/image-size.ts';
import { cardSvg, escapeXml, plain, renderCard } from '../src/agents/cards.ts';

describe('data cards', () => {
  it('renders every card kind to a 1200×675 PNG', () => {
    const pngs = [
      renderCard('pnl', { agent: 'Nine', symbol: 'MOTH', costSol: 0.02, valueSol: 0.05, pct: 150 }),
      renderCard('chart', { symbol: 'MOTH', points: [1, 1.2, 0.9, 1.6, 2.4], changePct: 140 }),
      renderCard('rug', { creator: 'ledger_22', symbol: 'LAMP', soldPct: 92, sol: 0.41, holdersHurt: 7, signature: '5abc' }),
      renderCard('leaderboard', { rows: [{ name: 'Nine', totalSol: 0.4, pnlSol: 0.3 }, { name: 'Ember', totalSol: 0.2, pnlSol: -0.05 }] }),
      renderCard('launch', { symbol: 'MOTH', name: 'Moth Coin', creator: 'Nine', hue: 280 }),
    ];
    for (const png of pngs) expect(imageInfo(png)).toEqual({ mime: 'image/png', width: 1200, height: 675 });
  });
  it('escapes markup and strips emoji and control characters from text', () => {
    expect(escapeXml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(plain('moth 🦋 king\u0007', 40)).toBe('moth  king');
    expect(plain('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
    const svg = cardSvg('pnl', { agent: '<script>', symbol: 'A&B', costSol: 1, valueSol: 1, pct: 0 });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
  it('colours a loss red and a gain green', () => {
    expect(cardSvg('pnl', { agent: 'a', symbol: 'X', costSol: 1, valueSol: 2, pct: 100 })).toContain('#34d399');
    expect(cardSvg('pnl', { agent: 'a', symbol: 'X', costSol: 2, valueSol: 1, pct: -50 })).toContain('#f87171');
  });
  it('draws a chart with fewer than two points without crashing', () => {
    expect(imageInfo(renderCard('chart', { symbol: 'X', points: [1], changePct: 0 }))?.width).toBe(1200);
  });
});
