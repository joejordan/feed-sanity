import { describe, expect, it, vi } from 'vitest';
import type { AutoAttachApi, AutoAttachTab } from './auto-attach';
import {
  ATTACH_TAB,
  ATTACHABLE_SITES,
  attachExistingTabs,
  attachTab,
  attachTabListener,
  attachTabMessage,
  isAttachTabMessage,
  isAttachTabReply,
  matchAttachableSite,
} from './auto-attach';
import { GET_POPUP_STATE, OPEN_OPTIONS } from './messages';

function makeApi(
  tabs: AutoAttachTab[],
  options: {
    attachedTabIds?: ReadonlySet<number>;
    queryThrowsOnUrlFilter?: boolean;
    failExecuteOnTabId?: number;
    failMainWorldOnTabId?: number;
  } = {},
): AutoAttachApi {
  return {
    tabs: {
      query: vi.fn(async (queryInfo) => {
        if (options.queryThrowsOnUrlFilter && queryInfo.url !== undefined) {
          throw new Error('unsupported url array');
        }
        return tabs;
      }),
      get: vi.fn(async (tabId) => {
        const found = tabs.find((tab) => tab.id === tabId);
        if (!found) {
          throw new Error(`No tab with id ${tabId}`);
        }
        return found;
      }),
      sendMessage: vi.fn(async (tabId, message) => {
        if (message === GET_POPUP_STATE && options.attachedTabIds?.has(tabId)) {
          return {
            siteId: 'facebook',
            displayName: 'Facebook',
            storagePrefix: 'v2/facebook/1',
            enabled: true,
            hiddenCount: 0,
          };
        }
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }),
    },
    scripting: {
      executeScript: vi.fn(async (details) => {
        if (details.world === 'MAIN' && details.target.tabId === options.failMainWorldOnTabId) {
          throw new Error('main world blocked');
        }
        if (details.target.tabId === options.failExecuteOnTabId) {
          throw new Error('permission denied');
        }
        return [];
      }),
    },
  };
}

describe('matchAttachableSite', () => {
  it('matches all five supported sites and rejects unsupported or excluded URLs', () => {
    expect(matchAttachableSite('https://www.facebook.com/')?.siteId).toBe('facebook');
    expect(matchAttachableSite('https://x.com/home')?.siteId).toBe('x');
    expect(matchAttachableSite('https://twitter.com/home')?.siteId).toBe('x');
    expect(matchAttachableSite('https://www.instagram.com/')?.siteId).toBe('instagram');
    expect(matchAttachableSite('https://www.reddit.com/r/typescript')?.siteId).toBe('reddit');
    expect(matchAttachableSite('https://mail.google.com/mail/u/0/#inbox')?.siteId).toBe('gmail');

    expect(matchAttachableSite('https://example.com/')).toBeUndefined();
    expect(matchAttachableSite(undefined)).toBeUndefined();
    expect(matchAttachableSite('https://static.xx.facebook.com/rsrc.php')).toBeUndefined();
    expect(matchAttachableSite('https://www.facebook.com/saved/')).toBeUndefined();
    expect(matchAttachableSite('https://x.com/i/flow/login')).toBeUndefined();
    expect(matchAttachableSite('https://www.instagram.com/accounts/login/')).toBeUndefined();
    expect(matchAttachableSite('https://www.reddit.com/login')).toBeUndefined();
    expect(matchAttachableSite('https://mail.google.com/sync/u/0/i/s')).toBeUndefined();
  });

  it('uses content-scripts page-world paths on Chrome/Firefox and omits pageWorldScript on Gmail', () => {
    const fb = ATTACHABLE_SITES.find((site) => site.siteId === 'facebook');
    const gmail = ATTACHABLE_SITES.find((site) => site.siteId === 'gmail');
    expect(fb?.contentScript).toBe('/content-scripts/facebook.js');
    expect(fb?.pageWorldScript).toBe('/content-scripts/facebook-page-world.js');
    expect(gmail?.contentScript).toBe('/content-scripts/gmail.js');
    expect(gmail?.pageWorldScript).toBeUndefined();
  });
});

describe('attachExistingTabs and attachTab', () => {
  it('skips already-attached current tabs, injects missing/orphaned tabs, and handles Gmail without MAIN world', async () => {
    const api = makeApi(
      [
        { id: 1, url: 'https://www.facebook.com/' }, // already live -> skip
        { id: 2, url: 'https://x.com/home' }, // needs attach -> isolated then MAIN
        { id: 3, url: 'https://mail.google.com/mail/u/0/#inbox' }, // isolated only
        { id: 4, url: 'https://static.xx.facebook.com/rsrc.php' }, // excluded
        { id: 5, url: 'https://www.reddit.com/', discarded: true }, // discarded -> skip
        { id: 6, url: 'https://example.com/' }, // unsupported -> skip
        { id: 7, url: 'https://www.facebook.com/', status: 'loading' }, // loading -> skip
      ],
      { attachedTabIds: new Set([1]) },
    );

    const attachedCount = await attachExistingTabs(api);
    expect(attachedCount).toBe(2);

    const calls = vi.mocked(api.scripting.executeScript).mock.calls.map(([arg]) => arg);
    expect(calls).toHaveLength(3);
    expect(calls.filter((call) => call.target.tabId === 2)).toEqual([
      {
        target: { tabId: 2 },
        files: ['/content-scripts/x.js'],
      },
      {
        target: { tabId: 2 },
        files: ['/content-scripts/x-page-world.js'],
        world: 'MAIN',
      },
    ]);
    expect(calls.filter((call) => call.target.tabId === 3)).toEqual([
      {
        target: { tabId: 3 },
        files: ['/content-scripts/gmail.js'],
      },
    ]);
  });

  it('does not destructively re-inject a live throttled tab whose probe times out', async () => {
    vi.useFakeTimers();
    try {
      const api = makeApi([{ id: 15, url: 'https://www.facebook.com/' }]);
      vi.mocked(api.tabs.sendMessage).mockImplementation(() => new Promise(() => undefined));

      const pending = attachExistingTabs(api);
      await vi.advanceTimersByTimeAsync(1500);
      const count = await pending;

      expect(count).toBe(0);
      expect(api.scripting.executeScript).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to tabs.query({}) when pattern-list filtering throws', async () => {
    const api = makeApi([{ id: 10, url: 'https://www.instagram.com/' }], {
      queryThrowsOnUrlFilter: true,
    });

    const count = await attachExistingTabs(api);
    expect(count).toBe(1);
    expect(api.tabs.query).toHaveBeenCalledTimes(2);
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 10 },
      files: ['/content-scripts/instagram.js'],
    });
  });

  it('isolates per-tab failures and still injects isolated script if MAIN-world fails', async () => {
    const api = makeApi(
      [
        { id: 1, url: 'https://www.facebook.com/' },
        { id: 2, url: 'https://x.com/home' },
      ],
      { failExecuteOnTabId: 1, failMainWorldOnTabId: 2 },
    );

    const count = await attachExistingTabs(api);
    expect(count).toBe(1);
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: ['/content-scripts/x.js'],
    });
  });

  it('coalesces concurrent attachExistingTabs and attachTab calls without double-injecting', async () => {
    const api = makeApi([{ id: 7, url: 'https://www.facebook.com/' }]);

    const [a, b, c] = await Promise.all([
      attachExistingTabs(api),
      attachExistingTabs(api),
      attachTab(api, { id: 7, url: 'https://www.facebook.com/' }),
    ]);

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(true);
    expect(api.tabs.query).toHaveBeenCalledTimes(1);
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(2);
  });
});

describe('attachTabListener and message guards', () => {
  it('validates ATTACH_TAB messages and replies', () => {
    expect(isAttachTabMessage(attachTabMessage(5))).toBe(true);
    expect(isAttachTabMessage({ type: ATTACH_TAB, tabId: -1 })).toBe(false);
    expect(isAttachTabMessage({ type: ATTACH_TAB, tabId: '5' })).toBe(false);
    expect(isAttachTabMessage(OPEN_OPTIONS)).toBe(false);
    expect(isAttachTabReply({ attached: true })).toBe(true);
    expect(isAttachTabReply({ attached: 'yes' })).toBe(false);
  });

  it('attaches the requested tab for trusted popup callers and rejects content scripts', async () => {
    const api = makeApi([{ id: 42, url: 'https://www.facebook.com/' }]);
    const ownOrigin = 'chrome-extension://test-ext-id/';
    const listener = attachTabListener(api, { ownOrigin });
    const sendResponse = vi.fn();

    expect(listener(OPEN_OPTIONS, { url: `${ownOrigin}popup.html` }, sendResponse)).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();

    // Reject untrusted web content-script senders.
    expect(
      listener(
        attachTabMessage(42),
        { tab: { id: 1 }, url: 'https://www.facebook.com/' },
        sendResponse,
      ),
    ).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();

    // Accept trusted extension popup (including when opened in a tab).
    const keptOpen = listener(
      attachTabMessage(42),
      { tab: { id: 99 }, url: `${ownOrigin}popup.html` },
      sendResponse,
    );
    expect(keptOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ attached: true }));
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['/content-scripts/facebook.js'],
    });
  });
});
