import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Post } from './posts';
import { FeatureRunner } from '../core/app';
import { Listeners } from '../core/listeners';
import { createLogger } from '../core/log';
import { Options } from '../core/options';
import { PageWatcher } from '../core/page-watcher';
import { SavedData } from '../core/saved';
import { sleep } from '../core/timing';
import { extensionStore } from '../platform/extension-store';
import { bindPage, defineFeature } from './feature';
import { fakeAtoms } from './testing';

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

  const page = () =>
    bindPage({
      atoms: { ...fakeAtoms, onChange: (listener) => atomsChanged.add(listener) },
      posts: {
        onAdd: (listener) => added.add(listener),
        onRemove: () => () => undefined,
        onReset: () => () => undefined,
        onUpdate: () => () => undefined,
      },
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
});
