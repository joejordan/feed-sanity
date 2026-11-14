// React's data, as Facebook's player keeps it on each <video>: a fiber under a
// `__reactFiber$` name with a random suffix, whose `return` chain reaches the
// player's props 12 steps up. Only a script in the page's own world sees
// these properties. The pages in e2e/pages load this file, then call
// `fakePlayerData` once their videos are in the page.

/** The file server e2e/extension.ts answers from e2e/cdn. */
const CDN = 'https://video.e2e.fbcdn.net';

const PLAYER = {
  dash: (manifestUrl) => ({
    typename: 'VideoPlayerNextgendashImplementation',
    data: { manifest: '<MPD></MPD>', manifestUrl },
  }),
  oz: () => ({ typename: 'VideoPlayerOzImplementation', data: {} }),
  progressive: (data) => ({ typename: 'VideoPlayerProgressiveImplementation', data }),
};

const suffix = Math.random().toString(36).slice(2);

/** Puts the player's props, with these implementations and this video ID, 12 fibers above `video`. */
function fakePlayerData(video, implementations, videoId) {
  let fiber = {
    memoizedProps: {
      implementations,
      coreVideoPlayerMetaData: { videoFBID: videoId, adClientToken: null },
    },
    return: null,
  };
  for (let depth = 0; depth < 12; depth++) {
    fiber = { memoizedProps: {}, return: fiber };
  }
  video[`__reactFiber$${suffix}`] = fiber;
  video[`__reactProps$${suffix}`] = {};
}

// For the pages' own scripts, which run after this one.
Object.assign(globalThis, { CDN, PLAYER, fakePlayerData });
