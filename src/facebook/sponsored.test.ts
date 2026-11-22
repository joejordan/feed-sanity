import { describe, expect, it, vi } from 'vitest';
import { checkSponsored, postSponsored, rightRailSponsored, rightRailUnits } from './sponsored';

describe('checkSponsored', () => {
  it('takes the answer when it is true or false', () => {
    expect(checkSponsored({ sponsored: true })).toBe(true);
    expect(checkSponsored({ sponsored: false })).toBe(false);
  });

  it('gives null for an answer of any other shape', () => {
    for (const answer of [
      null,
      undefined,
      true,
      'sponsored',
      [true],
      {},
      { sponsored: 'true' },
      { sponsored: 1 },
      { sponsored: { ad_id: '1' } },
    ]) {
      expect(checkSponsored(answer), JSON.stringify(answer)).toBeNull();
    }
  });
});

describe('postSponsored', () => {
  it('asks the post-sponsored reader and checks the answer', async () => {
    const ask = vi.fn(() => Promise.resolve({ sponsored: true, ad_id: '1' }));
    const post = document.createElement('div');
    const signal = new AbortController().signal;

    expect(await postSponsored({ ask }, post, signal)).toBe(true);
    expect(ask).toHaveBeenCalledWith(post, 'post-sponsored', signal);
  });
});

describe('rightRailSponsored & rightRailUnits', () => {
  it('asks the right-rail-sponsored reader and checks the answer', async () => {
    const ask = vi.fn(() => Promise.resolve({ sponsored: true }));
    const unit = document.createElement('div');
    const signal = new AbortController().signal;

    expect(await rightRailSponsored({ ask }, unit, signal)).toBe(true);
    expect(ask).toHaveBeenCalledWith(unit, 'right-rail-sponsored', signal);
  });

  it('descends single-child wrappers to find card siblings and skips single-child placeholders', () => {
    const rail = document.createElement('div');
    rail.innerHTML =
      '<div><div><div id="ad">Sponsored</div><div id="bday">Birthdays</div></div></div>';
    expect(rightRailUnits(rail).map((el) => el.id)).toEqual(['ad', 'bday']);

    const loadingRail = document.createElement('div');
    loadingRail.innerHTML = '<div><div><div></div></div></div>';
    expect(rightRailUnits(loadingRail)).toEqual([]);
  });
});
