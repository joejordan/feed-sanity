import { describe, expect, it, vi } from 'vitest';
import type { ToolbarButton } from './badge';
import { OPTIONS_TITLE } from '../../project';
import { badgeListener, badgeText, showBadge } from './badge';
import { badgeMessage, OPEN_OPTIONS } from './messages';

/** A toolbar button that records what is set on it, as `action` (MV3) and `browserAction` (MV2) both take it. */
function fakeButton() {
  const set = {
    text: new Map<number, string>(),
    colour: new Map<number, string>(),
    title: new Map<number, string>(),
  };
  const button: ToolbarButton = {
    setBadgeText: vi.fn(({ tabId, text }) => {
      set.text.set(tabId, text);
      return Promise.resolve();
    }),
    setBadgeBackgroundColor: vi.fn(({ tabId, color }) => {
      set.colour.set(tabId, color);
      return Promise.resolve();
    }),
    setTitle: vi.fn(({ tabId, title }) => {
      set.title.set(tabId, title);
      return Promise.resolve();
    }),
  };
  return { button, set };
}

describe('badgeText', () => {
  it('shows only the failed mark and keeps the toolbar icon free of hidden-post counts', () => {
    expect(badgeText({ count: 0, failed: false })).toBe('');
    expect(badgeText({ count: 7, failed: false })).toBe('');
    expect(badgeText({ count: 7, failed: true })).toBe('!');
    expect(badgeText({ count: 0, failed: true })).toBe('!');
    expect(badgeText({ count: 1234, failed: false })).toBe('');
  });
});

describe('showBadge', () => {
  it('sets the text, colour and title for the one tab', async () => {
    const { button, set } = fakeButton();

    await showBadge(button, 4, { count: 3, failed: false });
    await showBadge(button, 9, { count: 0, failed: true });

    expect(set.text).toEqual(
      new Map([
        [4, ''],
        [9, '!'],
      ]),
    );
    expect(set.colour.has(4)).toBe(false);
    expect(set.colour.get(9)).toBe('#e41e3f');
    expect(set.title.get(4)).toBe(OPTIONS_TITLE);
    expect(set.title.get(9)).toContain('stopped working');
  });
});

describe('badgeListener', () => {
  it("shows a tab's failed badge on that tab only and leaves counts blank", async () => {
    const { button, set } = fakeButton();
    const listener = badgeListener(button);

    listener(badgeMessage({ count: 2, failed: false }), { tab: { id: 12 } });
    await vi.waitFor(() => expect(set.text).toEqual(new Map([[12, '']])));

    listener(badgeMessage({ count: 2, failed: true }), { tab: { id: 12 } });
    await vi.waitFor(() => expect(set.text).toEqual(new Map([[12, '!']])));
  });

  it('ignores other messages and messages from outside a tab', async () => {
    const { button } = fakeButton();
    const listener = badgeListener(button);

    listener(OPEN_OPTIONS, { tab: { id: 12 } });
    listener({ type: 'feed-sanity/badge', badge: { count: 'many' } }, { tab: { id: 12 } });
    listener(badgeMessage({ count: 2, failed: false }), {});
    await Promise.resolve();

    expect(button.setBadgeText).not.toHaveBeenCalled();
  });

  it('says nothing when the tab has closed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { button } = fakeButton();
    vi.mocked(button.setBadgeText).mockRejectedValue(new Error('No tab with id: 12'));

    badgeListener(button)(badgeMessage({ count: 2, failed: false }), { tab: { id: 12 } });
    await vi.waitFor(() => expect(button.setBadgeText).toHaveBeenCalled());

    expect(error).not.toHaveBeenCalled();
  });
});
