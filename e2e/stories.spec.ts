import type { Page } from '@playwright/test';
import { expect, OPTIONS_KEY, ORIGIN, test } from './extension';

const STORIES = `${ORIGIN}/stories/`;

/** An entry in the list of stories in e2e/pages/stories/index.html, by its position. */
const entry = (page: Page, index: number) =>
  page.locator('#pause-container [role=button]').nth(index);

const video = (page: Page) => page.locator('#story video');

const paused = (page: Page) => video(page).evaluate((element: HTMLVideoElement) => element.paused);

/** How often the story has paused since the page loaded. */
const pauses = async (page: Page) =>
  Number((await page.locator('body').getAttribute('data-pauses')) ?? 0);

/** What the page asked of the story, in order: `pause` or `play`. */
const requests = (page: Page) => page.locator('body').getAttribute('data-requests');

/**
 * True once the extension answers a pointer coming onto the list's heading
 * with a `mouseout` to the element around the list. The heading is outside
 * the wrapper that pauses, so the page takes no notice.
 */
const answers = (page: Page) =>
  page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('#heading');
    const around = document.querySelector('#pane');
    let answered = false;
    const heard = (event: MouseEvent): void => {
      answered ||= event.relatedTarget === around;
    };
    heading?.addEventListener('mouseout', heard);
    heading?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    heading?.removeEventListener('mouseout', heard);
    return answered;
  });

/**
 * Opens the page and waits until the story plays and the feature has
 * started, which can come later, with the pointer over the story.
 */
async function open(page: Page) {
  await page.goto(STORIES);
  await expect.poll(() => paused(page)).toBe(false);
  await expect.poll(() => answers(page)).toBe(true);
  await video(page).hover();
}

/** Gives the page a moment to act on what it was asked. */
const settle = (page: Page) => page.waitForTimeout(300);

test('keeps a story playing while the pointer is over the list of stories', async ({ page }) => {
  await open(page);

  await entry(page, 0).hover();
  await settle(page);
  // The page asked for a pause and took it back in the same moment.
  expect(await requests(page)).toBe('pause play');
  expect(await paused(page)).toBe(false);

  await entry(page, 1).hover();
  await entry(page, 2).hover();
  await page.locator('#heading').hover();
  // The heading is in the list but outside the wrapper that pauses.
  await entry(page, 0).hover();
  await settle(page);
  expect(await paused(page)).toBe(false);

  await video(page).hover();
  await entry(page, 0).hover();
  await settle(page);
  expect(await paused(page)).toBe(false);
  expect(await pauses(page)).toBe(0);
});

test('keeps a story playing after keyboard focus moves into the list', async ({ page }) => {
  await open(page);
  await page.locator('#menu').focus();

  await page.keyboard.press('Tab');
  await expect(entry(page, 0)).toBeFocused();
  await settle(page);
  expect(await paused(page)).toBe(false);

  await page.keyboard.press('Tab');
  await expect(entry(page, 1)).toBeFocused();
  await settle(page);
  expect(await paused(page)).toBe(false);
  expect(await requests(page)).toMatch(/^pause play/);
  expect(await pauses(page)).toBe(0);
});

test('lets the page pause the story over the list once switched off, without a reload', async ({
  page,
  store,
}) => {
  await open(page);
  await store({ [OPTIONS_KEY]: { stories_keep_playing: false } });
  await expect.poll(() => answers(page)).toBe(false);

  await entry(page, 0).hover();
  await expect.poll(() => paused(page)).toBe(true);

  await video(page).hover();
  await expect.poll(() => paused(page)).toBe(false);
  await page.locator('#menu').focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => paused(page)).toBe(true);
});
