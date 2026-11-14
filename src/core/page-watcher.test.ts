import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Listeners } from './listeners';
import { anyOf, Locators } from './locator';
import { createLogger } from './log';
import { PageWatcher } from './page-watcher';
import { sleep } from './timing';

function addHtml(html: string, parent: Element = document.body): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const element = holder.firstElementChild as HTMLElement;
  parent.append(element);
  return element;
}

describe('PageWatcher', () => {
  let watcher: PageWatcher;
  let stops: (() => void)[];
  /** Stops `stop` after the test, as well as when the test does. */
  const later = <T extends () => void>(stop: T): T => {
    stops.push(stop);
    return stop;
  };

  beforeEach(() => {
    history.replaceState({}, '', '/');
    document.body.innerHTML = '<div id="root"></div>';
    watcher = new PageWatcher();
    stops = [];
  });

  afterEach(() => {
    for (const stop of stops) {
      stop();
    }
    vi.unstubAllGlobals();
  });

  describe('watchTree', () => {
    it('reports elements added and removed at any depth', async () => {
      const root = document.querySelector('#root') as Element;
      const added = vi.fn();
      const removed = vi.fn();
      later(watcher.watchTree({ added, removed }));

      const child = document.createElement('section');
      root.append(child);
      await vi.waitFor(() => expect(added).toHaveBeenCalledExactlyOnceWith(child));

      child.remove();
      await vi.waitFor(() => expect(removed).toHaveBeenCalledExactlyOnceWith(child));
    });

    it('skips text and elements that hold no content', async () => {
      const added = vi.fn();
      later(watcher.watchTree({ added }));

      document.body.append('text', document.createElement('script'), document.createElement('p'));

      await vi.waitFor(() => expect(added).toHaveBeenCalled());
      expect(added.mock.calls.map(([element]) => (element as Element).tagName)).toEqual(['P']);
    });

    it('does not report changes made before it started', async () => {
      const first = vi.fn();
      const second = vi.fn();
      later(watcher.watchTree({ added: first }));
      const before = document.createElement('p');
      document.body.append(before);
      later(watcher.watchTree({ added: second }));
      const after = document.createElement('section');
      document.body.append(after);

      await vi.waitFor(() => expect(second).toHaveBeenCalled());
      expect(first.mock.calls).toEqual([[before], [after]]);
      expect(second.mock.calls).toEqual([[after]]);
    });

    it('stops when asked', async () => {
      const added = vi.fn();
      const stop = watcher.watchTree({ added });
      stop();

      document.body.append(document.createElement('p'));
      await sleep(20);

      expect(added).not.toHaveBeenCalled();
    });
  });

  describe('watch', () => {
    it('reports each matching element in the page and each one added later, once', async () => {
      const first = addHtml('<video></video>');
      const added = vi.fn();
      later(watcher.watch('video', { added }));
      expect(added).toHaveBeenCalledExactlyOnceWith(first);

      const holder = addHtml('<div><video></video><p><video></video></p></div>');
      await vi.waitFor(() => expect(added).toHaveBeenCalledTimes(3));
      expect(added.mock.calls.slice(1).map(([element]) => element)).toEqual([
        ...holder.querySelectorAll('video'),
      ]);

      holder.append(document.createElement('span'));
      first.after(document.createElement('span'));
      await sleep(20);
      expect(added).toHaveBeenCalledTimes(3);
    });

    it('reports an element that leaves, even after it stopped matching', async () => {
      const video = addHtml('<video class="playing"></video>');
      const holder = addHtml('<div><video class="playing"></video></div>');
      const removed = vi.fn();
      later(watcher.watch('video.playing', { removed }));

      // Without `attributes` the class change goes unnoticed, and the element is still tracked.
      video.classList.remove('playing');
      video.remove();
      await vi.waitFor(() => expect(removed).toHaveBeenCalledExactlyOnceWith(video));

      holder.remove();
      await vi.waitFor(() => expect(removed).toHaveBeenCalledTimes(2));
      expect(removed).toHaveBeenLastCalledWith(holder.firstElementChild);
    });

    it('keeps an element that only moves to another place in the page', async () => {
      const video = addHtml('<video></video>');
      const elsewhere = addHtml('<section></section>');
      const added = vi.fn();
      const removed = vi.fn();
      later(watcher.watch('video', { added, removed }));

      elsewhere.append(video);
      await sleep(20);

      expect(added).toHaveBeenCalledTimes(1);
      expect(removed).not.toHaveBeenCalled();
    });

    it('follows changes to the attributes it is given', async () => {
      const video = addHtml('<video data-state="idle"></video>');
      const added = vi.fn();
      const removed = vi.fn();
      const changed = vi.fn();
      later(
        watcher.watch(
          'video[data-state=playing]',
          { added, removed, changed },
          { attributes: ['data-state', 'data-time'] },
        ),
      );
      expect(added).not.toHaveBeenCalled();

      video.dataset.state = 'playing';
      await vi.waitFor(() => expect(added).toHaveBeenCalledExactlyOnceWith(video));

      video.dataset.time = '5';
      video.title = 'not watched';
      await vi.waitFor(() => expect(changed).toHaveBeenCalledExactlyOnceWith(video, 'data-time'));

      video.dataset.state = 'paused';
      await vi.waitFor(() => expect(removed).toHaveBeenCalledExactlyOnceWith(video));

      video.dataset.time = '6';
      await sleep(20);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('looks again when told the selector has changed', () => {
      const old = addHtml('<p class="old"></p>');
      const fresh = addHtml('<p class="new"></p>');
      let name = 'old';
      const added = vi.fn();
      const removed = vi.fn();
      const watching = later(watcher.watch(() => `p.${name}`, { added, removed }));
      expect(added).toHaveBeenCalledExactlyOnceWith(old);

      name = 'new';
      watching.refresh();

      expect(removed).toHaveBeenCalledExactlyOnceWith(old);
      expect(added).toHaveBeenLastCalledWith(fresh);
    });

    it('watches what a locator finds, and looks again when the locator changes', async () => {
      let known = false;
      const changed = new Listeners(createLogger('test'));
      const locators = new Locators({
        resolve: (selector) =>
          selector.includes('{') && !known ? null : selector.replace('{x}', 'x'),
        onChange: (listener) => changed.add(listener),
      });
      const media = locators.locate(
        anyOf('media', [
          { selector: 'video', seen: '2026-11-14' },
          { selector: 'div.{x}', seen: '2023' },
        ]),
      );
      const video = addHtml('<video></video>');
      const div = addHtml('<div class="x"></div>');
      const added = vi.fn();
      const stop = later(watcher.watch(media, { added }));
      expect(added).toHaveBeenCalledExactlyOnceWith(video);

      known = true;
      changed.emit();
      expect(added).toHaveBeenLastCalledWith(div);

      const section = addHtml('<section><div class="x"></div></section>');
      await vi.waitFor(() => expect(added).toHaveBeenCalledTimes(3));
      expect(added).toHaveBeenLastCalledWith(section.firstElementChild);
      expect(locators.stats()[0]?.found).toBeGreaterThan(0);

      stop();
      addHtml('<video></video>');
      changed.emit();
      await sleep(20);
      expect(added).toHaveBeenCalledTimes(3);
    });

    it('keeps going when a handler throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const broken = vi.fn(() => {
        throw new Error('broken handler');
      });
      const working = vi.fn();
      later(watcher.watch('video', { added: broken }));
      later(watcher.watch('video', { added: working }));

      addHtml('<div><video></video><video></video></div>');

      await vi.waitFor(() => expect(working).toHaveBeenCalledTimes(2));
      expect(broken).toHaveBeenCalledTimes(2);
    });

    it('refuses a selector that is not valid and watches nothing', () => {
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');

      expect(() => watcher.watch('video[', {})).toThrow();

      expect(observe).not.toHaveBeenCalled();
    });

    it('says nothing more once stopped', async () => {
      const video = addHtml('<video></video>');
      const added = vi.fn();
      const removed = vi.fn();
      const stop = watcher.watch('video', { added, removed });
      stop();
      stop();

      video.remove();
      addHtml('<video></video>');
      await sleep(20);

      expect(added).toHaveBeenCalledTimes(1);
      expect(removed).not.toHaveBeenCalled();
    });
  });

  describe('the observer', () => {
    it('runs only while something needs it, watching the attributes asked for', () => {
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const plain = { childList: true, subtree: true };

      const stopTree = watcher.watchTree({});
      const stopUrl = watcher.onUrlChange(() => undefined);
      expect(observe).toHaveBeenCalledExactlyOnceWith(document, plain);

      const stopWatch = watcher.watch('video', {}, { attributes: ['src'] });
      const stopOther = watcher.watch('img', {}, { attributes: ['src', 'alt'] });
      expect(observe).toHaveBeenLastCalledWith(document, {
        ...plain,
        attributes: true,
        attributeFilter: ['alt', 'src'],
      });

      stopOther();
      expect(observe).toHaveBeenLastCalledWith(document, {
        ...plain,
        attributes: true,
        attributeFilter: ['src'],
      });
      stopWatch();
      expect(observe).toHaveBeenLastCalledWith(document, plain);

      stopTree();
      const calls = observe.mock.calls.length;
      disconnect.mockClear();
      stopUrl();
      expect(disconnect).toHaveBeenCalled();
      expect(observe).toHaveBeenCalledTimes(calls);
    });

    it('still hands out changes made just before it starts watching other attributes', async () => {
      const added = vi.fn();
      later(watcher.watchTree({ added }));
      await sleep(0);

      const section = addHtml('<section></section>');
      later(watcher.watch('video', {}, { attributes: ['src'] }));

      await vi.waitFor(() => expect(added).toHaveBeenCalledExactlyOnceWith(section));
    });

    it('hands out what a handler changes after the batch it is handling', async () => {
      const seen: string[] = [];
      let first = true;
      later(
        watcher.watchTree({
          added: () => {
            if (first) {
              first = false;
              document.body.append(document.createElement('span'));
              later(watcher.watch('video', {}, { attributes: ['src'] }));
            }
          },
        }),
      );
      later(watcher.watchTree({ added: (element) => seen.push(element.tagName) }));

      document.body.append(document.createElement('section'));

      await vi.waitFor(() => expect(seen).toEqual(['SECTION', 'SPAN']));
    });
  });

  describe('onUrlChange', () => {
    it('reports a new address before the content that came with it', async () => {
      const order: string[] = [];
      later(watcher.watch('p', { added: () => order.push('watch') }));
      later(watcher.watchTree({ added: () => order.push('tree') }));
      later(watcher.onUrlChange(() => order.push('address')));

      history.pushState({}, '', '/groups/gardening/');
      document.body.append(document.createElement('p'));

      await vi.waitFor(() => expect(order).toEqual(['address', 'watch', 'tree']));
    });

    it('reports a change of the address fragment', () => {
      const listener = vi.fn();
      later(watcher.onUrlChange(listener));

      history.replaceState({}, '', '/#comments');
      dispatchEvent(new Event('hashchange'));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('hears of a new address from the Navigation API where the browser has it', () => {
      const navigation = new EventTarget();
      vi.stubGlobal('navigation', navigation);
      const listener = vi.fn();
      const stop = watcher.onUrlChange(listener);

      history.pushState({}, '', '/marketplace/');
      navigation.dispatchEvent(new Event('currententrychange'));
      expect(listener).toHaveBeenCalledTimes(1);

      // The same address again is no change.
      navigation.dispatchEvent(new Event('currententrychange'));
      stop();
      history.pushState({}, '', '/groups/');
      navigation.dispatchEvent(new Event('currententrychange'));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForElement', () => {
    it('resolves with an element already in the page', async () => {
      expect(await watcher.waitForElement('body')).toBe(document.body);
    });

    it('waits for the element to be added, then stops watching', async () => {
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const found = watcher.waitForElement('aside');
      await sleep(0);

      const aside = addHtml('<div><aside></aside></div>').firstElementChild;

      expect(await found).toBe(aside);
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
