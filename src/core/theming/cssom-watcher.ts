// Detects CSSOM `sheet.insertRule()` / `replaceSync()` / `adoptedStyleSheets`
// changes across both the main document and open Shadow Roots without polling
// timers by comparing lightweight CSSOM snapshots on debounced DOM additions.

import type { DomEnvironment } from '../dom-env';
import type { RootCssomSnapshot } from './adaptive-compiler';
import { isOwnUiElement } from '../surface';
import { captureCssomSnapshot, sameCssomSnapshot } from './adaptive-compiler';

const CSSOM_CHECK_DEBOUNCE_MS = 400;

/** True when `root` is a document or a still-connected host `ShadowRoot`. */
export const isConnectedRoot = (root: Document | ShadowRoot): boolean =>
  root.nodeType === Node.DOCUMENT_NODE || (root as ShadowRoot).host.isConnected;

export interface CssomWatcher {
  readonly setActive: (active: boolean) => void;
  readonly watchShadow: (shadow: ShadowRoot) => void;
  readonly unwatchShadow: (shadow: ShadowRoot) => void;
  readonly recordSnapshot: (root: Document | ShadowRoot, snapshot: RootCssomSnapshot) => void;
  readonly deleteSnapshot: (root: Document | ShadowRoot) => void;
  readonly clearPending: (root: Document | ShadowRoot) => void;
  readonly cancel: () => void;
}

export interface CssomWatcherCallbacks {
  readonly isActiveTarget: () => boolean;
  readonly isDirty: (root: Document | ShadowRoot) => boolean;
  readonly onChanged: (root: Document | ShadowRoot) => void;
}

/** Tracks CSSOM mutations across light DOM + open host Shadow Roots with debounced checks. */
export function createCssomWatcher(
  env: DomEnvironment,
  callbacks: CssomWatcherCallbacks,
): CssomWatcher {
  const lastSnapshots = new WeakMap<Document | ShadowRoot, RootCssomSnapshot>();
  const pendingRoots = new Set<Document | ShadowRoot>();
  const shadowCleanups = new Map<ShadowRoot, () => void>();
  let active = false;
  let stopDocWatch: (() => void) | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (checkTimer !== undefined) {
      clearTimeout(checkTimer);
      checkTimer = undefined;
    }
    pendingRoots.clear();
  };

  const clearPending = (root: Document | ShadowRoot): void => {
    if (pendingRoots.delete(root) && pendingRoots.size === 0) {
      cancel();
    }
  };

  const scheduleCheck = (root: Document | ShadowRoot): void => {
    if (pendingRoots.has(root) || callbacks.isDirty(root) || !callbacks.isActiveTarget()) {
      return;
    }
    pendingRoots.add(root);
    if (checkTimer !== undefined) {
      return;
    }
    checkTimer = setTimeout(() => {
      checkTimer = undefined;
      if (!callbacks.isActiveTarget()) {
        pendingRoots.clear();
        return;
      }
      const rootsToCheck = [...pendingRoots];
      pendingRoots.clear();
      for (const candidate of rootsToCheck) {
        if (callbacks.isDirty(candidate) || !isConnectedRoot(candidate)) {
          continue;
        }
        const current = captureCssomSnapshot(candidate);
        const prev = lastSnapshots.get(candidate);
        if (!prev || !sameCssomSnapshot(prev, current)) {
          callbacks.onChanged(candidate);
        }
      }
    }, CSSOM_CHECK_DEBOUNCE_MS);
  };

  const watchShadow = (shadow: ShadowRoot): void => {
    if (!active || shadowCleanups.has(shadow)) {
      return;
    }
    const shadowWatcher = env.shadowWatcherOf(shadow);
    if (!shadowWatcher) {
      return;
    }
    shadowCleanups.set(
      shadow,
      shadowWatcher.watchTree({
        added: () => scheduleCheck(shadow),
      }),
    );
  };

  return {
    setActive(next) {
      if (!next) {
        active = false;
        stopDocWatch?.();
        stopDocWatch = undefined;
        for (const stopShadow of shadowCleanups.values()) {
          stopShadow();
        }
        shadowCleanups.clear();
        cancel();
        return;
      }
      if (active) {
        return;
      }
      active = true;
      stopDocWatch = env.watcher.watchTree({
        added: () => scheduleCheck(env.doc),
      });
      for (const shadow of env.shadowRoots) {
        if (!isOwnUiElement(shadow.host)) {
          watchShadow(shadow);
        }
      }
    },
    watchShadow,
    unwatchShadow(shadow) {
      shadowCleanups.get(shadow)?.();
      shadowCleanups.delete(shadow);
      clearPending(shadow);
      lastSnapshots.delete(shadow);
    },
    recordSnapshot(root, snapshot) {
      lastSnapshots.set(root, snapshot);
    },
    deleteSnapshot(root) {
      lastSnapshots.delete(root);
    },
    clearPending,
    cancel,
  };
}
