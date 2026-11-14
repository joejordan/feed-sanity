import { describe, expect, it, vi } from 'vitest';
import { isFacebookAddress } from './urls';
import { checkVideoSources, videoSources } from './video-sources';

const HD = 'https://video.xx.fbcdn.net/v/t42/hd.mp4?oe=1';
const SD = 'https://scontent.fbcdn.net/v/t42/sd.mp4';

describe('isFacebookAddress', () => {
  it("takes https addresses on Facebook's domains and their subdomains", () => {
    for (const address of [
      HD,
      SD,
      'https://fbcdn.net/x',
      'https://facebook.com/x',
      'https://www.facebook.com/x.mpd',
    ]) {
      expect(isFacebookAddress(address), address).toBe(true);
    }
  });

  it('refuses every other address', () => {
    for (const address of [
      'http://video.xx.fbcdn.net/v.mp4',
      'https://fbcdn.net.example.com/v.mp4',
      'https://evilfbcdn.net/v.mp4',
      'https://example.com/?u=https://video.fbcdn.net/v.mp4',
      'https://user:secret@video.fbcdn.net/v.mp4',
      'https://video.fbcdn.net:8443/v.mp4',
      'javascript:alert(1)//fbcdn.net',
      'blob:https://www.facebook.com/1234',
      'data:video/mp4;base64,AAAA',
      '//video.fbcdn.net/v.mp4',
      'not an address',
      `https://video.fbcdn.net/${'a'.repeat(5000)}`,
    ]) {
      expect(isFacebookAddress(address), address).toBe(false);
    }
  });
});

describe('checkVideoSources', () => {
  it('takes the high definition file first, then the standard one', () => {
    expect(checkVideoSources({ hdSrc: HD, sdSrc: SD, manifest: true, videoId: '42' })).toEqual({
      file: HD,
      quality: 'hd',
      manifest: true,
      videoId: '42',
    });
    expect(checkVideoSources({ hdSrc: null, sdSrc: SD })).toMatchObject({
      file: SD,
      quality: 'sd',
    });
  });

  it("drops an address that is not one of Facebook's, and falls back to the other file", () => {
    expect(checkVideoSources({ hdSrc: 'https://example.com/hd.mp4', sdSrc: SD })).toMatchObject({
      file: SD,
      quality: 'sd',
    });
    expect(checkVideoSources({ hdSrc: 'http://video.fbcdn.net/hd.mp4' })).toMatchObject({
      file: null,
      quality: null,
    });
  });

  it('leaves out fields of the wrong shape', () => {
    expect(
      checkVideoSources({ hdSrc: ['x'], sdSrc: 7, manifest: 'yes', videoId: '12; drop table' }),
    ).toEqual({ file: null, quality: null, manifest: false, videoId: null });
  });

  it('gives null when the reader found no player', () => {
    for (const answer of [null, undefined, 'x', 3]) {
      expect(checkVideoSources(answer)).toBeNull();
    }
  });
});

describe('videoSources', () => {
  it('asks the video-sources reader and checks the answer', async () => {
    const ask = vi.fn(() => Promise.resolve({ hdSrc: HD, videoId: '7' }));
    const video = document.createElement('video');
    const signal = new AbortController().signal;

    expect(await videoSources({ ask }, video, signal)).toMatchObject({ file: HD, videoId: '7' });
    expect(ask).toHaveBeenCalledWith(video, 'video-sources', signal);
  });
});
