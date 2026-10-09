import { describe, it, expect } from 'vitest';
import { escapeLike } from '../src/lib/like.ts';

describe('escapeLike', () => {
  it('backslash-escapes backslash, percent and underscore', () => {
    expect(escapeLike('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
  });
  it('leaves plain text alone', () => {
    expect(escapeLike('bob')).toBe('bob');
  });
});
