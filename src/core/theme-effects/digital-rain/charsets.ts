// Adapted from `@ignitesoftware/digital-rain` (Joe Jordan / Ignite Software).
// Glyph charsets and grapheme splitting for Matrix Digital Rain.

function codePointRange(first: number, last: number): string {
  return String.fromCodePoint(
    ...Array.from({ length: last - first + 1 }, (_, index) => first + index),
  );
}

const HALF_WIDTH_KATAKANA = codePointRange(0xff_66, 0xff_9d);
const DIGITS = '0123456789';

export type RainCharsetName =
  | 'binary'
  | 'braille'
  | 'decimal'
  | 'hex'
  | 'katakana'
  | 'latin'
  | 'matrix'
  | 'symbols';

export const RAIN_CHARSETS: Readonly<Record<RainCharsetName, string>> = {
  matrix: `${HALF_WIDTH_KATAKANA}${DIGITS}:.=*+-<>|`,
  katakana: HALF_WIDTH_KATAKANA,
  binary: '01',
  decimal: DIGITS,
  hex: `${DIGITS}ABCDEF`,
  latin: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  symbols: String.raw`!?#$%&*+-=<>/\|~^:;[]{}()@`,
  braille: codePointRange(0x28_01, 0x28_ff),
};

export const MAX_GLYPHS = 512;

const WHITESPACE = /^\s+$/u;

export function splitGlyphs(charset: string): string[] {
  const pieces =
    typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(charset)].map(
          (part) => part.segment,
        )
      : [...charset];
  const unique = new Set(pieces.filter((piece) => !WHITESPACE.test(piece)));
  return [...unique].slice(0, MAX_GLYPHS);
}
