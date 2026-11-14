/**
 * A value that can change, with a way to hear when it does. It fits React's
 * `useSyncExternalStore`: `subscribe` returns a function that stops it.
 */
export interface Watched<T> {
  get: () => T;
  subscribe: (onChange: () => void) => () => void;
}
