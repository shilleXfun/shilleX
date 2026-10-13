import { describe, it, expect } from 'vitest';
import { ALLOWED_SLOTS, FALLBACK_LINES, FALLBACK_SITUATIONS, composeLine, fallbackPhrasebook } from '../src/agents/phrasebook.ts';
import { PHRASEBOOK_PROMPT_VERSION, PHRASEBOOK_SCHEMA, validatePhrasebook } from '../src/agents/phrasebook-writer.ts';
import { mulberry32 } from '../src/seed/rng.ts';

describe('the news situation (x-feed §5.2)', () => {
  it('is a fallback situation with a {topic} slot, and some lines work without a topic', () => {
    expect(FALLBACK_SITUATIONS).toContain('news');
    expect(ALLOWED_SLOTS.has('topic')).toBe(true);
    expect(FALLBACK_LINES.news.length).toBeGreaterThanOrEqual(12);
    expect(FALLBACK_LINES.news.filter((l) => !l.includes('{topic}')).length).toBeGreaterThanOrEqual(6);
    expect(FALLBACK_LINES.news.every((l) => !/[@$#]|https?:/.test(l))).toBe(true);
  });
  it('composes a topic line when there is a topic, and a plain one when there is none', () => {
    const pb = fallbackPhrasebook('news-agent');
    const withTopic = composeLine(pb, 'news', { topic: 'solana etf filing', weather: 'slow' }, [], () => 0)!;
    expect(withTopic.text.length).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      const plain = composeLine(pb, 'news', { weather: 'slow' }, [], mulberry32(i))!;
      expect(plain.text).not.toMatch(/\{topic\}/);
    }
  });
  it('the phrasebook writer asks for news lines (v3) and accepts {topic} in them', () => {
    expect(PHRASEBOOK_PROMPT_VERSION).toBe('phrasebook-v3');
    expect((PHRASEBOOK_SCHEMA as any).properties.lines.required).toContain('news');
    const lines = Object.fromEntries(FALLBACK_SITUATIONS.map((s) => [s, FALLBACK_LINES[s].slice(0, 6)]));
    const book = validatePhrasebook({ voice: 'plain', traits: { risk: 0.5, chattiness: 0.5, loyalty: 0.5, pettiness: 0.5, greed: 0.5, humor: 0.5, curiosity: 0.5 }, lines, openers: [], closers: [], memeCaptions: [{ situation: 'news', top: '{topic}', bottom: 'me reading it' }], interests: [] });
    expect(book?.lines.news?.some((l) => l.includes('{topic}'))).toBe(true);
    expect(book?.memeCaptions).toEqual([{ situation: 'news', top: '{topic}', bottom: 'me reading it' }]);
  });
});
