// Runs the whole project in a page without the extension or a userscript
// manager. Settings live in memory, and `__fsOpen()` opens the options
// dialog. See ../SKILL.md.
import type { Store } from '../../../../src/core/storage';
import { MARK } from '../../../../src/facebook/selectors';
import { currentUserId } from '../../../../src/facebook/user';
import { start } from '../../../../src/start';
import { HOST_TAG } from '../../../../src/ui/mount';

// The installed extension or userscript marks the same posts, and the copy
// that marks a post first keeps it. This copy then sees no posts at all.
const otherCopy = document.querySelector(`${HOST_TAG},[${MARK.post}]`) !== null;
if (otherCopy) {
  console.warn('[feed-sanity:live] another copy of Feed Sanity is already running on this page');
}

const memory = new Map<string, unknown>();
const watchers = new Map<string, Set<(before: unknown, after: unknown) => void>>();
const store: Store = {
  get: (key) => Promise.resolve(memory.get(key)),
  set: (key, value) => {
    const before = memory.get(key);
    memory.set(key, structuredClone(value));
    for (const watcher of watchers.get(key) ?? []) {
      watcher(before, value);
    }
    return Promise.resolve();
  },
  onChange: (key, listener) => {
    watchers.set(key, (watchers.get(key) ?? new Set()).add(listener));
  },
};

// Set `__fsPreset` in the page before loading the bundle to start with
// options or filters already saved.
const user = currentUserId();
const preset = (globalThis as Record<string, unknown>).__fsPreset as
  | { options?: unknown; filters?: unknown }
  | undefined;
memory.set(`${user}/options`, preset?.options ?? {});
memory.set(`${user}/filters`, preset?.filters ?? []);

let open = (): void => undefined;
void start({
  store,
  onOpenOptions: (listener) => {
    open = listener;
  },
});
Object.assign(globalThis, {
  __fsOpen: () => open(),
  __fsStore: store,
  __fsUser: user,
  __fsOtherCopy: otherCopy,
});
