import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { SafariScripting } from './safari-page-world';
import { OPEN_OPTIONS, requestPageWorldMessage } from './messages';
import {
  ensureSafariPageWorldScripts,
  requestSafariPageWorld,
  SAFARI_PAGE_WORLD_SITES,
  safariPageWorldListener,
} from './safari-page-world';

function fakeScripting(existingIds: readonly string[] = []): SafariScripting {
  return {
    getRegisteredContentScripts: vi.fn(async () => existingIds.map((id) => ({ id }))),
    registerContentScripts: vi.fn(async () => undefined),
    updateContentScripts: vi.fn(async () => undefined),
    unregisterContentScripts: vi.fn(async () => undefined),
    executeScript: vi.fn(async () => []),
  };
}

describe('ensureSafariPageWorldScripts', () => {
  it('registers all four site MAIN-world scripts at document_start when none exist', async () => {
    const scripting = fakeScripting();

    await ensureSafariPageWorldScripts(scripting);

    expect(scripting.updateContentScripts).not.toHaveBeenCalled();
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    const registered = vi.mocked(scripting.registerContentScripts).mock.calls[0]?.[0];
    expect(registered).toHaveLength(4);
    for (const entry of registered ?? []) {
      expect(entry.runAt).toBe('document_start');
      expect(entry.world).toBe('MAIN');
      expect(entry.persistAcrossSessions).toBe(true);
    }
    expect(registered?.map((entry) => entry.js[0])).toEqual([
      '/safari-facebook-page-world.js',
      '/safari-x-page-world.js',
      '/safari-instagram-page-world.js',
      '/safari-reddit-page-world.js',
    ]);
  });

  it('updates existing registrations and registers only missing ones', async () => {
    const scripting = fakeScripting([
      'feed-sanity-facebook-page-world',
      'feed-sanity-x-page-world',
    ]);

    await ensureSafariPageWorldScripts(scripting);

    const updated = vi.mocked(scripting.updateContentScripts).mock.calls[0]?.[0];
    const registered = vi.mocked(scripting.registerContentScripts).mock.calls[0]?.[0];
    expect(updated?.map((entry) => entry.id)).toEqual([
      'feed-sanity-facebook-page-world',
      'feed-sanity-x-page-world',
    ]);
    expect(registered?.map((entry) => entry.id)).toEqual([
      'feed-sanity-instagram-page-world',
      'feed-sanity-reddit-page-world',
    ]);
  });

  it('coalesces concurrent calls into a single registration pass', async () => {
    const scripting = fakeScripting();

    await Promise.all([
      ensureSafariPageWorldScripts(scripting),
      ensureSafariPageWorldScripts(scripting),
      ensureSafariPageWorldScripts(scripting),
    ]);

    expect(scripting.getRegisteredContentScripts).toHaveBeenCalledTimes(1);
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
  });

  it('recovers from registration conflicts by unregistering and re-registering all scripts', async () => {
    const scripting = fakeScripting();
    vi.mocked(scripting.registerContentScripts)
      .mockRejectedValueOnce(new Error('Duplicate script ID'))
      .mockResolvedValueOnce(undefined);

    await ensureSafariPageWorldScripts(scripting);

    expect(scripting.unregisterContentScripts).toHaveBeenCalledExactlyOnceWith({
      ids: SAFARI_PAGE_WORLD_SITES.map((spec) => spec.id),
    });
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(2);
  });
});

describe('safariPageWorldListener', () => {
  it('injects the matching site script into the sending tab and frame in MAIN world', async () => {
    const scripting = fakeScripting();
    const listener = safariPageWorldListener(scripting);
    const sendResponse = vi.fn();

    const keptOpen = listener(
      requestPageWorldMessage('x'),
      { tab: { id: 7 }, frameId: 0 },
      sendResponse,
    );

    expect(keptOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    expect(scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 7, frameIds: [0] },
      files: ['/safari-x-page-world.js'],
      world: 'MAIN',
    });
  });

  it('omits frameIds when sender has no frameId', async () => {
    const scripting = fakeScripting();
    const listener = safariPageWorldListener(scripting);
    const sendResponse = vi.fn();

    listener(requestPageWorldMessage('reddit'), { tab: { id: 12 } }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
    expect(scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 12 },
      files: ['/safari-reddit-page-world.js'],
      world: 'MAIN',
    });
  });

  it('rejects unknown site IDs without calling executeScript', () => {
    const scripting = fakeScripting();
    const listener = safariPageWorldListener(scripting);
    const sendResponse = vi.fn();

    expect(listener(requestPageWorldMessage('gmail'), { tab: { id: 3 } }, sendResponse)).toBe(true);
    expect(scripting.executeScript).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: 'no Safari page-world script for site "gmail"',
    });
  });

  it('reports both async rejections and synchronous executeScript throws', async () => {
    const scripting = fakeScripting();
    vi.mocked(scripting.executeScript).mockRejectedValueOnce(new Error('permission denied'));
    const listener = safariPageWorldListener(scripting);
    const sendResponse = vi.fn();

    listener(requestPageWorldMessage('instagram'), { tab: { id: 9 } }, sendResponse);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'permission denied' }),
    );

    vi.mocked(scripting.executeScript).mockImplementationOnce(() => {
      throw new Error('invalid target');
    });
    sendResponse.mockClear();

    listener(requestPageWorldMessage('facebook'), { tab: { id: 9 } }, sendResponse);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'invalid target' }),
    );
  });

  it('ignores unrelated messages and messages from outside a tab', () => {
    const scripting = fakeScripting();
    const listener = safariPageWorldListener(scripting);
    const sendResponse = vi.fn();

    expect(listener(OPEN_OPTIONS, { tab: { id: 7 } }, sendResponse)).toBeUndefined();
    expect(listener(requestPageWorldMessage('x'), {}, sendResponse)).toBeUndefined();
    expect(scripting.executeScript).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('requestSafariPageWorld', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('resolves immediately without messaging for sites with no page-world script', async () => {
    const send = vi.fn();
    await expect(requestSafariPageWorld('gmail', send)).resolves.toBeUndefined();
    await expect(requestSafariPageWorld(undefined, send)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves on ok reply and rejects on failure or missing reply', async () => {
    await expect(
      requestSafariPageWorld('facebook', async () => ({ ok: true })),
    ).resolves.toBeUndefined();
    await expect(
      requestSafariPageWorld('x', async () => ({ ok: false, error: 'tab closed' })),
    ).rejects.toThrow('tab closed');
    await expect(requestSafariPageWorld('reddit', async () => undefined)).rejects.toThrow(
      'did not install',
    );
  });

  it('works end-to-end with safariPageWorldListener over runtime messaging', async () => {
    const scripting = fakeScripting();
    browser.runtime.onMessage.addListener((message, sender, sendResponse) =>
      safariPageWorldListener(scripting)(
        message,
        { ...sender, tab: { id: 42 }, frameId: 0 },
        sendResponse,
      ),
    );

    await requestSafariPageWorld('instagram');

    expect(scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
      target: { tabId: 42, frameIds: [0] },
      files: ['/safari-instagram-page-world.js'],
      world: 'MAIN',
    });
  });
});
