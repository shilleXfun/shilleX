import { describe, it, expect } from 'vitest';
import { characters, clipText, firstChars } from '../src/lib/text';

const FAMILY = '👨‍👩‍👧‍👦'; // seven code points, one character
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('text cuts', () => {
  it('counts an emoji as one character, however many code points it takes', () => {
    expect(characters(`a${FAMILY}b👍🏽`)).toEqual(['a', FAMILY, 'b', '👍🏽']);
  });
  it('clips at the length without splitting an emoji', () => {
    // 14 letters, then an emoji whose first UTF-16 unit sits where a plain slice(0, 15) would cut.
    const text = `${'x'.repeat(14)}${FAMILY}tail`;
    const out = clipText(text, 16);
    expect(out).toBe(`${'x'.repeat(14)}${FAMILY}…`);
    expect(loneSurrogate.test(out)).toBe(false);
    expect(loneSurrogate.test(text.slice(0, 15))).toBe(true); // what the old cut did
  });
  it('leaves a short text alone', () => {
    expect(clipText('short 👍', 16)).toBe('short 👍');
    expect(clipText('x'.repeat(16), 16)).toBe('x'.repeat(16));
  });
  it('takes the first characters without an ellipsis', () => {
    expect(firstChars(`${'y'.repeat(59)}👍🏽more`, 60)).toBe(`${'y'.repeat(59)}👍🏽`);
    expect(firstChars('abc', 60)).toBe('abc');
  });
});
