import { describe, expect, it } from 'vitest';
import {
  MAX_FEED_UNIT_DEPTH,
  MAX_FIBER_DEPTH,
  MAX_IMPLEMENTATIONS,
  PAGE_READERS,
  POST_SPONSORED,
  readPostSponsored,
  readVideoSources,
  VIDEO_SOURCES,
} from './react-readers';
import { giveFeedUnit } from './testing';

const HD = 'https://video.xx.fbcdn.net/v/t42/hd.mp4?oe=1';
const SD = 'https://video.xx.fbcdn.net/v/t42/sd.mp4?oe=1';

/**
 * A `<video>` whose React fiber has the player's props `depth` steps up,
 * as Facebook's did 12 steps up on 2026-11-14.
 */
function videoWith(props: unknown, depth = 12, key = '__reactFiber$abc123'): HTMLVideoElement {
  let fiber: Record<string, unknown> = { memoizedProps: props, return: null };
  for (let step = 0; step < depth; step++) {
    fiber = { memoizedProps: { className: `level-${step}` }, return: fiber };
  }
  const video = document.createElement('video');
  Object.assign(video, { [key]: fiber, '__reactProps$abc123': {} });
  return video;
}

const progressive = (data: Record<string, unknown>) => ({
  typename: 'VideoPlayerProgressiveImplementation',
  data,
});

const dash = {
  typename: 'VideoPlayerNextgendashImplementation',
  data: { manifest: '<MPD></MPD>', manifestUrl: 'https://www.facebook.com/x.mpd' },
};

describe('readVideoSources', () => {
  it('reads the progressive files, the manifest and the ID from the player 12 steps up', () => {
    const video = videoWith({
      implementations: [dash, progressive({ hdSrc: HD, sdSrc: SD })],
      coreVideoPlayerMetaData: { videoFBID: '200000000000001', adClientToken: 'x' },
    });

    expect(readVideoSources(video)).toEqual({
      hdSrc: HD,
      sdSrc: SD,
      manifest: true,
      videoId: '200000000000001',
    });
  });

  it('finds the progressive files by their fields wherever they are in the list', () => {
    const video = videoWith({
      implementations: [
        { typename: 'VideoPlayerOzImplementation', data: { manifestUrl: 'https://x.mpd' } },
        dash,
        { typename: 'SomethingNew', data: { sdSrc: SD } },
      ],
    });

    expect(readVideoSources(video)).toMatchObject({ hdSrc: null, sdSrc: SD, manifest: true });
  });

  it('says when there is only a manifest', () => {
    expect(readVideoSources(videoWith({ implementations: [dash] }))).toEqual({
      hdSrc: null,
      sdSrc: null,
      manifest: true,
      videoId: null,
    });
  });

  it('finds the player at any depth up to its limit, and not beyond', () => {
    const props = { implementations: [progressive({ hdSrc: HD })] };

    expect(readVideoSources(videoWith(props, 0))?.hdSrc).toBe(HD);
    expect(readVideoSources(videoWith(props, MAX_FIBER_DEPTH))?.hdSrc).toBe(HD);
    expect(readVideoSources(videoWith(props, MAX_FIBER_DEPTH + 1))).toBeNull();
  });

  it(`looks at no more than ${MAX_IMPLEMENTATIONS} implementations`, () => {
    const filler = Array.from({ length: MAX_IMPLEMENTATIONS }, () => ({ data: {} }));

    const video = videoWith({ implementations: [...filler, progressive({ hdSrc: HD })] });

    expect(readVideoSources(video)).toMatchObject({ hdSrc: null, sdSrc: null });
  });

  it('gives null for an element React keeps nothing on', () => {
    expect(readVideoSources(document.createElement('video'))).toBeNull();
    expect(readVideoSources(videoWith({ implementations: [] }, 2, '__reactProps$abc'))).toBeNull();
  });

  it('gives null when no fiber holds a list of implementations', () => {
    expect(readVideoSources(videoWith({ implementations: 'none' }))).toBeNull();
    expect(readVideoSources(videoWith(null))).toBeNull();
  });

  it('leaves out fields of the wrong type, and stops at a loop in the fibers', () => {
    const video = videoWith({
      implementations: [
        null,
        'x',
        { data: 'x' },
        progressive({ hdSrc: 42, sdSrc: '', manifest: {} }),
      ],
      coreVideoPlayerMetaData: { videoFBID: 200_000_000_000_001 },
    });
    const looped: Record<string, unknown> = { memoizedProps: {} };
    looped.return = looped;
    const loop = document.createElement('video');
    Object.assign(loop, { '__reactFiber$x': looped });

    expect(readVideoSources(video)).toEqual({
      hdSrc: null,
      sdSrc: null,
      manifest: false,
      videoId: null,
    });
    expect(readVideoSources(loop)).toBeNull();
  });

  it('is offered to the page-world side by name', () => {
    expect(PAGE_READERS[VIDEO_SOURCES]).toBe(readVideoSources);
  });
});

/** A feed post whose React fiber has `feedUnit` in its props `depth` steps up. */
const postWith = (feedUnit: unknown, depth = 4): HTMLElement =>
  giveFeedUnit(document.createElement('div'), feedUnit, depth);

const story = (sponsored: unknown) => ({
  __typename: 'Story',
  id: 'x',
  sponsored_data: sponsored,
  feedback: { associated_group: null },
});

describe('readPostSponsored', () => {
  it('says an ad is sponsored', () => {
    const ad = postWith(story({ ad_id: '6000000000001', client_token: 'token' }));
    expect(readPostSponsored(ad)).toEqual({ sponsored: true });
  });

  it('says ordinary and suggested posts are not', () => {
    expect(readPostSponsored(postWith(story(null)))).toEqual({ sponsored: false });
    const group = { ...story(null), feedback: { associated_group: { id: '1' } } };
    expect(readPostSponsored(postWith(group))).toEqual({ sponsored: false });
  });

  it('finds the feed unit at any depth up to its limit, and not beyond', () => {
    const unit = story({ ad_id: '1' });

    expect(readPostSponsored(postWith(unit, 0))).toEqual({ sponsored: true });
    expect(readPostSponsored(postWith(unit, MAX_FEED_UNIT_DEPTH))).toEqual({ sponsored: true });
    expect(readPostSponsored(postWith(unit, MAX_FEED_UNIT_DEPTH + 1))).toBeNull();
  });

  it('gives null when there is no feed unit of the right shape', () => {
    expect(readPostSponsored(document.createElement('div'))).toBeNull();
    expect(readPostSponsored(postWith(null))).toBeNull();
    expect(readPostSponsored(postWith('Story'))).toBeNull();
    expect(readPostSponsored(postWith({ __typename: 'Story' }))).toBeNull();
  });

  it('reads anything but an object as not sponsored', () => {
    for (const value of [undefined, 'yes', 1, true]) {
      expect(readPostSponsored(postWith(story(value)))).toEqual({ sponsored: false });
    }
  });

  it('is offered to the page-world side by name', () => {
    expect(PAGE_READERS[POST_SPONSORED]).toBe(readPostSponsored);
  });
});
