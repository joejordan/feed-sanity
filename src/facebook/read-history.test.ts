import { describe, expect, it, vi } from 'vitest';
import { SavedData } from '../core/saved';
import { inMemoryStore } from '../core/testing';
import {
  isPostRead,
  isValidPostId,
  pruneReadHistory,
  READ_HISTORY_KEY,
  readReadHistory,
  savedReadHistory,
  setPostsRead,
} from './read-history';
import { NO_POST_ID } from './selectors';

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'pfbid02Kq8vXz3mUoRbLw9Tn4AhYc5dEf6Gj7Hk1MpNs2Qr3St4Uv5Wx6Yz7ab8cd9eLl';

describe('isValidPostId', () => {
  it('accepts numeric IDs and story tokens', () => {
    expect(isValidPostId('123456')).toBe(true);
    expect(isValidPostId('10234567890123456')).toBe(true);
    expect(isValidPostId(TOKEN)).toBe(true);
  });

  it('rejects everything else', () => {
    for (const id of [
      null,
      undefined,
      '',
      '0',
      '0123456',
      '12345',
      '-5',
      '12.5',
      ' 123',
      NO_POST_ID,
      'pfbid0',
      'pfbid0abc',
      // No closing `l`, and an `O` and `0` that base58 lacks.
      'pfbid02Kq8vXz3mUoRbLw9Tn4AhYc5dEf6Gj7Hk1MpNs',
      'pfbid02Kq8vXz3mUoRbLw9TnOAhYc5dEf60j7Hk1MpNsl',
      '1'.repeat(400),
    ]) {
      expect(isValidPostId(id)).toBe(false);
    }
  });
});

describe('readReadHistory', () => {
  it('turns anything but a plain object into an empty history', () => {
    for (const stored of [undefined, null, 'x', 5, true, [], ['123123'], new Date(), new Map()]) {
      expect(readReadHistory(stored)).toEqual({});
    }
  });

  it('keeps only entries with a valid ID and a positive finite time', () => {
    expect(
      readReadHistory({
        '123123': 1000,
        [TOKEN]: 2000,
        '0': 1000,
        none: 1000,
        abc: 1000,
        '456456': 0,
        '789789': -1,
        '111111': Number.POSITIVE_INFINITY,
        '222222': '1000',
        '333333': null,
      }),
    ).toEqual({ '123123': 1000, [TOKEN]: 2000 });
  });

  it('reads an object without a prototype', () => {
    const stored = Object.assign(Object.create(null) as object, { '123123': 5 });
    expect(readReadHistory(stored)).toEqual({ '123123': 5 });
  });
});

describe('isPostRead', () => {
  it('is true only for a valid ID in the history', () => {
    const history = { '123123': 1 };
    expect(isPostRead(history, '123123')).toBe(true);
    expect(isPostRead(history, '456456')).toBe(false);
    expect(isPostRead(history, null)).toBe(false);
    expect(isPostRead(history, 'toString')).toBe(false);
  });
});

describe('pruneReadHistory', () => {
  const now = 100 * DAY;

  it('drops marks older than the number of days', () => {
    const history = { '100001': now - 30 * DAY, '100002': now - 27 * DAY, '100003': now - DAY };
    expect(pruneReadHistory(history, 28, now)).toEqual({
      '100002': now - 27 * DAY,
      '100003': now - DAY,
    });
  });

  it('returns null when nothing is old enough', () => {
    expect(pruneReadHistory({ '100001': now - DAY }, 28, now)).toBeNull();
    expect(pruneReadHistory({}, 28, now)).toBeNull();
  });

  it('keeps everything for zero or fewer days', () => {
    const history = { '100001': 1 };
    expect(pruneReadHistory(history, 0, now)).toBeNull();
    expect(pruneReadHistory(history, -3, now)).toBeNull();
    expect(pruneReadHistory(history, Number.NaN, now)).toBeNull();
  });
});

describe('savedReadHistory and setPostsRead', () => {
  it('gives the same object for the same saved data', () => {
    const data = new SavedData(inMemoryStore(), 'u');
    expect(savedReadHistory(data)).toBe(savedReadHistory(data));
  });

  it('reads what is stored tolerantly', async () => {
    const data = new SavedData(
      inMemoryStore({ [`u/${READ_HISTORY_KEY}`]: { '123123': 5, bad: 7 } }),
      'u',
    );
    const saved = savedReadHistory(data);
    await saved.ready;
    expect(saved.get()).toEqual({ '123123': 5 });
  });

  it('marks and unmarks many posts with one write', async () => {
    const store = inMemoryStore({ [`u/${READ_HISTORY_KEY}`]: { '100001': 50 } });
    const set = vi.spyOn(store, 'set');
    const saved = savedReadHistory(new SavedData(store, 'u'));

    expect(
      await setPostsRead(saved, ['100001', '100002', '100003', 'bad', '100002'], true, 900),
    ).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    // A post marked already keeps the time it was first marked.
    expect(saved.get()).toEqual({ '100001': 50, '100002': 900, '100003': 900 });
    expect(await store.get(`u/${READ_HISTORY_KEY}`)).toEqual(saved.get());

    expect(await setPostsRead(saved, ['100001', '100003'], false)).toBe(true);
    expect(set).toHaveBeenCalledTimes(2);
    expect(saved.get()).toEqual({ '100002': 900 });
  });

  it('writes nothing when nothing changes', async () => {
    const store = inMemoryStore({ [`u/${READ_HISTORY_KEY}`]: { '100001': 50 } });
    const set = vi.spyOn(store, 'set');
    const saved = savedReadHistory(new SavedData(store, 'u'));

    expect(await setPostsRead(saved, ['100001'], true)).toBe(false);
    expect(await setPostsRead(saved, ['100002', NO_POST_ID], false)).toBe(false);
    expect(await setPostsRead(saved, [], true)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
