import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_THEME_DOCUMENT, findThemePreset, presetToThemeDocument } from '../core/theming';
import { BADGE_DELAY_MS, buildName, extensionPlatform } from './extension';
import {
  badgeMessage,
  fetchThemeUrlMessage,
  GET_POPUP_STATE,
  isThemeUrlFetchResult,
  NAVIGATE_OPTIONS,
  navigateOptionsMessage,
  OPEN_OPTIONS,
  openOptionsMessage,
  parseFetchThemeUrlMessage,
  parseNavigateOptionsMessage,
  THEME_PREVIEW_PORT,
  themePreviewMessage,
} from './messages';

describe('extensionPlatform', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    extensionPlatform.stopBadge?.();
    vi.useRealTimers();
  });

  it('opens the options when the background script or popup says so, and ignores other messages', async () => {
    const listener = vi.fn();
    extensionPlatform.onOpenOptions(listener);

    await browser.runtime.sendMessage('something else');
    expect(listener).not.toHaveBeenCalled();

    await browser.runtime.sendMessage(OPEN_OPTIONS);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(undefined);

    await browser.runtime.sendMessage(openOptionsMessage('Appearance'));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith('Appearance');
  });

  it('answers popup state requests with the active tab metadata', async () => {
    extensionPlatform.onPopupStateRequest?.(async () => ({
      siteId: 'x',
      displayName: 'X (Twitter)',
      storagePrefix: 'x/42',
      enabled: true,
      hiddenCount: 5,
    }));

    const reply = await browser.runtime.sendMessage(GET_POPUP_STATE);
    expect(reply).toEqual({
      siteId: 'x',
      displayName: 'X (Twitter)',
      storagePrefix: 'x/42',
      enabled: true,
      hiddenCount: 5,
    });
  });

  it('streams validated theme previews over the preview port and clears on disconnect', () => {
    type ConnectHandler = Parameters<typeof browser.runtime.onConnect.addListener>[0];
    let onConnect: ConnectHandler | undefined;
    vi.spyOn(browser.runtime.onConnect, 'addListener').mockImplementation((handler) => {
      onConnect = handler;
    });

    const createFakePort = (name: string) => {
      const messageListeners: Array<(msg: unknown) => void> = [];
      const disconnectListeners: Array<() => void> = [];
      const port = {
        name,
        onMessage: { addListener: (fn: (msg: unknown) => void) => messageListeners.push(fn) },
        onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
      };
      onConnect?.(port as unknown as Parameters<ConnectHandler>[0]);
      return {
        send: (msg: unknown) => {
          for (const fn of messageListeners) {
            fn(msg);
          }
        },
        disconnect: () => {
          for (const fn of disconnectListeners) {
            fn();
          }
        },
      };
    };

    const listener = vi.fn();
    extensionPlatform.onThemePreview?.(listener);

    const mochaDoc = presetToThemeDocument(findThemePreset('catppuccin-mocha')!);
    const ignoredPort = createFakePort('other-port');
    ignoredPort.send(themePreviewMessage(mochaDoc));
    expect(listener).not.toHaveBeenCalled();

    const port = createFakePort(THEME_PREVIEW_PORT);
    port.send({ type: 'preview', document: { bogus: true } });
    expect(listener).not.toHaveBeenCalled();

    port.send(themePreviewMessage(mochaDoc));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(mochaDoc);

    port.send(themePreviewMessage(null));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(null);

    // Disconnecting while not previewing does not emit a redundant clear.
    port.disconnect();
    expect(listener).toHaveBeenCalledTimes(2);

    // Disconnecting mid-preview (e.g. abrupt popup close) always emits a null clear.
    const secondPort = createFakePort(THEME_PREVIEW_PORT);
    secondPort.send(themePreviewMessage(DEFAULT_THEME_DOCUMENT));
    expect(listener).toHaveBeenCalledTimes(3);
    secondPort.disconnect();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  it('names the browser it was built for', () => {
    // The unit tests run as the Chrome build.
    expect(extensionPlatform.build).toBe('Chrome extension');
    expect(buildName('firefox')).toBe('Firefox extension');
    expect(buildName('safari')).toBe('Safari extension');
  });

  it('sends the last of the badges set close together to the background script', async () => {
    vi.useFakeTimers();
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);

    extensionPlatform.setBadge({ count: 1, failed: false });
    extensionPlatform.setBadge({ count: 2, failed: false });
    extensionPlatform.setBadge({ count: 3, failed: false });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);

    expect(send).toHaveBeenCalledExactlyOnceWith(badgeMessage({ count: 3, failed: false }));

    extensionPlatform.setBadge({ count: 0, failed: true });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenLastCalledWith(badgeMessage({ count: 0, failed: true }));

    // Count-only updates with identical `failed` and `paused` skip redundant IPC wakeups.
    extensionPlatform.setBadge({ count: 9, failed: true });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);

    // Toggling `paused` sends a fresh update.
    extensionPlatform.setBadge({ count: 9, failed: true, paused: true });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith(badgeMessage({ count: 9, failed: true, paused: true }));
  });

  it('sends the badge again when the page comes back from the back and forward cache', async () => {
    vi.useFakeTimers();
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
    extensionPlatform.setBadge({ count: 4, failed: false });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);

    dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(send).toHaveBeenCalledTimes(1);
    dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(badgeMessage({ count: 4, failed: false }));
  });

  it('says nothing when the background script cannot be reached', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue(new Error('no receiver'));

    extensionPlatform.setBadge({ count: 1, failed: false });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);

    expect(error).not.toHaveBeenCalled();
  });

  it('says nothing when the extension was reloaded under the page', async () => {
    vi.useFakeTimers();
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(() => {
      throw new Error('Extension context invalidated.');
    });

    extensionPlatform.setBadge({ count: 1, failed: false });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);

    expect(send).toHaveBeenCalled();
  });

  it('serializes overlapping sends, drains reverts, ignores stale pre-stop completions, and retries after failure', async () => {
    vi.useFakeTimers();
    const pending: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          pending.push({ resolve, reject });
        }),
    );

    // Initial active badge (`0:0`) succeeds.
    extensionPlatform.setBadge({ count: 0, failed: false });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(1);
    pending.shift()!.resolve();
    await Promise.resolve();

    // Pause (`0:1`) starts sending, then user unpauses back to `0:0` before the first send resolves.
    extensionPlatform.setBadge({ count: 0, failed: false, paused: true });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(2);

    extensionPlatform.setBadge({ count: 0, failed: false, paused: false });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    // Must not overlap while #2 is still in flight.
    expect(send).toHaveBeenCalledTimes(2);

    // Resolving #2 immediately drains the reverted `0:0` state.
    pending.shift()!.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith(badgeMessage({ count: 0, failed: false, paused: false }));

    // Calling stopBadge() while #3 is in flight invalidates #3 so its later resolution cannot
    // clobber a fresh post-stop send.
    extensionPlatform.stopBadge?.();
    extensionPlatform.setBadge({ count: 1, failed: true });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(4);

    pending.shift()!.resolve(); // Stale #3 settles — ignored.
    await Promise.resolve();
    pending.shift()!.reject(new Error('transient worker wake error')); // #4 fails.
    await Promise.resolve();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(4);

    // Next update with the same failed state retries because #4 never succeeded.
    extensionPlatform.setBadge({ count: 2, failed: true });
    await vi.advanceTimersByTimeAsync(BADGE_DELAY_MS);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send).toHaveBeenLastCalledWith(badgeMessage({ count: 2, failed: true }));
    pending.shift()!.resolve();
  });

  it('parses FETCH_THEME_URL messages, validates replies, and handles background fetch errors', async () => {
    const sampleUrl = 'https://themes.example.com/tide.fstheme.json';
    expect(parseFetchThemeUrlMessage(fetchThemeUrlMessage(sampleUrl))).toBe(sampleUrl);
    expect(parseFetchThemeUrlMessage({ type: 'feed-sanity/fetch-theme-url', url: '' })).toBeNull();
    expect(parseFetchThemeUrlMessage({ type: 'feed-sanity/fetch-theme-url', url: 42 })).toBeNull();
    expect(parseFetchThemeUrlMessage({ type: 'other', url: sampleUrl })).toBeNull();
    expect(parseFetchThemeUrlMessage('not-an-object')).toBeNull();

    expect(isThemeUrlFetchResult({ ok: true, text: '{}', finalUrl: sampleUrl })).toBe(true);
    expect(isThemeUrlFetchResult({ ok: false, error: 'HTTP 404' })).toBe(true);
    expect(isThemeUrlFetchResult({ ok: true, text: '{}' })).toBe(false);
    expect(isThemeUrlFetchResult({ ok: false })).toBe(false);
    expect(isThemeUrlFetchResult(null)).toBe(false);

    const send = vi.spyOn(browser.runtime, 'sendMessage') as unknown as ReturnType<typeof vi.fn>;
    send.mockResolvedValueOnce({
      ok: true,
      text: '{"format":"feed-sanity-theme"}',
      finalUrl: sampleUrl,
    });
    await expect(extensionPlatform.fetchThemeUrl?.(sampleUrl)).resolves.toEqual({
      ok: true,
      text: '{"format":"feed-sanity-theme"}',
      finalUrl: sampleUrl,
    });
    expect(send).toHaveBeenLastCalledWith(fetchThemeUrlMessage(sampleUrl));

    send.mockResolvedValueOnce({ ok: false, error: 'Server returned HTTP 404.' });
    await expect(extensionPlatform.fetchThemeUrl?.(sampleUrl)).resolves.toEqual({
      ok: false,
      error: 'Server returned HTTP 404.',
    });

    send.mockResolvedValueOnce({ unexpected: true });
    await expect(extensionPlatform.fetchThemeUrl?.(sampleUrl)).resolves.toEqual({
      ok: false,
      error: 'Unexpected response while fetching theme URL.',
    });

    send.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    await expect(extensionPlatform.fetchThemeUrl?.(sampleUrl)).resolves.toEqual({
      ok: false,
      error: 'Extension background is unavailable — reload the tab and retry.',
    });
  });

  it('builds and parses NAVIGATE_OPTIONS messages cleanly', () => {
    expect(navigateOptionsMessage({ siteId: 'x', section: 'Appearance' })).toEqual({
      type: NAVIGATE_OPTIONS,
      siteId: 'x',
      section: 'Appearance',
    });
    expect(navigateOptionsMessage({})).toEqual({ type: NAVIGATE_OPTIONS });
    expect(
      parseNavigateOptionsMessage(navigateOptionsMessage({ siteId: 'x', section: 'Sites' })),
    ).toEqual({
      siteId: 'x',
      section: 'Sites',
    });
    expect(
      parseNavigateOptionsMessage({ type: NAVIGATE_OPTIONS, siteId: '', section: 42 }),
    ).toEqual({});
    expect(parseNavigateOptionsMessage({ type: 'other', siteId: 'x' })).toBeNull();
    expect(parseNavigateOptionsMessage(null)).toBeNull();
  });
});
