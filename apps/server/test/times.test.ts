import { describe, it, expect } from 'vitest';
import { parseFeed } from '../src/agents/times/rss.ts';
import { finishArticle, stripInventedQuotes } from '../src/agents/times/write.ts';
import { REPORTERS } from '../src/agents/times/reporters.ts';

/** The Shillex Times (2026-10-28 brief §7): reporters never invent quotes from real people; satire is always labelled. */
describe('stripInventedQuotes', () => {
  it('drops a sentence whose quote is in no source and keeps one that is', () => {
    const out = stripInventedQuotes([
      'The minister said “we will ban every coin by Friday” and left the room.',
      'Then @tide_reader posted "curve looks tired tonight". Nobody answered.',
    ], ['curve looks tired tonight']);
    expect(out).toEqual(['Then @tide_reader posted "curve looks tired tonight". Nobody answered.']);
  });
  it('leaves short scare quotes alone', () => {
    expect(stripInventedQuotes(['They called it a "rug" again.'], [])).toEqual(['They called it a "rug" again.']);
  });
});

describe('finishArticle', () => {
  it('labels satire, whatever the model wrote', () => {
    const a = finishArticle({ kind: 'satire', headline: 'Central Bank Of Shillex Prints More Vibes', dek: 'Inflation of feelings hits a record.', body: ['One.', 'Two.'], pullQuote: null }, []);
    expect(a.label).toBe('SATIRE');
    expect(a.section).toBe('satire');
    expect(a.dek.startsWith('SATIRE')).toBe(true);
  });
  it('keeps real news in the World section and checks its quotes against the sources', () => {
    const a = finishArticle({ kind: 'real_news', headline: 'Chip Exports Slow', dek: 'A summary.', body: ['The ministry said “exports fell by a third” on Monday.', 'Shipments fell.'], pullQuote: '“exports fell by a third”' }, ['exports fell by a third']);
    expect(a.section).toBe('world');
    expect(a.label).toBeNull();
    expect(a.body).toHaveLength(2);
    expect(finishArticle({ kind: 'real_news', headline: 'H', dek: 'D', body: ['He said “a quote nobody made at all”.', 'Fact.'], pullQuote: '“a quote nobody made at all”' }, []).pullQuote).toBeNull();
  });
});

describe('parseFeed', () => {
  it('reads RSS 2.0 items', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Wire</title><item><title><![CDATA[Markets <b>slip</b> &amp; rally]]></title><link>https://example.com/a</link><description>&lt;p&gt;Stocks fell, then rose.&lt;/p&gt;</description><pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    expect(parseFeed(xml, 'Wire')).toEqual([{ title: 'Markets slip & rally', link: 'https://example.com/a', summary: 'Stocks fell, then rose.', published: new Date('2026-10-27T10:00:00Z'), source: 'Wire' }]);
  });
  it('reads Atom entries', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>New chip</title><link rel="alternate" href="https://example.org/b"/><summary>A faster one.</summary><updated>2026-10-27T09:30:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, 'Tech')).toEqual([{ title: 'New chip', link: 'https://example.org/b', summary: 'A faster one.', published: new Date('2026-10-27T09:30:00Z'), source: 'Tech' }]);
  });
});

describe('reporters', () => {
  it('has a few reporters, each with a beat and a voice', () => {
    expect(REPORTERS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(REPORTERS.map((r) => r.beat))).toEqual(new Set(['markets', 'coins', 'drama', 'world', 'satire']));
    for (const r of REPORTERS) expect(r.voice.length).toBeGreaterThan(20);
  });
});
