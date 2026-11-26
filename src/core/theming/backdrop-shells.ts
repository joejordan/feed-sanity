// Automatically marks outer layout wrapper ancestors (`data-fs-shell`) between
// `<body>` and semantic landmarks (`main`, `[role="main"]`, columns, cards) so
// Studio backdrops shine through without brittle per-site `> div > div` chains.

import type { SurfaceSelectors } from './types';
import { isOwnUiElement, SHELL_ATTR } from '../surface';
import { DEFAULT_POPUPS, DEFAULT_SHELL_LANDMARKS } from '../theme-effects/surfaces';

const SHELL_SYNC_DEBOUNCE_MS = 180;

interface SelectorGroup {
  readonly basic: string;
  readonly hasList: readonly string[];
}

function compileSelectorGroup(selectors: readonly string[]): SelectorGroup {
  const unique = [...new Set(selectors)];
  return {
    basic: unique.filter((sel) => !sel.includes(':has(')).join(', '),
    hasList: unique.filter((sel) => sel.includes(':has(')),
  };
}

function matchesGroup(el: Element, group: SelectorGroup): boolean {
  if (group.basic) {
    try {
      if (el.matches(group.basic)) {
        return true;
      }
    } catch {
      // Invalid or unsupported selector syntax on host engine.
    }
  }
  for (const hasSel of group.hasList) {
    try {
      if (el.matches(hasSel)) {
        return true;
      }
    } catch {
      // Older engines without `:has()` support skip only that rule.
    }
  }
  return false;
}

function forEachInGroup(doc: Document, group: SelectorGroup, visit: (el: Element) => void): void {
  if (!doc.body) {
    return;
  }
  if (group.basic) {
    try {
      for (const el of doc.body.querySelectorAll(group.basic)) {
        visit(el);
      }
    } catch {
      // Ignore invalid selector group.
    }
  }
  for (const hasSel of group.hasList) {
    try {
      for (const el of doc.body.querySelectorAll(hasSel)) {
        visit(el);
      }
    } catch {
      // Ignore unsupported `:has()` rule.
    }
  }
}

export interface BackdropShellManager {
  readonly sync: () => void;
  readonly scheduleSync: (isActive: () => boolean) => void;
  readonly isSyncScheduled: () => boolean;
  readonly clear: () => void;
  readonly isSyncedForBody: () => boolean;
  readonly matchesAnchor: (el: Element) => boolean;
  readonly isInsideContainedSurface: (el: Element) => boolean;
  readonly hasMarked: (el: Element) => boolean;
}

/** Manages `data-fs-shell` ancestor transparency markers for active Studio backdrops. */
export function createBackdropShellManager(
  doc: Document,
  surfaces: SurfaceSelectors | undefined,
): BackdropShellManager {
  // Always keep semantic dialog/menu/listbox wrappers as hard traversal boundaries even when
  // a site narrows `surfaces.popups` to inner card surfaces (e.g. X's transparent modal frame).
  const popupBoundaries = [...DEFAULT_POPUPS, ...(surfaces?.popups ?? [])];
  const contentSurfaces = [
    ...new Set([
      ...(surfaces?.columns ?? []),
      ...(surfaces?.leafCards ?? []),
      ...(surfaces?.softSurfaces ?? []),
      ...(surfaces?.feedCards ?? []),
    ]),
  ];
  const popupGroup = compileSelectorGroup(popupBoundaries);
  const opaqueSurfaceGroup = compileSelectorGroup([
    ...contentSurfaces,
    ...(surfaces?.searchContainers ?? []),
  ]);
  const landmarkAnchorGroup = compileSelectorGroup(DEFAULT_SHELL_LANDMARKS);
  const parentAnchorGroup = compileSelectorGroup([
    ...contentSurfaces,
    ...(surfaces?.shellAnchors ?? []),
  ]);
  const allAnchorGroup = compileSelectorGroup([
    ...DEFAULT_SHELL_LANDMARKS,
    ...contentSurfaces,
    ...(surfaces?.shellAnchors ?? []),
  ]);

  // Popups (hard traversal boundaries) and leaf cards cannot wrap new outer shell ancestors.
  const containedSurfaceSelector = compileSelectorGroup([
    ...popupBoundaries,
    ...(surfaces?.feedCards ?? []),
    ...(surfaces?.leafCards ?? []),
  ]).basic;
  const markedShells = new Set<Element>();
  let shellSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let shellsSyncedForBody = false;

  const cancelSync = (): void => {
    if (shellSyncTimer !== undefined) {
      clearTimeout(shellSyncTimer);
      shellSyncTimer = undefined;
    }
  };

  const sync = (): void => {
    if (!doc.body) {
      return;
    }
    cancelSync();
    shellsSyncedForBody = true;
    const visited = new Set<Element>();
    const blocked = new Set<Element>();
    const nextMarked = new Set<Element>();

    const markAncestors = (start: Element | null): void => {
      if (!start || start === doc.body || start === doc.documentElement || visited.has(start)) {
        return;
      }
      const path: Element[] = [];
      let abortedByBoundary = false;
      for (
        let cur: Element | null = start;
        cur && cur !== doc.body && cur !== doc.documentElement;
        cur = cur.parentElement
      ) {
        if (blocked.has(cur)) {
          abortedByBoundary = true;
          break;
        }
        if (visited.has(cur)) {
          break;
        }
        if (isOwnUiElement(cur) || matchesGroup(cur, popupGroup)) {
          blocked.add(cur);
          visited.add(cur);
          abortedByBoundary = true;
          break;
        }
        path.push(cur);
      }
      if (abortedByBoundary) {
        for (const el of path) {
          blocked.add(el);
          visited.add(el);
        }
        return;
      }
      for (const el of path) {
        visited.add(el);
        if (!matchesGroup(el, opaqueSurfaceGroup)) {
          nextMarked.add(el);
        }
      }
    };

    forEachInGroup(doc, landmarkAnchorGroup, (landmark) => {
      // When a site omits declarative `surfaces`, `compileBackdropRevealCss` paints
      // `main` / `[role="main"]` as fallback translucent cards, so only mark wrappers above them.
      markAncestors(surfaces ? landmark : landmark.parentElement);
    });
    forEachInGroup(doc, parentAnchorGroup, (surface) => {
      markAncestors(surface.parentElement);
    });

    for (const prev of markedShells) {
      if (!prev.isConnected || !nextMarked.has(prev)) {
        prev.removeAttribute(SHELL_ATTR);
        markedShells.delete(prev);
      }
    }
    for (const el of nextMarked) {
      if (!markedShells.has(el)) {
        el.setAttribute(SHELL_ATTR, '');
        markedShells.add(el);
      }
    }
  };

  return {
    sync,
    scheduleSync(isActive) {
      if (shellSyncTimer !== undefined || !isActive()) {
        return;
      }
      shellSyncTimer = setTimeout(() => {
        shellSyncTimer = undefined;
        if (!isActive()) {
          return;
        }
        sync();
      }, SHELL_SYNC_DEBOUNCE_MS);
    },
    isSyncScheduled: () => shellSyncTimer !== undefined,
    clear() {
      cancelSync();
      shellsSyncedForBody = false;
      for (const el of markedShells) {
        el.removeAttribute(SHELL_ATTR);
      }
      markedShells.clear();
    },
    isSyncedForBody: () => shellsSyncedForBody,
    matchesAnchor: (el) => matchesGroup(el, allAnchorGroup),
    isInsideContainedSurface(el) {
      if (!containedSurfaceSelector || !el.parentElement) {
        return false;
      }
      try {
        return el.parentElement.closest(containedSurfaceSelector) !== null;
      } catch {
        return false;
      }
    },
    hasMarked: (el) => markedShells.has(el),
  };
}
