import type { Locator, Page } from '@playwright/test';
import { expect, OPTIONS_KEY, ORIGIN, test } from './extension';

const VIDEOS = `${ORIGIN}/videos/`;

/** The player with this ID in e2e/pages/videos/index.html: `playing`, `paused` or `reel`. */
const player = (page: Page, id: string) => page.locator(`#${id}`);

const scrubberOf = (page: Page, id: string) =>
  player(page, id).getByRole('slider', { name: 'Video position' });

const videoOf = (page: Page, id: string) => player(page, id).locator('video');

/** The layer the page lays over the playing feed video to take its clicks. */
const pictureOf = (page: Page) => player(page, 'playing').locator('[role=presentation]');

const timeOf = (page: Page, id: string) =>
  videoOf(page, id).evaluate((video: HTMLVideoElement) => video.currentTime);

const pausedOf = (page: Page, id: string) =>
  videoOf(page, id).evaluate((video: HTMLVideoElement) => video.paused);

/** The box of `locator`, which must be on the page. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('no box');
  }
  return box;
}

type Box = Awaited<ReturnType<typeof boxOf>>;

/** Checks that the strip is 12 pixels tall along the bottom edge of the video, `inset` pixels short of each side. */
function expectStripAt(strip: Box, video: Box, inset = 0) {
  expect(strip.height).toBeCloseTo(12, 0);
  expect(strip.y + strip.height).toBeCloseTo(video.y + video.height, 0);
  expect(strip.x).toBeCloseTo(video.x + inset, 0);
  expect(strip.width).toBeCloseTo(video.width - 2 * inset, 0);
}

/** What the page's own controls last reported being used. */
const used = (page: Page) => page.locator('body').getAttribute('data-used');

/** Opens the page and waits until the videos have a length and the first one plays. */
async function open(page: Page) {
  await page.goto(VIDEOS);
  await expect(scrubberOf(page, 'paused')).toHaveAttribute('aria-valuemax', '20');
  await expect(scrubberOf(page, 'reel')).toHaveAttribute('aria-valuemax', '20');
  await expect.poll(() => pausedOf(page, 'playing')).toBe(false);
}

test('puts a scrubber on a video that moves it when clicked or keyed', async ({ page }) => {
  await open(page);
  const scrubber = scrubberOf(page, 'paused');
  const box = await boxOf(scrubber);
  // The bar runs along the bottom edge of the video.
  const video = await boxOf(videoOf(page, 'paused'));
  expectStripAt(box, video);

  // Playwright checks that the bar, and not the layer over the video, takes the click.
  await scrubber.click({ position: { x: box.width / 2, y: box.height - 4 } });

  await expect.poll(() => timeOf(page, 'paused')).toBeCloseTo(10, 0);
  await expect(scrubber).toHaveAttribute('aria-valuetext', /^0:(?:09|10) of 0:20$/);
  await expect(page).toHaveURL(VIDEOS);
  await expect(page.locator('body')).not.toHaveAttribute('data-viewer');

  await scrubber.press('ArrowRight');
  await expect.poll(() => timeOf(page, 'paused')).toBeCloseTo(15, 0);
  await scrubber.press('Home');
  await expect.poll(() => timeOf(page, 'paused')).toBe(0);
  expect(await pausedOf(page, 'paused')).toBe(true);
});

test("keeps to the bottom edge of a feed video, under Facebook's control row", async ({ page }) => {
  await open(page);
  const controls = player(page, 'playing').locator('.controls');
  await expect(controls).toBeAttached();
  const strip = await boxOf(scrubberOf(page, 'playing'));
  const video = await boxOf(videoOf(page, 'playing'));
  expectStripAt(strip, video);

  // Playwright checks that nothing of ours lies over Facebook's controls.
  await controls.getByRole('slider').click();
  await expect.poll(() => used(page)).toBe('slider');
  await controls.getByRole('button', { name: 'Play or pause' }).click();
  await expect.poll(() => used(page)).toBe('play-pause');
  await expect.poll(() => pausedOf(page, 'playing')).toBe(true);

  await scrubberOf(page, 'playing').click({ position: { x: strip.width / 4, y: 6 } });
  await expect.poll(() => timeOf(page, 'playing')).toBeCloseTo(5, 0);
  await expect(page).toHaveURL(VIDEOS);
});

test("takes the place of a reel's position bar, which is hidden meanwhile", async ({
  page,
  store,
}) => {
  await open(page);
  const scrubber = scrubberOf(page, 'reel');
  const bar = page.locator('#reel-bar');
  // Between the ends of the page's own bar, along the bottom edge of the video.
  const strip = await boxOf(scrubber);
  const video = await boxOf(videoOf(page, 'reel'));
  expectStripAt(strip, video, 8);
  // The outermost of the elements with the bar's box.
  await expect(bar).toHaveAttribute('data-feed-sanity-hidden');
  await expect(bar).toBeHidden();

  // Over the bottom of a corner button too, as the page's bar was.
  await scrubber.click({ position: { x: 4, y: 6 } });
  await expect.poll(() => timeOf(page, 'reel')).toBeLessThan(1);
  await scrubber.click({ position: { x: strip.width / 2, y: 6 } });
  await expect.poll(() => timeOf(page, 'reel')).toBeCloseTo(10, 0);
  // The rest of each corner button still takes its clicks.
  await page.locator('#reel-back').click({ position: { x: 20, y: 4 } });
  await expect.poll(() => used(page)).toBe('reel-back');
  await page.locator('#reel-next').click({ position: { x: 20, y: 4 } });
  await expect.poll(() => used(page)).toBe('reel-next');

  await store({ [OPTIONS_KEY]: { video_scrubber: false } });

  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute('data-feed-sanity-hidden');
  await page.locator('#reel-position').click();
  await expect.poll(() => used(page)).toBe('reel-position');
});

test('keeps a video paused by a click paused until the person starts it', async ({ page }) => {
  await open(page);
  await pictureOf(page).click();
  await expect.poll(() => pausedOf(page, 'playing')).toBe(true);

  // As Facebook does when the video scrolls back into view.
  await videoOf(page, 'playing').evaluate((video: HTMLVideoElement) =>
    video.play().catch(() => undefined),
  );
  await page.waitForTimeout(300);
  expect(await pausedOf(page, 'playing')).toBe(true);

  await player(page, 'playing').getByRole('button', { name: 'Play or pause' }).click();
  await expect.poll(() => pausedOf(page, 'playing')).toBe(false);
  await page.waitForTimeout(300);
  expect(await pausedOf(page, 'playing')).toBe(false);
});

test('pauses and plays a feed video when its picture is clicked', async ({ page }) => {
  await open(page);
  const picture = pictureOf(page);

  await picture.click();
  await expect.poll(() => pausedOf(page, 'playing')).toBe(true);
  await expect(page).toHaveURL(VIDEOS);
  await expect(page.locator('body')).not.toHaveAttribute('data-viewer');

  // Later than a double click.
  await page.waitForTimeout(600);
  await picture.click();
  await expect.poll(() => pausedOf(page, 'playing')).toBe(false);
  await expect(page.locator('body')).not.toHaveAttribute('data-viewer');
});

test('lets a double click open the viewer', async ({ page }) => {
  await open(page);

  await pictureOf(page).dblclick();

  await expect(page).toHaveURL(`${ORIGIN}/watch/?v=200000000000001`);
  await expect(page.locator('body')).toHaveAttribute('data-viewer', '200000000000001');
});

test('opens the viewer as before when both video options are off', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { video_scrubber: false, video_click_pauses: false } });
  await page.goto(VIDEOS);
  await expect.poll(() => pausedOf(page, 'playing')).toBe(false);

  await pictureOf(page).click();

  await expect(page.locator('body')).toHaveAttribute('data-viewer', '200000000000001');
  await expect(page.locator('feed-sanity-ui')).toHaveCount(0);
});

test('removes the scrubber when it is switched off, without a reload', async ({ page, store }) => {
  await open(page);
  await expect(page.locator('feed-sanity-ui[data-feed-sanity]')).toHaveCount(3);

  await store({ [OPTIONS_KEY]: { video_scrubber: false } });

  await expect(page.locator('feed-sanity-ui')).toHaveCount(0);
  await store({ [OPTIONS_KEY]: { video_scrubber: true } });
  await expect(scrubberOf(page, 'paused')).toHaveAttribute('aria-valuemax', '20');
});
