import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extensionPlatform } from './extension';
import { OPEN_OPTIONS } from './messages';

describe('extensionPlatform', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('opens the options when the background script says so, and ignores other messages', async () => {
    const listener = vi.fn();
    extensionPlatform.onOpenOptions(listener);

    await browser.runtime.sendMessage('something else');
    expect(listener).not.toHaveBeenCalled();

    await browser.runtime.sendMessage(OPEN_OPTIONS);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
