import { fireEvent } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform } from '../../../core/platform';
import { startSite } from '../../../core/site';
import { SITES_STORAGE_KEY } from '../../../core/site-settings';
import { inMemoryStore } from '../../../core/testing';
import { xSite } from '../index';
import {
  clampVideoSpeed,
  formatSpeedNumber,
  parseNativeSpeedLabel,
  parseSpeedInput,
  readSavedVideoSpeed,
  X_VIDEO_SPEED_KEY,
} from './video-speed';

function fakePlatform(initial: Record<string, unknown> = {}) {
  const store = inMemoryStore(initial);
  const platform: Platform = {
    store,
    build: 'test',
    onOpenOptions: () => undefined,
    setBadge: () => undefined,
    installPageWorld: () => Promise.reject(new Error('no page world in unit test')),
  };
  return { platform, store };
}

function makePlaybackSpeedItems(): HTMLElement[] {
  const labels = ['0.25x', '0.5x', '0.75x', 'Normal', '1.25x', '1.5x', '1.75x', '2x'];
  return labels.map((label) => {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    return item;
  });
}

describe('x_video_speed feature', () => {
  const storesToStop: Array<ReturnType<typeof inMemoryStore>> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('twid=u%3D777');
    history.replaceState({}, '', '/home');
  });

  afterEach(async () => {
    for (const store of storesToStop.splice(0)) {
      await store.set(SITES_STORAGE_KEY, { x: false });
    }
    vi.restoreAllMocks();
  });

  it('parses, clamps, formats, and validates custom and native playback speeds', () => {
    expect(clampVideoSpeed(1.174)).toBe(1.17);
    expect(clampVideoSpeed(0.02)).toBe(0.1);
    expect(clampVideoSpeed(25)).toBe(16);
    expect(formatSpeedNumber(1)).toBe('1');
    expect(formatSpeedNumber(1.17)).toBe('1.17');
    expect(formatSpeedNumber(2.2)).toBe('2.2');

    expect(parseSpeedInput('1.17')).toBe(1.17);
    expect(parseSpeedInput('2.23x')).toBe(2.23);
    expect(parseSpeedInput('0.78×')).toBe(0.78);
    expect(parseSpeedInput('0.05')).toBeNull();
    expect(parseSpeedInput('20')).toBeNull();
    expect(parseSpeedInput('abc')).toBeNull();

    expect(parseNativeSpeedLabel('Normal')).toBe(1);
    expect(parseNativeSpeedLabel('0.25x')).toBe(0.25);
    expect(parseNativeSpeedLabel('2x')).toBe(2);
    expect(parseNativeSpeedLabel('Playback speed')).toBeNull();

    expect(readSavedVideoSpeed(null)).toEqual({ rate: 1, custom: false });
    expect(readSavedVideoSpeed({ rate: 1.37, custom: true })).toEqual({ rate: 1.37, custom: true });
    expect(readSavedVideoSpeed({ rate: 99, custom: 'bad' })).toEqual({ rate: 16, custom: true });
  });

  it('mounts divider + Custom slider & input beneath native speed options, saves any speed, remembers across videos, and respects native clicks', async () => {
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <article data-testid="tweet">
          <div data-testid="videoPlayer"><video id="v1"></video></div>
        </article>
        <article data-testid="tweet">
          <div data-testid="gifPlayer"><video id="gif1" loop muted></video></div>
        </article>
      </div>
    `;

    const { platform, store } = fakePlatform();
    storesToStop.push(store);
    const failed = await startSite(xSite, platform);
    expect(failed).toEqual([]);

    const v1 = document.querySelector('#v1') as HTMLVideoElement;
    const gif1 = document.querySelector('#gif1') as HTMLVideoElement;

    // 1. Open X Settings menu first (not Playback speed yet -> no injection).
    const dropdown = document.createElement('div');
    dropdown.setAttribute('data-testid', 'Dropdown');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const speedRow = document.createElement('div');
    speedRow.setAttribute('role', 'menuitem');
    speedRow.textContent = 'Playback speed';
    menu.append(speedRow);
    dropdown.append(menu);
    document.body.append(dropdown);

    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.querySelectorAll('feed-sanity-ui[data-feed-sanity="x-video-speed"]').length,
    ).toBe(0);

    // 2. X transitions the same menu in-place into the Playback speed list -> injects exactly ONE control beneath 2x!
    menu.replaceChildren(...makePlaybackSpeedItems());

    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('feed-sanity-ui[data-feed-sanity="x-video-speed"]').length,
      ).toBe(1),
    );

    const host = document.querySelector(
      'feed-sanity-ui[data-feed-sanity="x-video-speed"]',
    ) as HTMLElement;
    expect(host.previousElementSibling?.textContent).toBe('2x');
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector('hr.fs-speed-divider')).not.toBeNull();

    // 3. Typing an arbitrary speed (`1.17`) applies to v1 immediately, leaves GIF alone, and saves persistently.
    const input = shadow.querySelector(
      'input[aria-label="Custom playback speed"]',
    ) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: '1.17' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(v1.playbackRate).toBeCloseTo(1.17, 2);
    expect(v1.defaultPlaybackRate).toBeCloseTo(1.17, 2);
    expect(gif1.playbackRate).toBe(1);
    await vi.waitFor(async () => {
      expect(await store.get(`v2/x/777/${X_VIDEO_SPEED_KEY}`)).toEqual({
        rate: 1.17,
        custom: true,
      });
    });

    // 4. Dragging slider to `2.23` updates both video and input box immediately and flushes on pointerup.
    const slider = shadow.querySelector(
      'input[aria-label="Playback speed slider"]',
    ) as HTMLInputElement;
    fireEvent.input(slider, { target: { value: '2.23' } });
    fireEvent.pointerUp(slider);
    expect(v1.playbackRate).toBeCloseTo(2.23, 2);
    expect(input.value).toBe('2.23');
    await vi.waitFor(async () => {
      expect(await store.get(`v2/x/777/${X_VIDEO_SPEED_KEY}`)).toEqual({
        rate: 2.23,
        custom: true,
      });
    });

    // 4b. Reusing a native menuitem DOM node for an unrelated label must NOT overwrite speed.
    const firstItem = menu.querySelector('[role="menuitem"]') as HTMLElement;
    firstItem.textContent = 'Video quality';
    firstItem.click();
    expect(v1.playbackRate).toBeCloseTo(2.23, 2);
    firstItem.textContent = '0.25x';

    // 5. If X tries to reset `playbackRate = 1` on `play`, saved custom speed (`2.23`) is enforced.
    v1.playbackRate = 1;
    v1.dispatchEvent(new Event('play'));
    expect(v1.playbackRate).toBeCloseTo(2.23, 2);

    // 6. Newly added video inherits saved speed automatically.
    const nextTweet = document.createElement('article');
    nextTweet.setAttribute('data-testid', 'tweet');
    nextTweet.innerHTML = '<div data-testid="videoPlayer"><video id="v2"></video></div>';
    document.querySelector('[data-testid="primaryColumn"]')?.append(nextTweet);
    const v2 = document.querySelector('#v2') as HTMLVideoElement;
    await vi.waitFor(() => expect(v2.playbackRate).toBeCloseTo(2.23, 2));

    // 7. Clicking a native speed option (`Normal`) updates saved speed cleanly.
    const normalItem = [...menu.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent === 'Normal',
    ) as HTMLElement;
    normalItem.click();
    expect(v1.playbackRate).toBe(1);
    expect(v2.playbackRate).toBe(1);
    await vi.waitFor(async () => {
      expect(await store.get(`v2/x/777/${X_VIDEO_SPEED_KEY}`)).toEqual({
        rate: 1,
        custom: false,
      });
    });

    // 8. Navigating back out of Playback speed removes our control cleanly.
    menu.replaceChildren(speedRow);
    await vi.waitFor(() =>
      expect(
        document.querySelectorAll('feed-sanity-ui[data-feed-sanity="x-video-speed"]').length,
      ).toBe(0),
    );
  });

  it('hydrates previously saved custom speed (`0.78x`) on fresh page boot', async () => {
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <article data-testid="tweet">
          <div data-testid="videoPlayer"><video id="v-boot"></video></div>
        </article>
      </div>
    `;
    const { platform, store } = fakePlatform({
      [`v2/x/777/${X_VIDEO_SPEED_KEY}`]: { rate: 0.78, custom: true },
    });
    storesToStop.push(store);
    const failed = await startSite(xSite, platform);
    expect(failed).toEqual([]);

    const vBoot = document.querySelector('#v-boot') as HTMLVideoElement;
    await vi.waitFor(() => expect(vBoot.playbackRate).toBeCloseTo(0.78, 2));
  });
});
