import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_THEME_DOCUMENT, findThemePreset, presetToThemeDocument } from '../core/theming';
import { BADGE_DELAY_MS, extensionPlatform } from './extension';
import {
  badgeMessage,
  GET_POPUP_STATE,
  OPEN_OPTIONS,
  openOptionsMessage,
  THEME_PREVIEW_PORT,
  themePreviewMessage,
} from './messages';

describe('extensionPlatform', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
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
});
