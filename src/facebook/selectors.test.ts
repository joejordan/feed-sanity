import { describe, expect, it } from 'vitest';
import { ATOM_RULES } from './atom-rules';
import { TOKEN } from './atoms';
import * as selectors from './selectors';

describe('selectors', () => {
  const texts = Object.values(selectors).flatMap((value) =>
    typeof value === 'string' ? [value] : Object.values(value),
  );

  it('only uses S2F_ names that have a rule', () => {
    const names = texts.flatMap((text) => [...text.matchAll(TOKEN)].map((m) => m[1]));

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !((name as string) in ATOM_RULES))).toEqual([]);
  });

  it('holds valid selectors', () => {
    const marks: readonly string[] = Object.values(selectors.MARK);
    for (const text of texts.filter((text) => !marks.includes(text))) {
      expect(() => document.querySelector(text), text).not.toThrow();
    }
  });
});
