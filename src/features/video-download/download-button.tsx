import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { BridgeStatus } from '../../core/bridge';
import type { VideoSources } from '../../facebook/video-sources';
import type { Watched } from '../../ui/watched';
import type { ButtonPlace } from './layout';
import { BridgeError } from '../../core/bridge';
import { messageOf } from '../../core/log';
import { samePlace } from './layout';
import { fileName, openInTab, saveVideo } from './save';

/** How long a message stays under the button, in milliseconds. */
export const MESSAGE_MS = 6000;

/** How long the pointer rests on the button before its tooltip shows, in milliseconds. */
export const TIP_DELAY_MS = 300;

export const SAVE_NAME = 'Save video';
export const STOP_NAME = 'Stop saving the video';

export const UNAVAILABLE =
  "Videos cannot be saved here: Feed Sanity could not reach the page's video data.";
export const NOT_YET =
  'This video cannot be saved yet. Facebook sends it as separate streams of sound and picture, and only videos that come as one file can be saved.';
export const NO_FILE = 'No file was found for this video, so it cannot be saved.';
export const OPENED =
  'The file could not be fetched from this page, so it opened in a new tab. Save it from there.';
export const PRESS_AGAIN =
  'The file could not be fetched from this page. Press the button again to open it in a new tab, and save it from there.';
export const STOPPED = 'Saving stopped.';
export const NO_ANSWER = "The page did not say where this video's file is. Try again.";

/**
 * What is known of the video's files: nothing yet, a file to save, only a
 * manifest, or nothing at all.
 */
type Files = 'file' | 'manifest' | 'none' | 'unknown';

const filesOf = (sources: VideoSources | null): Files => {
  if (sources?.file) {
    return 'file';
  }
  return sources?.manifest ? 'manifest' : 'none';
};

/** Why the video cannot be saved, or null when it may be. */
function reasonOf(bridge: BridgeStatus, files: Files): string | null {
  if (bridge.state === 'unavailable') {
    return UNAVAILABLE;
  }
  if (files === 'manifest') {
    return NOT_YET;
  }
  return files === 'none' ? NO_FILE : null;
}

/**
 * What the button is doing: nothing, saving, or showing a message under it.
 * A message can hold an address that the next press opens in a new tab.
 */
type Job =
  | { kind: 'idle' }
  | { kind: 'saving'; received: number; total: number | null }
  | { kind: 'said'; text: string; open?: string };

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

function progressText(received: number, total: number | null): string {
  if (total === null) {
    return received > 0 ? `Saving: ${megabytes(received)}` : 'Saving';
  }
  return `Saving: ${Math.floor((received / total) * 100)}%`;
}

/** What went wrong, for a save that was not stopped by the person. */
function failureText(error: unknown): string {
  if (error instanceof BridgeError) {
    return error.failure === 'unavailable' ? UNAVAILABLE : NO_ANSWER;
  }
  return `The video could not be saved: ${messageOf(error)}.`;
}

function useDuration(video: HTMLVideoElement): number {
  const [duration, setDuration] = useState(video.duration);
  useEffect(() => {
    const update = (): void => setDuration(video.duration);
    video.addEventListener('durationchange', update);
    video.addEventListener('emptied', update);
    update();
    return () => {
      video.removeEventListener('durationchange', update);
      video.removeEventListener('emptied', update);
    };
  }, [video]);
  return duration;
}

/** True while the pointer is over `container`, which holds the video and everything Facebook lays over it. */
function usePointerOver(container: Element | null, onEnter: () => void): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!container) {
      return;
    }
    const enter = (): void => {
      setOver(true);
      onEnter();
    };
    const leave = (): void => setOver(false);
    container.addEventListener('pointerenter', enter);
    container.addEventListener('pointerleave', leave);
    return () => {
      container.removeEventListener('pointerenter', enter);
      container.removeEventListener('pointerleave', leave);
      setOver(false);
    };
  }, [container, onEnter]);
  return over;
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5M5 20h14" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** Where the button goes, and what the pointer has to be over for it to show. Both are measured together. */
export interface Placement {
  /** Null when there is no room for the button, or before it is first measured. */
  readonly button: ButtonPlace | null;
  /** The video's container, which holds the video and everything Facebook lays over it. */
  readonly container: Element | null;
}

export const samePlacement = (a: Placement, b: Placement): boolean =>
  samePlace(a.button, b.button) && a.container === b.container;

export interface DownloadButtonProps {
  video: HTMLVideoElement;
  placement: Watched<Placement>;
  bridge: Watched<BridgeStatus>;
  /** Asks the page for the video's files. */
  sources: (signal: AbortSignal) => Promise<VideoSources | null>;
  /** Called when the pointer comes over the video, to measure the button's place again. */
  onShow: () => void;
}

/**
 * True when `element` has focus from the keyboard. A browser without
 * `:focus-visible` counts every focus.
 */
function focusedByKeyboard(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Shows and hides the button's tooltip: after a short rest of the pointer, or at once on keyboard focus. */
function useTip(): [boolean, (show: boolean, delay?: number) => void] {
  const [tip, setTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = useCallback((show: boolean, delay = 0) => {
    clearTimeout(timer.current);
    if (show && delay > 0) {
      timer.current = setTimeout(() => setTip(true), delay);
    } else {
      setTip(show);
    }
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [tip, set];
}

/**
 * A button in the video's top left corner that saves the video's file. It
 * shows while the pointer is over the video, while it has focus, and while
 * it is saving or has something to say. Its tooltip, made to look like
 * those of Facebook's player controls, gives its name; a progress or
 * message bubble takes the tooltip's place.
 *
 * When it first shows on a video, it asks the page what files the video
 * has, so a video that cannot be saved has its button marked as such before
 * it is pressed. A press asks again, since Facebook's addresses expire, then
 * fetches the high definition file, or else the standard one, and saves it.
 * A second press while saving stops it. A live video gets no button.
 */
export function DownloadButton({
  video,
  placement: placementSource,
  bridge: bridgeSource,
  sources,
  onShow,
}: DownloadButtonProps) {
  const id = useId();
  const { button: place, container } = useSyncExternalStore(
    placementSource.subscribe,
    placementSource.get,
  );
  const bridge = useSyncExternalStore(bridgeSource.subscribe, bridgeSource.get);
  const duration = useDuration(video);
  const over = usePointerOver(container, onShow);
  const [focused, setFocused] = useState(false);
  const [files, setFiles] = useState<Files>('unknown');
  const [job, setJob] = useState<Job>({ kind: 'idle' });
  const [tip, setTip] = useTip();
  const saving = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const shown = over || focused || job.kind !== 'idle';

  // Facebook can give the element another video, whose files are not known.
  useEffect(() => {
    const reset = (): void => setFiles('unknown');
    video.addEventListener('emptied', reset);
    return () => video.removeEventListener('emptied', reset);
  }, [video]);

  // The first time the button shows for this video, find out whether it can be saved.
  useEffect(() => {
    if (!shown || files !== 'unknown' || bridge.state === 'unavailable') {
      return;
    }
    const controller = new AbortController();
    sources(controller.signal).then(
      (found) => setFiles(filesOf(found)),
      () => {
        // A press asks again and says what went wrong.
      },
    );
    return () => controller.abort();
  }, [shown, files, bridge.state, sources]);

  // A message goes after a while.
  useEffect(() => {
    if (job.kind !== 'said') {
      return;
    }
    const timer = setTimeout(() => setJob({ kind: 'idle' }), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [job]);

  // Saving stops when the button goes, as when the feature is switched off.
  useEffect(() => () => saving.current?.abort(), []);

  if (place === null || duration === Number.POSITIVE_INFINITY) {
    return null;
  }

  const reason = reasonOf(bridge, files);

  const save = async (controller: AbortController, parent: Element): Promise<void> => {
    setJob({ kind: 'saving', received: 0, total: null });
    try {
      const found = await sources(controller.signal);
      const now = filesOf(found);
      setFiles(now);
      if (!found?.file) {
        setJob({ kind: 'said', text: now === 'manifest' ? NOT_YET : NO_FILE });
        return;
      }
      const name = fileName(found.videoId);
      const saved = await saveVideo(found.file, name, {
        signal: controller.signal,
        progress: (received, total) => setJob({ kind: 'saving', received, total }),
        parent,
      });
      if (saved === 'refused') {
        setJob({ kind: 'said', text: PRESS_AGAIN, open: found.file });
      } else {
        setJob({ kind: 'said', text: saved === 'saved' ? `Saved as ${name}.` : OPENED });
      }
    } catch (error) {
      setJob({ kind: 'said', text: controller.signal.aborted ? STOPPED : failureText(error) });
    } finally {
      if (saving.current === controller) {
        saving.current = null;
      }
    }
  };

  const press = (): void => {
    setTip(false);
    if (saving.current) {
      saving.current.abort();
      return;
    }
    // A fresh press, so the browser lets the tab open.
    if (job.kind === 'said' && job.open) {
      openInTab(job.open);
      setJob({ kind: 'said', text: OPENED });
      return;
    }
    // What the first look found may be out of date, so only an unavailable
    // bridge stops a press. `save` asks again and says why it cannot save.
    if (bridge.state === 'unavailable') {
      setJob({ kind: 'said', text: UNAVAILABLE });
      return;
    }
    if (!root.current) {
      return;
    }
    const controller = new AbortController();
    saving.current = controller;
    void save(controller, root.current);
  };

  const busy = job.kind === 'saving';
  const done = busy && job.total ? job.received / job.total : 0;
  const name = busy ? STOP_NAME : SAVE_NAME;
  const tipShown = tip && shown && job.kind === 'idle' && place.tip !== null;
  const blocked = reason !== null && !busy;
  return (
    <div
      ref={root}
      className={shown ? 'save shown' : 'save'}
      style={{ left: `${place.left}px`, top: `${place.top}px` }}
    >
      <button
        type="button"
        className={busy ? 'button busy' : 'button'}
        aria-label={name}
        aria-disabled={blocked || undefined}
        aria-describedby={blocked ? `${id}-reason` : undefined}
        onClick={press}
        onPointerEnter={() => setTip(true, TIP_DELAY_MS)}
        onPointerLeave={() => setTip(false)}
        onPointerDown={() => setTip(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setTip(false);
          }
        }}
        onFocus={(event) => {
          setFocused(true);
          if (focusedByKeyboard(event.currentTarget)) {
            setTip(true);
          }
        }}
        onBlur={() => {
          setFocused(false);
          setTip(false);
        }}
      >
        {busy && (
          <span
            className="ring"
            style={{ background: `conic-gradient(var(--fs-accent) ${done}turn, transparent 0)` }}
          />
        )}
        {busy ? <StopIcon /> : <DownloadIcon />}
      </button>
      {tipShown && (
        <div className={`tip ${place.tip}`} role="tooltip">
          {name}
        </div>
      )}
      {reason !== null && (
        <span id={`${id}-reason`} hidden>
          {reason}
        </span>
      )}
      {busy && <div className="bubble">{progressText(job.received, job.total)}</div>}
      <div className="bubble" role="status" hidden={job.kind !== 'said'}>
        {job.kind === 'said' ? job.text : ''}
      </div>
    </div>
  );
}
