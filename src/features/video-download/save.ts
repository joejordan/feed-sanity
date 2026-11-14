import { isFacebookAddress } from '../../facebook/urls';

/** How long a saved file's `blob:` address is kept, in milliseconds, so the browser can finish reading it. */
export const REVOKE_MS = 60_000;

/** How often progress is reported while a file comes in, at most, in milliseconds. */
const PROGRESS_MS = 100;

/** How much of the file has come in, in bytes. `total` is null when the server did not say. */
export type Progress = (received: number, total: number | null) => void;

/** The request for the file was refused before any answer came, as a CORS refusal is. */
export class FetchRefused extends Error {
  constructor() {
    super('the file could not be fetched from this page');
    this.name = 'FetchRefused';
  }
}

/** The file's name: `facebook-video-<ID>.mp4`, or the date and time when the video has no ID. */
export function fileName(videoId: string | null, now = new Date()): string {
  if (videoId) {
    return `facebook-video-${videoId}.mp4`;
  }
  const two = (value: number): string => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `facebook-video-${date}-${time}.mp4`;
}

/**
 * Fetches the file at `url` into a `Blob`, reporting progress as it comes.
 * Rejects with `FetchRefused` when the request gets no answer, and with an
 * error naming the status when the server answers with one. Sends no
 * cookies: the address alone gives access to the file.
 */
export async function fetchFile(
  url: string,
  signal: AbortSignal,
  progress: Progress,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { signal, credentials: 'omit' });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
    throw new FetchRefused();
  }
  if (!response.ok) {
    throw new Error(`Facebook's server answered with status ${response.status}`);
  }
  const length = Number(response.headers.get('content-length'));
  const total = Number.isFinite(length) && length > 0 ? length : null;
  const type = response.headers.get('content-type') ?? 'video/mp4';
  if (!response.body) {
    return response.blob();
  }
  let received = 0;
  let reported = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (performance.now() - reported >= PROGRESS_MS) {
          reported = performance.now();
          progress(received, total);
        }
        controller.enqueue(chunk);
      },
      flush() {
        progress(received, total);
      },
    }),
  );
  // Each chunk goes into the Blob as it comes, so the file is not held twice.
  return new Response(counted, { headers: { 'content-type': type } }).blob();
}

/**
 * Saves `blob` under `name` through a `download` link to a `blob:` address
 * of its own. Browsers honour `download` only for same-origin addresses and
 * `blob:` and `data:` ones, so a link straight to Facebook's file server
 * would open the file instead. The link goes in `parent`, this project's
 * own UI, for the moment it is clicked.
 */
export function saveBlob(blob: Blob, name: string, parent: Element): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  parent.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

/**
 * Opens one of Facebook's addresses in a new tab, with no link back to this
 * page. Does nothing for any other address.
 */
export function openInTab(url: string): void {
  if (isFacebookAddress(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * How the file was given to the person: saved, opened in a new tab, or
 * neither, because the press was too long ago for the browser to let a new
 * tab open, so the person has to press again.
 */
export type Saved = 'opened' | 'refused' | 'saved';

/**
 * Fetches the video file at `url` and saves it as `name`. When the request
 * is refused, as when the file server does not allow this page to read it,
 * opens the address in a new tab instead, where the person can save it
 * from the browser's own player, or says it could not when the press is too
 * old for a new tab. `url` must be one of Facebook's addresses.
 */
export async function saveVideo(
  url: string,
  name: string,
  { signal, progress, parent }: { signal: AbortSignal; progress: Progress; parent: Element },
): Promise<Saved> {
  if (!isFacebookAddress(url)) {
    throw new Error("the address is not one of Facebook's");
  }
  let blob: Blob;
  try {
    blob = await fetchFile(url, signal, progress);
  } catch (error) {
    if (!(error instanceof FetchRefused)) {
      throw error;
    }
    // A popup blocker stops a tab opened once the press has stopped counting
    // as one, about 5 seconds later in Chrome and 1 in Firefox. A browser
    // that cannot tell is tried anyway.
    if (navigator.userActivation?.isActive === false) {
      return 'refused';
    }
    openInTab(url);
    return 'opened';
  }
  saveBlob(blob, name, parent);
  return 'saved';
}
