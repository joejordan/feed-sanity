import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BADGE_DELAY_MS, extensionPlatform } from './extension';
import { badgeMessage, OPEN_OPTIONS } from './messages';

describe('extensionPlatform', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the options when the background script says so, and ignores other messages', async () => {
    const listener = vi.fn();
    extensionPlatform.onOpenOptions(listener);

    await browser.runtime.sendMessage('something else');
    expect(listener).not.toHaveBeenCalled();

    await browser.runtime.sendMessage(OPEN_OPTIONS);
    expect(listener).toHaveBeenCalledTimes(1);
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
