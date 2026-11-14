// Helpers for the tests of the video features, shared by videos.spec.ts and
// story-viewer.spec.ts.

import type { Locator, Page } from '@playwright/test';
import { expect } from './extension';

/** The box of `locator`, which must be on the page. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('no box');
  }
  return box;
}

type Box = Awaited<ReturnType<typeof boxOf>>;

/** Checks that the strip is 12 pixels tall along the bottom edge of the video, `inset` pixels short of each side. */
export function expectStripAt(strip: Box, video: Box, inset = 0) {
  expect(strip.height).toBeCloseTo(12, 0);
  expect(strip.y + strip.height).toBeCloseTo(video.y + video.height, 0);
  expect(strip.x).toBeCloseTo(video.x + inset, 0);
  expect(strip.width).toBeCloseTo(video.width - 2 * inset, 0);
}

/** The attribute this project puts on an element of Facebook's while it stands in for it. */
export const STOOD_IN_FOR = 'data-feed-sanity-hidden';

/** What the page's own controls last reported being used. */
export const used = (page: Page) => page.locator('body').getAttribute('data-used');

export const currentTime = (video: Locator) =>
  video.evaluate((element: HTMLVideoElement) => element.currentTime);

export const isPaused = (video: Locator) =>
  video.evaluate((element: HTMLVideoElement) => element.paused);
