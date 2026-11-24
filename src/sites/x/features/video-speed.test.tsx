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
    expect(parseNativeSpeedLabel('1x (Normal)')).toBe(1);
    expect(parseNativeSpeedLabel('Normal (1x)')).toBe(1);
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

  it('detects videoPlayer popovers without role="menu", syncs parent "Playback speed · 1.37x" row, and hides stale native checkmarks', async () => {
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <article data-testid="tweet">
          <div data-testid="videoPlayer"><video id="v-inline"></video></div>
        </article>
      </div>
    `;

    const { platform, store } = fakePlatform({
      [`v2/x/777/${X_VIDEO_SPEED_KEY}`]: { rate: 1.37, custom: true },
    });
    storesToStop.push(store);
    const failed = await startSite(xSite, platform);
    expect(failed).toEqual([]);

    const player = document.querySelector('[data-testid="videoPlayer"]') as HTMLElement;
    const video = document.querySelector('#v-inline') as HTMLVideoElement;
    await vi.waitFor(() => expect(video.playbackRate).toBeCloseTo(1.37, 2));

    // 1. Open X's parent video gear popover directly inside videoPlayer (no role="menu" or Dropdown).
    const popover = document.createElement('div');
    popover.innerHTML = `
      <div role="button" tabindex="0" id="gear-speed-row">
        <div><span>Playback speed</span></div>
        <div><span id="native-speed-val">Normal</span><svg><path d="M0 0"/></svg></div>
      </div>
      <div role="button" tabindex="0"><span>Video quality</span><span>Auto</span></div>
    `;
    player.append(popover);

    await vi.waitFor(() => {
      const badge = popover.querySelector('[data-feed-sanity="x-speed-parent-value"]');
      expect(badge?.textContent).toBe(' · 1.37x');
    });
    expect(
      popover.querySelector('#native-speed-val')?.getAttribute('data-fs-speed-native-hidden'),
    ).toBe('true');

    // External speed update (e.g. from toolbar popup) updates parent menu label live.
    await store.set(`v2/x/777/${X_VIDEO_SPEED_KEY}`, { rate: 1.65, custom: true });
    await vi.waitFor(() => {
      expect(popover.querySelector('[data-feed-sanity="x-speed-parent-value"]')?.textContent).toBe(
        ' · 1.65x',
      );
    });

    // 2. Navigate into Playback speed submenu rendered with div[role="button"] rows + stale Normal checkmark.
    popover.innerHTML = `
      <div role="button" tabindex="0"><span>Playback speed</span></div>
      <div class="speed-list">
        <div role="button" tabindex="0"><span>0.25x</span></div>
        <div role="button" tabindex="0"><span>0.5x</span></div>
        <div role="button" tabindex="0"><span>0.75x</span></div>
        <div role="button" tabindex="0" id="opt-normal"><span>Normal</span><svg id="native-check"><path d="M0 0"/></svg></div>
        <div role="button" tabindex="0" id="opt-15"><span>1.5x</span></div>
        <div role="button" tabindex="0"><span>2x</span></div>
      </div>
    `;

    await vi.waitFor(() =>
      expect(
        popover.querySelectorAll('feed-sanity-ui[data-feed-sanity="x-video-speed"]').length,
      ).toBe(1),
    );
    // Parent badge should not be injected onto the submenu header.
    expect(popover.querySelector('[data-feed-sanity="x-speed-parent-value"]')).toBeNull();
    // Stale native checkmark on Normal is hidden while custom speed (1.65x) is active.
    expect(popover.querySelector('#opt-normal')?.getAttribute('data-fs-speed-hide-check')).toBe(
      'true',
    );

    // 3. Clicking native 1.5x marks it selected via paint-only attribute (zero stray SVG badges) and clears Custom active state.
    (popover.querySelector('#opt-15') as HTMLElement).click();
    await vi.waitFor(() => expect(video.playbackRate).toBeCloseTo(1.5, 2));
    expect(popover.querySelector('#opt-15')?.getAttribute('data-fs-speed-hide-check')).toBeNull();
    expect(popover.querySelector('#opt-15')?.getAttribute('data-fs-speed-selected')).toBe('true');
    expect(popover.querySelector('[data-feed-sanity="x-speed-native-check"]')).toBeNull();
    expect(popover.querySelector('#opt-normal')?.getAttribute('data-fs-speed-hide-check')).toBe(
      'true',
    );

    // 4. Returning to parent menu shows "Playback speed · 1.5x".
    popover.innerHTML = `
      <div role="button" tabindex="0">
        <span>Playback speed</span>
        <span>Normal</span>
      </div>
    `;
    await vi.waitFor(() => {
      expect(popover.querySelector('[data-feed-sanity="x-speed-parent-value"]')?.textContent).toBe(
        ' · 1.5x',
      );
    });
  });

  it('provides a clear editable input + Set confirm button that dismisses the submenu and syncs native radio/ratechange back into saved speed', async () => {
    document.body.innerHTML = `
      <div data-testid="primaryColumn">
        <article data-testid="tweet">
          <div data-testid="videoPlayer"><video id="v-sync"></video></div>
        </article>
      </div>
    `;

    const { platform, store } = fakePlatform();
    storesToStop.push(store);
    expect(await startSite(xSite, platform)).toEqual([]);

    const video = document.querySelector('#v-sync') as HTMLVideoElement;
    const dropdown = document.createElement('div');
    dropdown.setAttribute('data-testid', 'Dropdown');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    for (const label of ['0.25x', '0.5x', '1x', '1.25x', '1.5x', '2x']) {
      const row = document.createElement('label');
      row.setAttribute('role', 'menuitemradio');
      const span = document.createElement('span');
      span.textContent = label;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'x-speed';
      row.append(span, radio);
      menu.append(row);
    }
    dropdown.append(menu);
    document.body.append(dropdown);

    await vi.waitFor(() =>
      expect(
        document.querySelector('feed-sanity-ui[data-feed-sanity="x-video-speed"]'),
      ).not.toBeNull(),
    );

    const host = document.querySelector(
      'feed-sanity-ui[data-feed-sanity="x-video-speed"]',
    ) as HTMLElement;
    const shadow = host.shadowRoot!;

    // No confusing 1x reset button and no misleading "×" suffix inside the numeric field.
    expect(shadow.querySelector('.fs-speed-reset')).toBeNull();
    expect(shadow.querySelector('.fs-speed-suffix')).toBeNull();

    // Selecting a native speed via radio input change syncs cleanly into our store.
    const row125 = [...menu.querySelectorAll('label')].find((el) => el.textContent === '1.25x')!;
    const radio125 = row125.querySelector('input[type="radio"]') as HTMLInputElement;
    radio125.checked = true;
    radio125.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(async () => {
      expect(await store.get(`v2/x/777/${X_VIDEO_SPEED_KEY}`)).toEqual({
        rate: 1.25,
        custom: false,
      });
    });

    // If X natively changes video.playbackRate while the speed menu is open, adopt it instead of snapping back.
    video.playbackRate = 1.75;
    video.dispatchEvent(new Event('ratechange'));
    await vi.waitFor(async () => {
      expect(await store.get(`v2/x/777/${X_VIDEO_SPEED_KEY}`)).toEqual({
        rate: 1.75,
        custom: false,
      });
    });
    expect(video.playbackRate).toBeCloseTo(1.75, 2);

    // Typing a custom speed and clicking the primary "Set 1.42×" button saves immediately and dispatches Escape to close the submenu.
    const escKeys: string[] = [];
    dropdown.addEventListener('keydown', (event) => escKeys.push((event as KeyboardEvent).key));
    const input = shadow.querySelector(
      'input[aria-label="Custom playback speed"]',
    ) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: '1.42' } });
    const applyBtn = shadow.querySelector('button.fs-speed-apply') as HTMLButtonElement;
    expect(applyBtn.textContent).toBe('Set 1.42×');
    fireEvent.click(applyBtn);

    expect(video.playbackRate).toBeCloseTo(1.42, 2);
    // Dispatches exactly one Escape event (never double-Escape closing an enclosing lightbox).
    expect(escKeys.filter((k) => k === 'Escape')).toHaveLength(1);
    await vi.waitFor(async () => {
      expect(await store.get(`v2/x/777/${X_VIDEO_SPEED_KEY}`)).toEqual({
        rate: 1.42,
        custom: true,
      });
    });

    // Invalid draft shows alert & disables Set; clearing draft falls back to active rate cleanly.
    fireEvent.input(input, { target: { value: 'abc' } });
    expect(applyBtn.disabled).toBe(true);
    expect(shadow.querySelector('[role="alert"]')?.textContent).toContain('Enter a number');
    fireEvent.input(input, { target: { value: '' } });
    expect(applyBtn.disabled).toBe(false);
    fireEvent.click(applyBtn);
    expect(escKeys.filter((k) => k === 'Escape')).toHaveLength(2);

    // Non-primary pointerdown (right-click) on a native speed option does NOT commit that speed,
    // and a spurious host `1x` reset while menu is open is rejected back to 1.42x.
    row125.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
    expect(video.playbackRate).toBeCloseTo(1.42, 2);
    video.playbackRate = 1;
    video.dispatchEvent(new Event('ratechange'));
    expect(video.playbackRate).toBeCloseTo(1.42, 2);

    // Returning to parent gear popover (roleless div rows with "· 1.75x", separate "·" span,
    // or single inline text node) replaces X's native speed with our saved 1.42x cleanly.
    const player = document.querySelector('[data-testid="videoPlayer"]') as HTMLElement;
    const gearPopover = document.createElement('div');
    gearPopover.innerHTML = `
      <div class="gear-row" id="row-middot">
        <svg><circle/></svg>
        <span class="lbl">Playback speed</span><span class="val"> · 1.75x</span>
      </div>
      <div class="gear-row" id="row-inline">
        <svg><circle/></svg>
        <span class="inline-lbl">Playback speed · 1.75x</span>
      </div>
      <div class="gear-row" id="row-split">
        <svg><circle/></svg>
        <span class="lbl">Playback speed</span><span class="sep"> · </span><span class="val">1.75x</span>
      </div>
    `;
    player.append(gearPopover);

    await vi.waitFor(() => {
      expect(
        gearPopover.querySelector('#row-middot [data-feed-sanity="x-speed-parent-value"]')
          ?.textContent,
      ).toBe(' · 1.42x');
    });
    expect(
      gearPopover.querySelector('#row-middot .val')?.getAttribute('data-fs-speed-native-hidden'),
    ).toBe('true');
    expect(
      gearPopover.querySelector('#row-inline [data-feed-sanity="x-speed-parent-value"]')
        ?.textContent,
    ).toBe(' · 1.42x');
    expect(gearPopover.querySelector('#row-inline .inline-lbl')?.textContent).toBe(
      'Playback speed · 1.42x',
    );
    expect(
      gearPopover.querySelector('#row-split .sep')?.getAttribute('data-fs-speed-native-hidden'),
    ).toBe('true');
    expect(
      gearPopover.querySelector('#row-split .val')?.getAttribute('data-fs-speed-native-hidden'),
    ).toBe('true');
    expect(
      gearPopover.querySelector('#row-split [data-feed-sanity="x-speed-parent-value"]')
        ?.textContent,
    ).toBe(' · 1.42x');
  });

  it('ignores comment-tweet like button mutations inside a #layers photo modal without scanning replies', async () => {
    document.body.innerHTML = `
      <div id="layers">
        <div id="photo-layer">
          <div role="dialog" id="photo-modal">
            <article data-testid="tweet" id="reply-1">
              <div data-testid="tweetText">Reply text</div>
              <button data-testid="like" type="button"><span id="like-count">41</span></button>
            </article>
          </div>
        </div>
      </div>
    `;

    const { platform, store } = fakePlatform();
    storesToStop.push(store);
    expect(await startSite(xSite, platform)).toEqual([]);

    const photoLayer = document.querySelector('#photo-layer') as HTMLElement;
    const spy = vi.spyOn(photoLayer, 'querySelectorAll');
    const likeCount = document.querySelector('#like-count') as HTMLElement;
    const likeBtn = document.querySelector('[data-testid="like"]') as HTMLElement;

    // Simulate clicking Like on a comment tweet: text change + heart burst span insertion.
    likeCount.textContent = '42';
    const burst = document.createElement('span');
    burst.textContent = '♥';
    likeBtn.append(burst);
    await new Promise((r) => setTimeout(r, 10));

    expect(spy).not.toHaveBeenCalled();
  });

  it('decorates a [role="menu"] gear popover with trailing-middot or inline speed rows without entering a MutationObserver loop', async () => {
    const { platform, store } = fakePlatform({
      [`v2/x/777/${X_VIDEO_SPEED_KEY}`]: { rate: 1.42, custom: true },
    });
    storesToStop.push(store);
    expect(await startSite(xSite, platform)).toEqual([]);

    const dropdown = document.createElement('div');
    dropdown.setAttribute('role', 'menu');
    dropdown.setAttribute('data-testid', 'Dropdown');
    dropdown.innerHTML = `
      <div role="menuitem" id="row-trailing-dot">
        <span>Playback speed · </span><span class="native-val">1.75x</span>
      </div>
      <div role="menuitem" id="row-inline-text">
        <span>Playback speed · 1.75x</span>
      </div>
      <div role="menuitem" id="row-adjacent"><span>Playback speed</span><span class="native-val">Normal</span></div>
      <div role="menuitem"><span>Video quality · Auto (1080p)</span></div>
      <div role="menuitem"><span>Download video</span></div>
    `;
    const spy = vi.spyOn(dropdown, 'querySelectorAll');
    document.body.append(dropdown);

    await vi.waitFor(() => {
      expect(
        dropdown.querySelector('#row-trailing-dot [data-feed-sanity="x-speed-parent-value"]')
          ?.textContent,
      ).toBe(' · 1.42x');
      expect(
        dropdown.querySelector('#row-inline-text [data-feed-sanity="x-speed-parent-value"]')
          ?.textContent,
      ).toBe(' · 1.42x');
      expect(
        dropdown.querySelector('#row-adjacent [data-feed-sanity="x-speed-parent-value"]')
          ?.textContent,
      ).toBe(' · 1.42x');
    });

    expect(
      dropdown
        .querySelector('#row-trailing-dot .native-val')
        ?.getAttribute('data-fs-speed-native-hidden'),
    ).toBe('true');
    expect(
      dropdown
        .querySelector('#row-adjacent .native-val')
        ?.getAttribute('data-fs-speed-native-hidden'),
    ).toBe('true');
    expect(dropdown.querySelector('#row-trailing-dot > span')?.textContent).toBe(
      'Playback speed · 1.42x',
    );

    // Wait briefly and verify zero self-triggering MutationObserver oscillation/freeze.
    const callsAfterSettle = spy.mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(spy.mock.calls.length).toBe(callsAfterSettle);
    expect(callsAfterSettle).toBeLessThan(20);
  });
});
