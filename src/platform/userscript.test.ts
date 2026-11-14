import pageWorldScript from 'virtual:page-world-script';
import { describe, expect, it, vi } from 'vitest';
import { PageBridge } from '../core/bridge';
import { runInPage } from './page-script';
import { userscriptPlatform } from './userscript';

// happy-dom does not load scripts from blob: addresses, so the script runs here instead.
vi.mock('./page-script', () => ({
  runInPage: vi.fn((code: string) => {
    new Function(code)();
    return Promise.resolve();
  }),
}));

describe('userscriptPlatform', () => {
  it('calls itself the userscript', () => {
    expect(userscriptPlatform.build).toBe('userscript');
  });

  it('has no badge to set, and does not complain about it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => userscriptPlatform.setBadge({ count: 3, failed: true })).not.toThrow();

    expect(error).not.toHaveBeenCalled();
  });

  it('adds the page-world side, built into one script, and the bridge connects to it', async () => {
    const before = Object.getOwnPropertyNames(globalThis);
    const bridge = new PageBridge(() => userscriptPlatform.installPageWorld());
    const video = document.createElement('video');
    document.body.append(video);
    Object.assign(video, {
      '__reactFiber$us': {
        return: {
          memoizedProps: {
            implementations: [{ data: { sdSrc: 'https://video.xx.fbcdn.net/sd.mp4' } }],
            coreVideoPlayerMetaData: { videoFBID: '5' },
          },
        },
      },
    });

    expect(await bridge.ask(video, 'video-sources')).toEqual({
      hdSrc: null,
      sdSrc: 'https://video.xx.fbcdn.net/sd.mp4',
      manifest: false,
      videoId: '5',
    });
    expect(runInPage).toHaveBeenCalledExactlyOnceWith(pageWorldScript);
    // The script is one function that runs at once and defines no global.
    expect(pageWorldScript).toMatch(/^\(function\(\) \{/);
    expect(Object.getOwnPropertyNames(globalThis)).toEqual(before);
    video.remove();
  });
});
