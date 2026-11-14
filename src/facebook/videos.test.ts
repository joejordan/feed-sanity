import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Video } from './videos';
import { PageWatcher } from '../core/page-watcher';
import { sleep } from '../core/timing';
import { fakeLocate } from './testing';
import { Videos } from './videos';

/** Adds this markup to the page and returns its first element. */
function add(html: string, parent: Element = document.body): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const element = holder.firstElementChild as HTMLElement;
  parent.append(element);
  return element;
}

const PLAYER =
  '<div data-video-id="1"><div><video></video></div><div role="presentation"></div></div>';

describe('Videos', () => {
  let videos: Videos;
  let stops: (() => void)[];
  let added: Video[];
  let removed: Video[];

  beforeEach(() => {
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    const watcher = new PageWatcher();
    videos = new Videos(fakeLocate, (selector, handlers, options) =>
      watcher.watch(selector, handlers, options),
    );
    stops = [];
    added = [];
    removed = [];
  });

  afterEach(() => {
    for (const stop of stops) {
      stop();
    }
  });

  const follow = (): void => {
    stops.push(
      videos.onRemove((video) => removed.push(video)),
      videos.onAdd((video) => added.push(video)),
    );
  };

  it('reports the videos on the page and each one that comes or goes', async () => {
    const first = add(PLAYER).querySelector('video');
    follow();
    expect(added.map((video) => video.element)).toEqual([first]);

    const second = add(PLAYER).querySelector('video');
    await vi.waitFor(() => expect(added).toHaveLength(2));
    expect(added[1]?.element).toBe(second);

    first?.closest('[data-video-id]')?.remove();
    await vi.waitFor(() => expect(removed).toHaveLength(1));
    expect(removed[0]).toBe(added[0]);
  });

  it('looks for nothing until something listens, and stops once nothing does', async () => {
    add(PLAYER);
    const late = vi.fn();
    stops.push(videos.onRemove(late));
    await sleep(10);
    expect(late).not.toHaveBeenCalled();

    const stop = videos.onAdd(() => undefined);
    stop();
    document.body.innerHTML = '';
    add(PLAYER);
    await sleep(10);

    expect(late).not.toHaveBeenCalled();
    const again = vi.fn();
    stops.push(videos.onAdd(again));
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("finds the wrapper Facebook puts around a video, or else the video's parent", () => {
    const player = add(PLAYER);
    const bare = add('<section><video></video></section>');
    follow();

    expect(added[0]?.container).toBe(player);
    expect(added[1]?.container).toBe(bare);
    bare.querySelector('video')?.remove();
    expect(added[1]?.container).toBeNull();
  });

  it('tells which surface a video is on', () => {
    add(`<div aria-posinset="1">${PLAYER}</div>`);
    add('<div data-video-id="2" data-index="0"><video></video></div>');
    add(`<div role="article">${PLAYER}</div>`);
    add('<div><video></video></div>');
    follow();

    expect(added.map((video) => video.surface)).toEqual(['feed', 'reel', 'feed', 'other']);
    history.replaceState({}, '', '/reel/123');
    expect(added[3]?.surface).toBe('reel');
  });

  it("reports each of Facebook's sliders that comes to a video or leaves it", async () => {
    const player = add(PLAYER);
    add(PLAYER);
    const changed = vi.fn();
    stops.push(videos.onControls(changed));
    follow();

    const controls = add('<div><div role="slider"></div><div role="slider"></div></div>', player);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    controls.firstElementChild?.remove();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
    controls.remove();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(4));

    expect(new Set(changed.mock.calls.map(([video]) => video))).toEqual(new Set([added[0]]));
  });

  it("lists Facebook's controls in the player, with sliders outside the wrapper", async () => {
    const viewer = add(`
      <div>
        <div data-video-id="1" data-index="0">
          <video></video><div role="button" id="corner"></div>
        </div>
        <a href="/reel/1" id="author">Author</a>
      </div>`);
    add('<div role="button" id="elsewhere"></div>');
    follow();
    const ids = () => added[0]?.controls().map(({ element }) => element.id);
    expect(ids()).toEqual(['corner']);

    add('<div><div><div role="slider" id="position"></div></div></div>', viewer);

    await vi.waitFor(() => expect(ids()).toEqual(['corner', 'author', 'position']));
    add('<div role="slider" aria-orientation="vertical" id="volume"></div>', viewer);
    await vi.waitFor(() => expect(ids()).toContain('volume'));
    const bars = added[0]
      ?.controls()
      .filter(({ bar }) => bar)
      .map(({ element }) => element.id);
    expect(bars).toEqual(['position']);
  });

  it('reports when the element is emptied and the first time a video plays after it was loaded', () => {
    const element = add(PLAYER).querySelector('video') as HTMLVideoElement;
    const changed = vi.fn();
    stops.push(videos.onControls(changed));
    follow();

    element.dispatchEvent(new Event('playing'));
    element.dispatchEvent(new Event('playing'));
    expect(changed).toHaveBeenCalledExactlyOnceWith(added[0]);

    element.dispatchEvent(new Event('emptied'));
    expect(changed).toHaveBeenCalledTimes(2);
    element.dispatchEvent(new Event('playing'));
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('gives a slider that arrived before its video to the video', async () => {
    const player = add('<div data-video-id="1"><div role="slider" id="early"></div></div>');
    follow();

    add('<video></video>', player);

    await vi.waitFor(() => expect(added).toHaveLength(1));
    expect(added[0]?.controls().map(({ element }) => element.id)).toEqual(['early']);
  });

  it('finds the video something drawn over it belongs to', () => {
    const player = add(PLAYER);
    const two = add(`<div>${PLAYER}${PLAYER}</div>`);
    follow();
    const layer = player.querySelector('[role=presentation]') as Element;

    expect(videos.around(layer)).toBe(added[0]);
    expect(videos.around(added[0]?.element as Element)).toBe(added[0]);
    expect(videos.around(two)).toBeUndefined();
    expect(videos.around(two.querySelector('[role=presentation]') as Element)).toBe(added[1]);
    expect(videos.around(document.body)).toBeUndefined();
  });
});
