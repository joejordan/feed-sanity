import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFacebookAddress } from '../../facebook/urls';
import { FetchRefused, fetchFile, fileName, REVOKE_MS, saveBlob, saveVideo } from './save';

const FILE = 'https://video.xx.fbcdn.net/v/t42/hd.mp4?oe=1';

/** A response whose body comes in these chunks. */
function streamed(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { headers });
}

describe('fileName', () => {
  it("names the file after the video's ID", () => {
    expect(fileName('200000000000001')).toBe('facebook-video-200000000000001.mp4');
  });

  it('names it after the date and time when the video has no ID', () => {
    expect(fileName(null, new Date(2026, 10, 14, 9, 5, 7))).toBe(
      'facebook-video-2026-11-14-090507.mp4',
    );
  });
});

describe('fetchFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the file with no cookies and reports how much has come in', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        streamed(['abc', 'de'], { 'content-length': '5', 'content-type': 'video/mp4' }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const progress = vi.fn();
    const signal = new AbortController().signal;

    const blob = await fetchFile(FILE, signal, progress);

    expect(await blob.text()).toBe('abcde');
    expect(blob.type).toBe('video/mp4');
    expect(fetch).toHaveBeenCalledWith(FILE, { signal, credentials: 'omit' });
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('reports no total when the server gives no length', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(streamed(['abc'])));
    const progress = vi.fn();

    await fetchFile(FILE, new AbortController().signal, progress);

    expect(progress).toHaveBeenLastCalledWith(3, null);
  });

  it('names the status when the server refuses the file', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));

    await expect(fetchFile(FILE, new AbortController().signal, vi.fn())).rejects.toThrow(
      "Facebook's server answered with status 403",
    );
  });

  it('tells a request that got no answer, as a CORS refusal, from one that was stopped', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(fetchFile(FILE, new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(
      FetchRefused,
    );

    const controller = new AbortController();
    controller.abort();
    const stopped = new DOMException('stopped', 'AbortError');
    vi.stubGlobal('fetch', () => Promise.reject(stopped));
    await expect(fetchFile(FILE, controller.signal, vi.fn())).rejects.toBe(stopped);
  });
});

describe('saveBlob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves through a download link to a blob: address of its own, then lets the address go', () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://www.facebook.com/1');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
      expect(this.parentElement).toBe(parent);
    });

    saveBlob(new Blob(['abc']), 'facebook-video-1.mp4', parent);

    expect(clicked.map((link) => [link.href, link.download])).toEqual([
      ['blob:https://www.facebook.com/1', 'facebook-video-1.mp4'],
    ]);
    expect(parent.children).toHaveLength(0);
    vi.advanceTimersByTime(REVOKE_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:https://www.facebook.com/1');
  });
});

describe('saveVideo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const options = () => ({
    signal: new AbortController().signal,
    progress: vi.fn(),
    parent: document.body,
    isAllowed: isFacebookAddress,
  });

  it('opens the address in a new tab when the file cannot be fetched from the page', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('CORS')));
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);

    expect(await saveVideo(FILE, 'v.mp4', options())).toBe('opened');
    expect(open).toHaveBeenCalledExactlyOnceWith(FILE, '_blank', 'noopener,noreferrer');
  });

  it('opens no tab once the press no longer counts, when a popup blocker would stop it', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('CORS')));
    vi.stubGlobal('navigator', { ...navigator, userActivation: { isActive: false } });
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);

    expect(await saveVideo(FILE, 'v.mp4', options())).toBe('refused');
    expect(open).not.toHaveBeenCalled();
  });

  it("fetches and opens nothing that is not one of Facebook's addresses", async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const open = vi.spyOn(globalThis, 'open');

    await expect(saveVideo('https://example.com/v.mp4', 'v.mp4', options())).rejects.toThrow(
      "the address is not one of Facebook's",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
