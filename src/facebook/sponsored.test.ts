import { describe, expect, it, vi } from 'vitest';
import { checkSponsored, postSponsored } from './sponsored';

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
