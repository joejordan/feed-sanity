import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FeatureRunner } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import {
  createStopFeedRefreshToggle,
  RETURN_TO_FEED_MODULE,
  STALENESS_MODULE,
  STOP_FEED_REFRESH,
} from '../../facebook/page-toggles';
import { testBridge, videoPage } from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import stopFeedRefresh from '.';

const KEY = 'u/options';

function startFeature(
  options: Options,
  bridge = testBridge({}, undefined, {}),
): FeatureRunner<ReturnType<ReturnType<typeof bindPage>>> {
  const runner = new FeatureRunner(
    [stopFeedRefresh],
    options,
    bindPage(videoPage(bridge)),
    new SavedData(extensionStore, 'u'),
  );
  return runner;
}

describe('stop_feed_refresh feature', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('is on by default, patches Facebook refresh modules, and restores them when turned off', async () => {
    const staleness = {
      FEED_STALE_TIMEOUT: 600_000,
      FEED_VISIBILITY_TIMEOUT: 120_000,
      FEED_STALE_PUSH_VIEW_TIMEOUT: 1_800_000,
    };
    const rtf = { isRouteEligible: (route: string) => route === 'comet.group' };
    const modules: Record<string, unknown> = {
      [STALENESS_MODULE]: staleness,
      [RETURN_TO_FEED_MODULE]: rtf,
    };
    const toggle = createStopFeedRefreshToggle({
      requireLazy: (deps: readonly string[], cb: (...loaded: unknown[]) => void) => {
        const [name] = deps;
        if (name && name in modules) {
          cb(modules[name]);
        }
      },
    });
    const bridge = testBridge({}, undefined, { [STOP_FEED_REFRESH]: toggle });
    const options = new Options(extensionStore, KEY);
    const runner = startFeature(options, bridge);

    await runner.start();

    await vi.waitFor(() => {
      expect(staleness.FEED_STALE_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
      expect(staleness.FEED_VISIBILITY_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
      expect(staleness.FEED_STALE_PUSH_VIEW_TIMEOUT).toBeNull();
      expect(rtf.isRouteEligible('comet.group')).toBe(false);
    });
    expect(runner.statuses()).toEqual([
      { id: 'stop_feed_refresh', state: 'running', errors: 0, lastError: null },
    ]);

    // Turning the option off disposes the feature scope and restores originals with no reload.
    await options.set('stop_feed_refresh', false);
    await vi.waitFor(() => {
      expect(staleness.FEED_STALE_TIMEOUT).toBe(600_000);
      expect(staleness.FEED_VISIBILITY_TIMEOUT).toBe(120_000);
      expect(staleness.FEED_STALE_PUSH_VIEW_TIMEOUT).toBe(1_800_000);
      expect(rtf.isRouteEligible('comet.group')).toBe(true);
    });
    expect(runner.statuses()).toEqual([
      { id: 'stop_feed_refresh', state: 'off', errors: 0, lastError: null },
    ]);

    // Turning it back on re-applies.
    await options.set('stop_feed_refresh', true);
    await vi.waitFor(() => {
      expect(staleness.FEED_VISIBILITY_TIMEOUT).toBe(Number.POSITIVE_INFINITY);
      expect(rtf.isRouteEligible('comet.group')).toBe(false);
    });
  });

  it('does not start the bridge when the option starts off', async () => {
    await extensionStore.set(KEY, { stop_feed_refresh: false });
    const bridge = testBridge({}, undefined, { [STOP_FEED_REFRESH]: vi.fn() });
    const runner = startFeature(new Options(extensionStore, KEY), bridge);

    await runner.start();

    expect(bridge.status().state).toBe('not started');
    expect(runner.statuses()).toEqual([
      { id: 'stop_feed_refresh', state: 'off', errors: 0, lastError: null },
    ]);
  });

  it('stays healthy with zero feature errors when the page-world bridge is unavailable', async () => {
    const bridge = testBridge();
    const runner = startFeature(new Options(extensionStore, KEY), bridge);

    await runner.start();
    await vi.waitFor(() => expect(bridge.status().state).toBe('unavailable'));

    expect(runner.statuses()).toEqual([
      { id: 'stop_feed_refresh', state: 'running', errors: 0, lastError: null },
    ]);
  });
});
