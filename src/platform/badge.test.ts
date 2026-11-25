import { describe, expect, it, vi } from 'vitest';
import type { ToolbarButton, ToolbarIconPath } from './badge';
import { FIREFOX_TOOLBAR_ICON, OPTIONS_TITLE } from '../../project';
import { ACTIVE_ICON_PATHS, badgeListener, badgeText, PAUSED_ICON_PATHS, showBadge } from './badge';
import { badgeMessage, OPEN_OPTIONS } from './messages';

/** A toolbar button that records what is set on it, as `action` (MV3) and `browserAction` (MV2) both take it. */
function fakeButton() {
  const set = {
    text: new Map<number, string>(),
    colour: new Map<number, string>(),
    title: new Map<number, string>(),
    icon: new Map<number, ToolbarIconPath>(),
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
    setIcon: vi.fn(({ tabId, path }) => {
      set.icon.set(tabId, path);
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
  it('sets the text, colour, icon, and title for the one tab including paused monochrome state', async () => {
    const { button, set } = fakeButton();

    await showBadge(button, 4, { count: 3, failed: false });
    await showBadge(button, 9, { count: 0, failed: true });
    await showBadge(button, 11, { count: 0, failed: false, paused: true });
    await showBadge(button, 14, { count: 0, failed: false }, FIREFOX_TOOLBAR_ICON);

    expect(set.text).toEqual(
      new Map([
        [4, ''],
        [9, '!'],
        [11, ''],
        [14, ''],
      ]),
    );
    expect(set.colour.has(4)).toBe(false);
    expect(set.colour.get(9)).toBe('#e41e3f');
    expect(set.title.get(4)).toBe(OPTIONS_TITLE);
    expect(set.title.get(9)).toContain('stopped working');
    expect(set.title.get(11)).toContain('paused');
    expect(set.icon.get(4)).toEqual(ACTIVE_ICON_PATHS);
    expect(set.icon.get(9)).toEqual(ACTIVE_ICON_PATHS);
    expect(set.icon.get(11)).toEqual(PAUSED_ICON_PATHS);
    expect(set.icon.get(14)).toBe(FIREFOX_TOOLBAR_ICON);
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

    listener(badgeMessage({ count: 0, failed: false, paused: true }), { tab: { id: 12 } });
    await vi.waitFor(() => expect(set.icon.get(12)).toEqual(PAUSED_ICON_PATHS));
    expect(set.title.get(12)).toContain('paused');
  });

  it('restores a custom active icon (e.g. Firefox SVG) through badgeListener after unpausing', async () => {
    const { button, set } = fakeButton();
    const listener = badgeListener(button, FIREFOX_TOOLBAR_ICON);

    listener(badgeMessage({ count: 0, failed: false, paused: true }), { tab: { id: 7 } });
    await vi.waitFor(() => expect(set.icon.get(7)).toEqual(PAUSED_ICON_PATHS));

    listener(badgeMessage({ count: 0, failed: false }), { tab: { id: 7 } });
    await vi.waitFor(() => expect(set.icon.get(7)).toBe(FIREFOX_TOOLBAR_ICON));
  });

  it('ignores other messages and messages from outside a tab', async () => {
    const { button } = fakeButton();
    const listener = badgeListener(button);

    listener(OPEN_OPTIONS, { tab: { id: 12 } });
    listener({ type: 'feed-sanity/badge', badge: { count: 'many' } }, { tab: { id: 12 } });
    listener(
      { type: 'feed-sanity/badge', badge: { count: 0, failed: false, paused: 'yes' } },
      { tab: { id: 12 } },
    );
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
