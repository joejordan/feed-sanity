/** A console logger that tags each line with the part of the extension it came from. */
export interface Logger {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** The message of `error`, or `error` as text when it is not an Error. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * True when `error` is the browser's expected teardown error thrown when an
 * already-open tab tries to call `browser.storage` / `browser.runtime` after
 * the extension was reloaded or updated. Downgrading these to `console.debug`
 * keeps `chrome://extensions` Errors clean of stale-tab noise.
 */
export function isContextInvalidatedError(error: unknown): boolean {
  return /\bextension context invalidated\b/i.test(messageOf(error));
}

export function createLogger(scope: string): Logger {
  const tag = `[feed-sanity:${scope}]`;
  return {
    debug: (...args) => console.debug(tag, ...args),
    error: (...args) => {
      if (args.some(isContextInvalidatedError)) {
        console.debug(tag, ...args);
        return;
      }
      console.error(tag, ...args);
    },
  };
}
