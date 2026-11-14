import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, OPTIONS_KEY, ORIGIN, test } from './extension';
import { boxOf, currentTime, expectStripAt, isPaused, STOOD_IN_FOR, used } from './media';

const STORIES = `${ORIGIN}/story-viewer/`;

/** One of the two stories in e2e/pages/story-viewer/index.html: `video` or `photo`. */
const viewer = (page: Page, kind: string) => page.locator(`#${kind}-viewer`);

const cardOf = (page: Page, kind: string) => viewer(page, kind).locator('[data-id]');

const videoOf = (page: Page) => viewer(page, 'video').locator('video');

/** Whether the page's own timer for this story is running: `playing` or `paused`. */
const stateOf = (page: Page, kind: string) => viewer(page, kind).getAttribute('data-state');

const progressOf = async (page: Page, kind: string) =>
  Number(await viewer(page, kind).getAttribute('data-progress'));

const timeOf = (page: Page) => currentTime(videoOf(page));

const pausedOf = (page: Page) => isPaused(videoOf(page));

/** Opens the stories page and waits until the video story plays and has its scrubber. */
async function open(page: Page) {
  await page.goto(STORIES);
  await expect(page).toHaveURL(/\/stories\/100000000000077\//);
  await expect(
    viewer(page, 'video').getByRole('slider', { name: 'Video position' }),
  ).toHaveAttribute('aria-valuemax', '20');
  await expect.poll(() => pausedOf(page)).toBe(false);
}

test("puts the overlays last in the story's card, and its scrubber moves the video", async ({
  page,
}) => {
  await open(page);
  const card = cardOf(page, 'video');
  // Above Facebook's layers, the invisible strip over the bottom 12 pixels among them.
  await expect(card.locator(':scope > feed-sanity-ui')).toHaveCount(2);
  const scrubber = viewer(page, 'video').getByRole('slider', { name: 'Video position' });
  const strip = await boxOf(scrubber);
  const video = await boxOf(videoOf(page));
  expectStripAt(strip, video);

  // Playwright checks that the scrubber, and not the page's strip, takes the click.
  await scrubber.click({ position: { x: strip.width / 2, y: 6 } });

  await expect.poll(() => timeOf(page)).toBeGreaterThan(9);
  expect(await timeOf(page)).toBeLessThan(13);
  // The press went to the scrubber alone: no tap zone moved the story.
  expect(await used(page)).toBeNull();
});

test("stands in for the story's strip over the bottom edge while the scrubber shows", async ({
  page,
  store,
}) => {
  await open(page);
  const strip = cardOf(page, 'video').locator('.strip');
  await expect(strip).toHaveAttribute(STOOD_IN_FOR);
  await expect(strip).toBeHidden();
  // A photo story has no scrubber, so its strip stays.
  const photoStrip = cardOf(page, 'photo').locator('.strip');
  await expect(photoStrip).toBeVisible();
  await expect(photoStrip).not.toHaveAttribute(STOOD_IN_FOR);

  await store({ [OPTIONS_KEY]: { video_scrubber: false } });

  await expect(strip).toBeVisible();
  await expect(strip).not.toHaveAttribute(STOOD_IN_FOR);
});

test("saves a story's video with a button below the story's header", async ({ page }) => {
  await open(page);
  await cardOf(page, 'video').hover({ position: { x: 178, y: 450 } });
  const button = viewer(page, 'video').getByRole('button', { name: 'Save video' });
  await expect(viewer(page, 'video').locator('.save')).toHaveClass(/shown/);
  const box = await boxOf(button);
  const video = await boxOf(videoOf(page));
  // At the left, under the avatar, which ends 68 pixels down.
  expect([box.x - video.x, box.y - video.y, box.width]).toEqual([8, 72, 40]);
  await button.hover();
  await expect(viewer(page, 'video').getByRole('tooltip')).toHaveText('Save video');

  const download = page.waitForEvent('download');
  await button.click();

  const file = await download;
  expect(file.suggestedFilename()).toBe('facebook-video-900000000000011.mp4');
  const saved = readFileSync(await file.path());
  expect(saved.equals(readFileSync(path.join(import.meta.dirname, 'cdn', 'clip.mp4')))).toBe(true);
  expect(await stateOf(page, 'video')).toBe('playing');
});

for (const kind of ['video', 'photo']) {
  test(`pauses and plays a ${kind} story with the page's own button when the story is clicked`, async ({
    page,
  }) => {
    await open(page);
    const card = cardOf(page, kind);

    await card.click({ position: { x: 60, y: 450 } });

    await expect.poll(() => stateOf(page, kind)).toBe('paused');
    expect(await used(page)).toBe('pause');
    const stopped = await progressOf(page, kind);
    await page.waitForTimeout(200);
    expect(await progressOf(page, kind)).toBe(stopped);
    if (kind === 'video') {
      expect(await pausedOf(page)).toBe(true);
    }

    // Later than a double click.
    await page.waitForTimeout(600);
    await card.click({ position: { x: 250, y: 450 } });

    await expect.poll(() => stateOf(page, kind)).toBe('playing');
    await expect.poll(() => progressOf(page, kind)).toBeGreaterThan(stopped);
    // The clicks never reached the page's tap zones.
    expect(await used(page)).toBe('pause');
  });
}

test('keeps every event of a press on the left of a story from the page, which would go back', async ({
  page,
  store,
}) => {
  await open(page);
  const card = cardOf(page, 'photo');

  await card.click({ position: { x: 30, y: 450 } });

  await expect.poll(() => stateOf(page, 'photo')).toBe('paused');
  expect(await viewer(page, 'photo').getAttribute('data-back-heard')).toBeNull();
  expect(await used(page)).toBe('pause');

  // With the option off, the page hears the whole press and goes back.
  await store({ [OPTIONS_KEY]: { video_click_pauses: false } });
  await page.waitForTimeout(100);
  await card.click({ position: { x: 30, y: 450 } });
  await expect
    .poll(() => viewer(page, 'photo').getAttribute('data-back-heard'))
    .toBe('pointerdown mousedown pointerup mouseup click');
  expect(await used(page)).toBe('tap-back');
});

test("lets the story's header, sticker, side buttons and reply box take their clicks", async ({
  page,
}) => {
  await open(page);
  const story = viewer(page, 'video');
  // Each control notes its class name when it is used.
  for (const name of ['avatar', 'info', 'sticker', 'mute', 'menu', 'next', 'previous']) {
    // Playwright checks that nothing of ours lies over the control.
    await story.locator(`.${name}`).click();
    await expect.poll(() => used(page)).toBe(name);
  }
  await story.getByRole('textbox', { name: 'Reply' }).fill('Nice');
  await expect(story.getByRole('textbox', { name: 'Reply' })).toHaveValue('Nice');
  expect(await stateOf(page, 'video')).toBe('playing');
});
