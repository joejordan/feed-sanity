/** A console logger that tags each line with the part of the extension it came from. */
export interface Logger {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(scope: string): Logger {
  const tag = `[feed-sanity:${scope}]`;
  return {
    debug: (...args) => console.debug(tag, ...args),
    error: (...args) => console.error(tag, ...args),
  };
}
