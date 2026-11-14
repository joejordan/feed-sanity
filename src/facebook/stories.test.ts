import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FakeStory } from './testing';
import {
  storyBottomStrip,
  storyCardOf,
  storyHeaderOf,
  storyMenuOpen,
  storyPauseButton,
} from './stories';
import { addStory, fakeLocate, placeAt } from './testing';

describe('stories', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  it('finds the story card a picture is in, on a stories page only', () => {
    const { card, video, part } = addStory();

    expect(storyCardOf(video as HTMLVideoElement, fakeLocate)).toBe(card);
    expect(storyCardOf(part('avatar'), fakeLocate)).toBe(card);
    // The header's buttons on the right are not in the card.
    expect(storyCardOf(part('menu'), fakeLocate)).toBeNull();

    history.replaceState({}, '', '/watch/');
    expect(storyCardOf(video as HTMLVideoElement, fakeLocate)).toBeNull();
  });

  it("finds the header's menu button outside the card, and the pause button left of it", () => {
    const { card, part } = addStory();

    const header = storyHeaderOf(card, fakeLocate);
    expect(header?.root).toBe(part('stage'));
    expect(header?.menu).toBe(part('menu'));
    expect(storyPauseButton(card, fakeLocate)).toBe(part('pause'));
  });

  it('finds the pause button of a photo story too', () => {
    const { card, part } = addStory({ photo: true });

    expect(storyPauseButton(card, fakeLocate)).toBe(part('pause'));
  });

  it("tells whether the story's menu is open", () => {
    const { card, part } = addStory();
    expect(storyMenuOpen(card, fakeLocate)).toBe(false);

    part('menu').setAttribute('aria-expanded', 'true');

    expect(storyMenuOpen(card, fakeLocate)).toBe(true);
  });

  it('takes no element with an ID for a story card unless the picture layer is its child', () => {
    const { card, part } = addStory();
    part('frame').closest('[data-pagelet]')?.removeAttribute('data-pagelet');

    expect(storyCardOf(part('frame'), fakeLocate)).toBeNull();
    expect(card.hasAttribute('data-id')).toBe(true);
  });

  it("finds Facebook's empty strip that takes the pointer along the video's bottom edge", () => {
    const { card, video, part } = addStory();
    // The caption band, also empty and along the bottom, lets the pointer through.
    placeAt(part('caption'), 100, 610, 356, 23);
    part('caption').style.pointerEvents = 'none';

    expect(storyBottomStrip(card, video as Element, fakeLocate)).toBe(part('strip'));
  });

  it.each<[string, (strip: HTMLElement, story: FakeStory) => void]>([
    ['lets the pointer through', (strip) => strip.style.setProperty('pointer-events', 'none')],
    ['lies off the bottom edge', (strip) => placeAt(strip, 100, 300, 356, 12)],
    ['is too tall', (strip) => placeAt(strip, 100, 593, 356, 40)],
    ['is less than half as wide', (strip) => placeAt(strip, 100, 621, 170, 12)],
    ['holds something', (strip) => strip.append(document.createElement('span'))],
    ["is not the card's own", (strip, { part }) => part('frame').append(strip)],
  ])('takes no strip that %s', (_, change) => {
    const story = addStory();
    change(story.part('strip'), story);

    expect(storyBottomStrip(story.card, story.video as Element, fakeLocate)).toBeNull();
  });

  it('finds no pause button where none is just left of the menu button', () => {
    const { card } = addStory({ pause: false });

    expect(storyPauseButton(card, fakeLocate)).toBeNull();
  });

  it("finds no header when the menu button is not over the card's top, even after finding it there", () => {
    const { card, part } = addStory();
    expect(storyHeaderOf(card, fakeLocate)).not.toBeNull();
    placeAt(part('menu'), 420, 400, 32, 24);

    expect(storyHeaderOf(card, fakeLocate)).toBeNull();
    expect(storyPauseButton(card, fakeLocate)).toBeNull();
  });
});
