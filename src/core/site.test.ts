import { describe, expect, it, vi } from 'vitest';
import type { CapablePage } from '../capabilities';
import type { DomEnvironment } from './dom-env';
import type { Badge, PopupTabState, QuickPopupRequest } from './platform';
import type { SiteAdapter } from './site';
import type { Store } from './storage';
import { defineCapabilityFeature } from '../capabilities';
import { createBridgeActiveToggle } from './bind';
import { PageBridge } from './bridge';
import { defineFeature } from './feature';
import { servePageWorld } from './page-world';
import { SITE_INSTANCE_REPLACE_EVENT, SiteRegistry, scrubCommonPii, startSite } from './site';
import { readSiteEnabledHint, writeSiteEnabledHint } from './site-hint';
import { SITES_STORAGE_KEY } from './site-settings';
import { inMemoryStore } from './testing';
import {
  applyThemePreset,
  DEFAULT_THEME_DOCUMENT,
  readEarlyThemeCss,
  THEME_DATA_KEY,
  writeEarlyThemeCss,
} from './theming';

describe('SiteRegistry, capabilities, and startSite', () => {
  it('scrubs URLs, emails, and long numbers generically', () => {
    expect(
      scrubCommonPii(
        'Failed for user@example.com at https://mail.google.com/mail/u/0/#inbox/12345678',
      ),
    ).toBe('Failed for <email> at <address>');
    expect(scrubCommonPii('id 987654321 failed')).toBe('id <number> failed');
  });

  it('activates capability features only on sites that provide all required capabilities', async () => {
    const ran: string[] = [];
    const mediaFeature = defineCapabilityFeature({
      id: 'cap_media',
      requires: ['media'] as const,
      options: {},
      setup({ caps }) {
        ran.push(typeof caps.media.onAdd);
      },
    });
    const threadFeature = defineCapabilityFeature({
      id: 'cap_threads',
      requires: ['threads'] as const,
      options: {},
      setup() {
        ran.push('threads');
      },
    });

    const site: SiteAdapter<CapablePage> = {
      id: 'demo',
      displayName: 'Demo',
      matchesHost: (host) => host === 'demo.example',
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({
        capabilities: {
          media: {
            onAdd: () => () => undefined,
            onRemove: () => () => undefined,
            around: () => undefined,
          },
        },
      }),
      features: [mediaFeature, threadFeature],
      createPanels: () => [],
    };

    const registry = new SiteRegistry().register(site);
    expect(registry.matchHost('demo.example')?.id).toBe('demo');
    expect(registry.matchHost('other.example')).toBeUndefined();

    const setBadge = vi.fn();
    const failed = await startSite(site, {
      build: 'test',
      store: inMemoryStore(),
      setBadge,
      onOpenOptions: () => () => undefined,
      installPageWorld: () => Promise.resolve(),
    });
    expect(failed).toEqual([]);
    expect(ran).toEqual(['function']);
    expect(setBadge).toHaveBeenCalled();
  });

  it('toggles any site off and back on live via v2/sites without losing Options access', async () => {
    const events: string[] = [];
    const trackedFeature = defineFeature({
      id: 'demo_feature',
      options: {
        demo_on: { section: 'General', title: 'Demo', description: 'Demo.', default: true },
      },
      enabledBy: 'demo_on',
      setup({ scope, badge }) {
        events.push('start');
        badge(2);
        scope.add(() => events.push('stop'));
      },
    });
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [trackedFeature],
      createPanels: () => [],
    };

    const store = inMemoryStore({ [SITES_STORAGE_KEY]: { facebook: false } });
    const badges: Badge[] = [];
    const openHandlers: Array<() => void> = [];

    // Starting while disabled runs zero features yet still registers the Options handler
    // and marks the toolbar icon paused.
    await startSite(site, {
      build: 'test',
      store,
      setBadge: (badge) => badges.push(badge),
      onOpenOptions: (listener) => {
        openHandlers.push(listener);
      },
      installPageWorld: () => Promise.resolve(),
    });
    expect(events).toEqual([]);
    expect(openHandlers).toHaveLength(1);
    expect(badges.at(-1)).toEqual({ count: 0, failed: false, paused: true });

    // Opening Options while disabled prepares options lazily without starting features.
    openHandlers[0]?.();
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_options')).not.toBeNull());
    expect(events).toEqual([]);
    document.querySelector('#feed_sanity_options')?.remove();

    // Enabling the site live starts its feature and updates the badge.
    await store.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(events).toEqual(['start']));
    expect(badges.at(-1)).toEqual({ count: 2, failed: false });

    // Disabling the site live disposes its feature scope and marks the toolbar icon paused.
    await store.set(SITES_STORAGE_KEY, { facebook: false });
    await vi.waitFor(() => expect(events).toEqual(['start', 'stop']));
    expect(badges.at(-1)).toEqual({ count: 0, failed: false, paused: true });

    // Re-enabling the site live restarts features cleanly on the same runtime.
    await store.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(events).toEqual(['start', 'stop', 'start']));
    expect(badges.at(-1)).toEqual({ count: 2, failed: false });
  });

  it('clears the paused toolbar state on enable/re-enable even when features report zero hidden items', async () => {
    const quietFeature = defineFeature({
      id: 'quiet_feature',
      options: {},
      setup() {
        // Intentionally reports no badge count changes (count remains 0, failed remains false).
      },
    });
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [quietFeature],
      createPanels: () => [],
    };

    const store = inMemoryStore({ [SITES_STORAGE_KEY]: { facebook: false } });
    const badges: Badge[] = [];

    await startSite(site, {
      build: 'test',
      store,
      setBadge: (badge) => badges.push(badge),
      onOpenOptions: () => () => undefined,
      installPageWorld: () => Promise.resolve(),
    });
    expect(badges.at(-1)).toEqual({ count: 0, failed: false, paused: true });

    await store.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(badges.at(-1)).toEqual({ count: 0, failed: false }));

    await store.set(SITES_STORAGE_KEY, { facebook: false });
    await vi.waitFor(() =>
      expect(badges.at(-1)).toEqual({ count: 0, failed: false, paused: true }),
    );

    await store.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(badges.at(-1)).toEqual({ count: 0, failed: false }));
  });

  it('batches startup reads via getMany, shares one DomEnvironment, and clears stale account-scoped early-theme cache when disabled', async () => {
    writeEarlyThemeCss('v2/facebook/u1', 'body { background: #111; }');
    writeEarlyThemeCss('v2/facebook/u2', 'body { background: #222; }');
    const backing = inMemoryStore({ [SITES_STORAGE_KEY]: { facebook: false } });
    const getSpy = vi.spyOn(backing, 'get');
    const getManySpy = vi.fn(async (keys: readonly string[]) =>
      Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await backing.get(k)]))),
    );
    const batchedStore: Store = {
      get: (key) => backing.get(key),
      getMany: getManySpy,
      set: (key, value) => backing.set(key, value),
      onChange: (key, listener) => backing.onChange(key, listener),
    };

    const receivedEnvs: Array<DomEnvironment | undefined> = [];
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      themeMapping: { rootSelectors: [':root'], colorVars: { '--bg': (p) => p.background } },
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: (_data, _install, env) => {
        receivedEnvs.push(env);
        return () => ({});
      },
      features: [],
      createPanels: () => [],
    };

    await startSite(site, {
      build: 'test',
      store: batchedStore,
      setBadge: () => undefined,
      onOpenOptions: () => () => undefined,
      installPageWorld: () => Promise.resolve(),
    });

    // Batched preload ran once; disabled site cleared only this account's early-theme cache and style.
    expect(getManySpy).toHaveBeenCalledTimes(1);
    expect(readEarlyThemeCss('v2/facebook/u1')).toBe('');
    expect(readEarlyThemeCss('v2/facebook/u2')).toBe('body { background: #222; }');
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

    // Updating options while disabled and then enabling reads live storage (not stale T=0 preload)
    // and receives a single shared DomEnvironment.
    getSpy.mockClear();
    await backing.set('v2/facebook/u1/options', { demo: true });
    await backing.set(SITES_STORAGE_KEY, { facebook: true });
    await vi.waitFor(() => expect(receivedEnvs).toHaveLength(1));
    expect(receivedEnvs[0]).toBeDefined();
    expect(getSpy).toHaveBeenCalledWith('v2/facebook/u1/options');
  });

  it('defers createPanels until the user opens the Options dialog and caches them across reopens', async () => {
    const createPanels = vi.fn(() => []);
    const openHandlers: Array<() => void> = [];
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      themeMapping: { rootSelectors: [':root'], colorVars: { '--bg': (p) => p.background } },
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [],
      createPanels,
    };

    await startSite(site, {
      build: 'test',
      store: inMemoryStore(),
      setBadge: () => undefined,
      onOpenOptions: (listener) => {
        openHandlers.push(listener);
      },
      installPageWorld: () => Promise.resolve(),
    });

    // Startup runs cleanly without constructing any Settings panel UI or subscriptions.
    expect(createPanels).not.toHaveBeenCalled();

    // First Options open constructs panels once; reopening reuses them.
    openHandlers[0]?.();
    await vi.waitFor(() => expect(createPanels).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_options')).not.toBeNull());
    openHandlers[0]?.();
    expect(createPanels).toHaveBeenCalledTimes(1);
    document
      .querySelector('#feed_sanity_options')
      ?.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
      ?.click();
  });

  it('wires popup state, live theme previews (gated by site enablement), and Userscript quick popup library', async () => {
    const mochaDoc = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'catppuccin-mocha');
    const warmDoc = applyThemePreset(DEFAULT_THEME_DOCUMENT, 'warm-paper');
    const store = inMemoryStore({
      [`v2/facebook/u1/${THEME_DATA_KEY}`]: mochaDoc,
    });

    let getPopupState: (() => Promise<PopupTabState>) | undefined;
    let sendThemePreview: ((doc: typeof DEFAULT_THEME_DOCUMENT | null) => void) | undefined;
    let getQuickPopupReq: (() => Promise<QuickPopupRequest>) | undefined;

    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      themeMapping: { rootSelectors: [':root'], colorVars: { '--bg': (p) => p.background } },
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [],
      createPanels: () => [],
    };

    await startSite(site, {
      build: 'test',
      store,
      setBadge: () => undefined,
      onOpenOptions: () => () => undefined,
      onPopupStateRequest: (handler) => {
        getPopupState = handler;
      },
      onThemePreview: (listener) => {
        sendThemePreview = listener;
      },
      registerQuickPopup: (getReq) => {
        getQuickPopupReq = getReq;
      },
      installPageWorld: () => Promise.resolve(),
    });

    await vi.waitFor(() =>
      expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#1e1e2e'),
    );

    const popupState = await getPopupState?.();
    expect(popupState).toEqual({
      siteId: 'facebook',
      displayName: 'Facebook',
      storagePrefix: 'v2/facebook/u1',
      enabled: true,
      hiddenCount: 0,
    });

    // Live theme preview applies Warm Paper, previews Site Default cleanly, and restores Mocha on null.
    sendThemePreview?.(warmDoc);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');

    sendThemePreview?.(DEFAULT_THEME_DOCUMENT);
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();

    sendThemePreview?.(null);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#1e1e2e');

    // Userscript quick popup receives the shared themeLibrary and working onPreviewTheme callback.
    const req = await getQuickPopupReq?.();
    expect(req?.themeLibrary).toBeDefined();
    expect(req?.onPreviewTheme).toBeTypeOf('function');
    req?.onPreviewTheme?.(warmDoc);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#f4efe6');
    req?.onPreviewTheme?.(null);
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#1e1e2e');

    // Disabling the site clears theming and ignores subsequent preview requests.
    await store.set(SITES_STORAGE_KEY, { facebook: false });
    await vi.waitFor(() => expect(document.querySelector('#feed_sanity_user_theme')).toBeNull());
    sendThemePreview?.(warmDoc);
    expect(document.querySelector('#feed_sanity_user_theme')).toBeNull();
  });

  it('cleanly tears down a prior instance and orphaned legacy DOM artifacts on live upgrade', async () => {
    const events: string[] = [];
    const trackedFeature = defineFeature({
      id: 'upgrade_feature',
      options: {},
      setup({ scope }) {
        const marker = document.createElement('span');
        marker.setAttribute('data-feed-sanity', '');
        marker.className = 'upgrade-marker';
        document.body.append(marker);
        events.push('start');
        scope.add(() => {
          marker.remove();
          events.push('stop');
        });
      },
    });
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [trackedFeature],
      createPanels: () => [],
    };

    // Simulate legacy pre-teardown artifacts sitting in the DOM before the first boot.
    const legacyUi = document.createElement('div');
    legacyUi.setAttribute('data-feed-sanity', '');
    legacyUi.id = 'legacy_ui';
    const post = document.createElement('article');
    post.setAttribute('fs_post', '1');
    post.setAttribute('fs_id', '999');
    document.body.append(legacyUi, post);

    const store = inMemoryStore();
    const unsubOptions = vi.fn();
    const unsubPopup = vi.fn();
    const unsubPreview = vi.fn();
    const stopBadge = vi.fn();

    await startSite(site, {
      build: 'test',
      store,
      setBadge: () => undefined,
      stopBadge,
      onOpenOptions: () => unsubOptions,
      onPopupStateRequest: () => unsubPopup,
      onThemePreview: () => unsubPreview,
      installPageWorld: () => Promise.resolve(),
    });

    expect(document.querySelector('#legacy_ui')).toBeNull();
    expect(post.hasAttribute('fs_post')).toBe(false);
    expect(post.hasAttribute('fs_id')).toBe(false);
    expect(document.querySelectorAll('.upgrade-marker')).toHaveLength(1);
    expect(events).toEqual(['start']);

    // Starting a second instance (simulating extension reload/upgrade in the same tab)
    // disposes the first instance cleanly so zero duplicate UI or platform listeners remain.
    await startSite(site, {
      build: 'test',
      store,
      setBadge: () => undefined,
      onOpenOptions: () => () => undefined,
      installPageWorld: () => Promise.resolve(),
    });

    expect(events).toEqual(['start', 'stop', 'start']);
    expect(unsubOptions).toHaveBeenCalledTimes(1);
    expect(unsubPopup).toHaveBeenCalledTimes(1);
    expect(unsubPreview).toHaveBeenCalledTimes(1);
    expect(stopBadge).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.upgrade-marker')).toHaveLength(1);
    post.remove();
  });

  it('ignores spoofed replace events from host page JS while runtime is alive, and disposes once invalidated', async () => {
    const events: string[] = [];
    const trackedFeature = defineFeature({
      id: 'spoof_guard_feature',
      options: {},
      setup({ scope }) {
        events.push('start');
        scope.add(() => events.push('stop'));
      },
    });
    const site: SiteAdapter<Record<string, never>> = {
      id: 'facebook',
      displayName: 'Facebook',
      matchesHost: () => true,
      themeCss: '',
      accountId: () => 'u1',
      scrubPii: scrubCommonPii,
      createPage: () => () => ({}),
      features: [trackedFeature],
      createPanels: () => [],
    };

    let invalidated = false;
    await startSite(site, {
      build: 'test',
      store: inMemoryStore(),
      setBadge: () => undefined,
      onOpenOptions: () => () => undefined,
      isContextInvalidated: () => Promise.resolve(invalidated),
      installPageWorld: () => Promise.resolve(),
    });
    expect(events).toEqual(['start']);

    // Host page JS spoofing SITE_INSTANCE_REPLACE_EVENT while runtime is alive is ignored.
    document.dispatchEvent(new CustomEvent(SITE_INSTANCE_REPLACE_EVENT, { detail: 'spoofed' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['start']);

    // Once the extension runtime is invalidated (reloaded/unloaded), replacement disposes cleanly.
    invalidated = true;
    document.dispatchEvent(new CustomEvent(SITE_INSTANCE_REPLACE_EVENT, { detail: 'new-ext' }));
    await vi.waitFor(() => expect(events).toEqual(['start', 'stop']));
  });

  it('disarms a stale MAIN-world hint with keepRemoteAlive and still activates live when re-enabled without reload', async () => {
    const toggleCalls: boolean[] = [];
    const server = servePageWorld({}, { 'reddit-active': (enabled) => toggleCalls.push(enabled) });
    writeSiteEnabledHint('reddit', true);

    try {
      const store = inMemoryStore({ [SITES_STORAGE_KEY]: { reddit: false } });
      const site: SiteAdapter<Record<string, never>> = {
        id: 'reddit',
        displayName: 'Reddit',
        pageWorldActiveToggle: 'reddit-active',
        matchesHost: () => true,
        themeCss: '',
        accountId: () => 'u1',
        scrubPii: scrubCommonPii,
        createPage: (_data, installPageWorld, env) => {
          const bridge = new PageBridge(installPageWorld, { reconnectOnReady: true });
          env?.scope.add(() => bridge.dispose());
          const activeToggle = createBridgeActiveToggle(
            bridge,
            'reddit-active',
            readSiteEnabledHint('reddit', false),
          );
          const factory = () => ({});
          return Object.assign(factory, {
            setActive(active: boolean) {
              activeToggle.setPinned(active);
              if (active) {
                void activeToggle.activate();
              } else {
                void activeToggle.deactivate();
              }
            },
          });
        },
        features: [],
        createPanels: () => [],
      };

      await startSite(site, {
        build: 'test',
        store,
        setBadge: () => undefined,
        onOpenOptions: () => () => undefined,
        installPageWorld: () => Promise.resolve(),
      });

      // Stale hint was disarmed without killing servePageWorld.
      await vi.waitFor(() => expect(toggleCalls).toEqual([false]));

      // Re-enabling live connects to the still-alive MAIN-world server and activates the toggle.
      await store.set(SITES_STORAGE_KEY, { reddit: true });
      await vi.waitFor(() => expect(toggleCalls).toEqual([false, true]));

      // Pausing live deactivates again; re-enabling activates once more.
      await store.set(SITES_STORAGE_KEY, { reddit: false });
      await vi.waitFor(() => expect(toggleCalls).toEqual([false, true, false]));
      await store.set(SITES_STORAGE_KEY, { reddit: true });
      await vi.waitFor(() => expect(toggleCalls).toEqual([false, true, false, true]));
    } finally {
      server.dispose();
    }
  });
});
