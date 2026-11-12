import { describe, expect, it } from 'vitest';
import { wrapLines } from '../src/ui/shareCard';

// One unit per character keeps the expectations readable.
const measure = (s: string) => s.length;

describe('share card text wrapping', () => {
  it('keeps short text on one line', () => {
    expect(wrapLines('new phone who dis', 40, measure)).toEqual(['new phone who dis']);
  });

  it('breaks at spaces without exceeding the width', () => {
    const lines = wrapLines('did you just slip on a banana. i heard it from here', 20, measure);
    expect(lines).toEqual(['did you just slip on', 'a banana. i heard it', 'from here']);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(20);
  });

  it('splits a word that is wider than the line', () => {
    expect(wrapLines('aaaaaaaaaaaa b', 5, measure)).toEqual(['aaaaa', 'aaaaa', 'aa b']);
  });

  it('never returns nothing', () => {
    expect(wrapLines('   ', 10, measure)).toEqual(['']);
  });
});
