import { describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '../capabilities';
import type { Binder } from './feature';
import { bindFeed, bindLocator, bindVideos, bindWatch } from './bind';
import { createDomEnvironment } from './dom-env';
import { IDENTITY_RESOLVER, Locators } from './locator';
import { Scope } from './scope';

function makeBinder(): {
  binder: Binder;
  scope: Scope;
  errors: unknown[];
} {
  const scope = new Scope();
  const errors: unknown[] = [];
  const guard = <A extends unknown[]>(fn: (...args: A) => void) => {
    return (...args: A): void => {
      try {
        fn(...args);
      } catch (error) {
        errors.push(error);
      }
    };
  };
  const binder: Binder = {
    scope,
    guard,
    listen(subscribe, listener) {
      return scope.add(subscribe(guard(listener)));
    },
  };
  return { binder, scope, errors };
}

describe('core bind helpers', () => {
  it('forwards locator.all(root, keep), guards callbacks, and cleans up on scope dispose', () => {
    document.body.innerHTML = '<div class="a">1</div><div class="a keep">2</div>';
    const spec = {
      name: 'items',
      mode: 'any' as const,
      strategies: [{ selector: '.a', seen: '2026-01-01' }],
    };
    const locators = new Locators(IDENTITY_RESOLVER, [spec]);
    const { binder, scope, errors } = makeBinder();

    const bound = bindLocator(locators.locate(spec), binder);
    expect(bound.all(document, (el) => el.classList.contains('keep'))).toHaveLength(1);

    const onChange = vi.fn(() => {
      throw new Error('boom');
    });
    bound.onChange(onChange);
    locators.override({ items: ['.a.keep'] });
    expect(errors).toHaveLength(1);

    scope.dispose();
    locators.override({});
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('guards and auto-cleans watch, feed, and video.onControls listeners on scope dispose', () => {
    document.body.innerHTML = '<article id="p1"></article><video id="v1"></video>';
    const env = createDomEnvironment();
    const { binder, scope, errors } = makeBinder();

    const added: Element[] = [];
    const watch = bindWatch(env.watcher, binder);
    watch('article', {
      added: (el) => {
        added.push(el);
        throw new Error('watch-err');
      },
    });
    expect(added).toHaveLength(1);
    expect(errors).toHaveLength(1);

    // Feed listener cleanup
    const feedUnsub = vi.fn();
    const feed = bindFeed(
      {
        onTrack: () => feedUnsub,
        onUntrack: () => feedUnsub,
        onAdd: () => feedUnsub,
        onUpdate: () => feedUnsub,
        onRemove: () => feedUnsub,
        onReset: () => feedUnsub,
      },
      binder,
    );
    feed.onAdd(() => undefined);

    // Video `item.onControls` routes through `binder.listen` for error guarding and scope cleanup!
    const controlListeners = new Set<() => void>();
    const videoEl = document.querySelector('video')!;
    const rawVideo: MediaItem = {
      element: videoEl,
      container: document.body,
      surface: 'feed',
      onControls: (listener) => {
        controlListeners.add(listener);
        return () => controlListeners.delete(listener);
      },
    };
    const videos = bindVideos(
      {
        onAdd: (cb) => {
          cb(rawVideo);
          return () => undefined;
        },
        onRemove: () => () => undefined,
        onControls: () => () => undefined,
        around: () => rawVideo,
      },
      binder,
    );

    const onCtrl = vi.fn(() => {
      throw new Error('ctrl-err');
    });
    videos.onAdd((video) => {
      video.onControls(onCtrl);
    });
    expect(controlListeners.size).toBe(1);
    for (const cb of controlListeners) {
      cb();
    }
    expect(onCtrl).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(2);

    scope.dispose();
    expect(feedUnsub).toHaveBeenCalledTimes(1);
    expect(controlListeners.size).toBe(0);
    env.dispose();
  });
});
