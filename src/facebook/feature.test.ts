import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Locate } from '../core/locator';
import type { FacebookPage } from './feature';
import type { Post } from './posts';
import { FeatureRunner } from '../core/app';
import { PageBridge } from '../core/bridge';
import { Listeners } from '../core/listeners';
import { Locators, readLocatorOverrides } from '../core/locator';
import { createLogger } from '../core/log';
import { Options } from '../core/options';
import { PageWatcher } from '../core/page-watcher';
import { SavedData } from '../core/saved';
import { sleep } from '../core/timing';
import { extensionStore } from '../platform/extension-store';
import { bindPage, createPage, defineFeature, LOCATOR_OVERRIDES } from './feature';
import { POST_HEADER } from './selectors';
import { fakeAtoms, fakeLocate, installReaders, testBridge } from './testing';
import { Videos } from './videos';

describe('bindPage', () => {
  const log = createLogger('test');
  let added: Listeners<[Post]>;
  let atomsChanged: Listeners;
  let watcher: PageWatcher;
  let options: Options;

  beforeEach(() => {
    fakeBrowser.reset();
    document.body.innerHTML = '';
    added = new Listeners(log);
    atomsChanged = new Listeners(log);
    watcher = new PageWatcher();
    options = new Options(extensionStore, 'u/options');
  });

  const page = (locate: Locate = fakeLocate, bridge = testBridge()) =>
    bindPage({
      atoms: { ...fakeAtoms, onChange: (listener) => atomsChanged.add(listener) },
      locate,
      posts: {
        onTrack: () => () => undefined,
        onUntrack: () => () => undefined,
        onAdd: (listener) => added.add(listener),
        onRemove: () => () => undefined,
        onReset: () => () => undefined,
        onUpdate: () => () => undefined,
      },
      videos: new Videos(locate, (selector, handlers, watchOptions) =>
        watcher.watch(selector, handlers, watchOptions),
      ),
      bridge,
      watch: (selector, handlers, watchOptions) => watcher.watch(selector, handlers, watchOptions),
    });

  it('ends what a feature watches on the page when the feature is switched off', async () => {
    const video = vi.fn();
    const feature = defineFeature({
      id: 'videos',
      options: {
        videos_enabled: { section: 'General', title: 'Videos', description: '', default: true },
      },
      enabledBy: 'videos_enabled',
      setup: (ctx) => {
        ctx.page.posts.onAdd(() => undefined);
        ctx.page.atoms.onChange(() => undefined);
        ctx.page.watch('video', { added: video, removed: video });
      },
    });
    await new FeatureRunner([feature], options, page(), new SavedData(extensionStore, 'u')).start();
    expect([added.size, atomsChanged.size]).toEqual([1, 1]);
    const first = document.createElement('video');
    document.body.append(first);
    await vi.waitFor(() => expect(video).toHaveBeenCalledExactlyOnceWith(first));

    await options.set('videos_enabled', false);
    document.body.append(document.createElement('video'));
    first.remove();
    await sleep(20);

    expect([added.size, atomsChanged.size]).toEqual([0, 0]);
    expect(video).toHaveBeenCalledTimes(1);
  });

  it('counts an error thrown by a watch handler against the feature', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    document.body.innerHTML = '<video></video>';
    const feature = defineFeature({
      id: 'broken_videos',
      setup: (ctx) => {
        ctx.page.watch('video', {
          added: () => {
            throw new Error('no controls');
          },
        });
      },
    });
    const runner = new FeatureRunner(
      [feature],
      options,
      page(),
      new SavedData(extensionStore, 'u'),
    );

    await runner.start();

    expect(runner.statuses()[0]).toMatchObject({ errors: 1, lastError: 'no controls' });
  });

  it('ends what a feature hears from its locators when the feature is switched off', async () => {
    const changed = new Listeners(log);
    const locators = new Locators({
      resolve: (selector) => selector,
      onChange: (listener) => changed.add(listener),
    });
    const heard = vi.fn();
    const feature = defineFeature({
      id: 'videos',
      options: {
        videos_enabled: { section: 'General', title: 'Videos', description: '', default: true },
      },
      enabledBy: 'videos_enabled',
      setup: (ctx) => {
        ctx.page.locate(POST_HEADER).onChange(heard);
      },
    });
    await new FeatureRunner(
      [feature],
      options,
      page(locators.locate),
      new SavedData(extensionStore, 'u'),
    ).start();
    changed.emit();
    expect(heard).toHaveBeenCalledTimes(1);

    await options.set('videos_enabled', false);
    changed.emit();

    expect(heard).toHaveBeenCalledTimes(1);
  });
  describe('bridge', () => {
    const reader = vi.fn(() => ({ hdSrc: 'https://video.xx.fbcdn.net/v/clip.mp4', videoId: '42' }));

    const run = async (bridge: ReturnType<typeof testBridge>) => {
      let facebook: FacebookPage | undefined;
      const feature = defineFeature({
        id: 'downloads',
        options: {
          downloads_on: { section: 'General', title: 'Downloads', description: '', default: true },
        },
        enabledBy: 'downloads_on',
        setup: (ctx) => {
          facebook = ctx.page;
        },
      });
      const data = new SavedData(extensionStore, 'u');
      await new FeatureRunner([feature], options, page(fakeLocate, bridge), data).start();
      if (!facebook) {
        throw new Error('the feature did not start');
      }
      return facebook;
    };

    it("answers a feature's question with the reader's checked answer", async () => {
      const facebook = await run(testBridge({ 'video-sources': reader }));
      const video = document.createElement('video');
      document.body.append(video);

      expect(await facebook.bridge.videoSources(video)).toEqual({
        file: 'https://video.xx.fbcdn.net/v/clip.mp4',
        quality: 'hd',
        manifest: false,
        videoId: '42',
      });
      expect(reader).toHaveBeenCalledWith(video);
    });

    it('withdraws an open question and stops telling the status when the feature stops', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // A page-world side that never answers.
      const bridge = new PageBridge(() => Promise.resolve(), { connectMs: 20 });
      const facebook = await run(bridge);
      const heard = vi.fn();
      facebook.bridge.onStatus(heard);
      expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'connecting' }));
      const video = document.createElement('video');
      document.body.append(video);
      const asked = facebook.bridge.videoSources(video);

      await options.set('downloads_on', false);

      await expect(asked).rejects.toMatchObject({ failure: 'cancelled' });
      await vi.waitFor(() => expect(bridge.status().state).toBe('unavailable'));
      expect(heard).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createPage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    document.body.innerHTML = '<h5>A header</h5><h6>Another</h6>';
  });

  it("uses the user's saved selectors, and the new ones each time they change", async () => {
    await extensionStore.set(`u/${LOCATOR_OVERRIDES}`, { 'post-header': ['h5'], nonsense: 3 });
    const data = new SavedData(extensionStore, 'u');
    const saved = data.value(LOCATOR_OVERRIDES, readLocatorOverrides);
    let page: FacebookPage | undefined;
    const feature = defineFeature({
      id: 'headers',
      setup: (ctx) => {
        page = ctx.page;
      },
    });
    await new FeatureRunner(
      [feature],
      new Options(extensionStore, 'u/options'),
      createPage(data, installReaders()),
      data,
    ).start();
    await saved.ready;
    const header = () => page?.locate(POST_HEADER).first(document)?.tagName;

    expect(header()).toBe('H5');

    await saved.set({ 'post-header': ['h6'] });
    expect(header()).toBe('H6');

    await extensionStore.set(`u/${LOCATOR_OVERRIDES}`, {});
    await vi.waitFor(() => expect(header()).toBeUndefined());
  });
});
