// Cross-site "My Themes" library & "Apply to all sites" broadcast backed by
// `Store` (`v2/theme-library`). Works identically across Chrome MV3, Firefox
// MV2, and userscripts with zero extra permissions and zero multi-tab write
// contention (each site tracks its own applied global revision locally).

import type { Store } from '../storage';
import type { ThemeDocumentFilterOptions } from './config';
import type { ThemeDocumentV1 } from './document';
import { Listeners } from '../listeners';
import { createLogger } from '../log';
import { isRecord, watchStoreKey } from '../storage';
import { applyThemeDocument } from './config';
import { cleanDocumentText, parseThemeDocument, slugifyThemeId } from './document';

export const THEME_LIBRARY_KEY = 'v2/theme-library';
export const THEME_GLOBAL_REV_KEY = 'theme-global-rev';
export const MAX_LIBRARY_THEMES = 50;

const log = createLogger('theme-library');

export interface SavedThemeEntry {
  /** Stable unique identifier inside the user's library (e.g. `ocean-pulse`, `ocean-pulse-2`). */
  readonly id: string;
  /** Validated canonical `ThemeDocumentV1` snapshot. */
  readonly document: ThemeDocumentV1;
  /** Epoch ms when the entry was first saved. */
  readonly savedAt: number;
  /** Epoch ms when the entry was last modified. */
  readonly updatedAt: number;
}

export interface GlobalThemeOverride {
  /** Monotonically increasing revision token so per-site edits can still override later. */
  readonly revision: number;
  /** Validated canonical `ThemeDocumentV1` broadcast to all sites. */
  readonly document: ThemeDocumentV1;
}

export type ThemeLibraryViewMode = 'cards' | 'list';

export interface ThemeLibraryState {
  readonly schemaVersion: 1;
  readonly themes: readonly SavedThemeEntry[];
  readonly globalTheme?: GlobalThemeOverride;
  /** Opt-in preference for live hover/focus theme previews in Appearance and Quick Popup (default `false`). */
  readonly hoverPreview?: boolean;
  /** Preferred layout for the My Themes library (`'cards'` default or `'list'`). */
  readonly libraryView?: ThemeLibraryViewMode;
}

export interface SaveLibraryThemeOptions extends ThemeDocumentFilterOptions {
  /** Optional display name override (trimmed & capped to 60 chars). */
  readonly name?: string;
  /** When set and found in the library, overwrites that entry in place. */
  readonly entryId?: string;
}

export interface ThemeLibraryClient {
  readonly ready: Promise<void>;
  readonly list: () => readonly SavedThemeEntry[];
  readonly getGlobalTheme: () => GlobalThemeOverride | undefined;
  readonly getHoverPreview: () => boolean;
  readonly setHoverPreview: (enabled: boolean) => Promise<void>;
  readonly getLibraryView: () => ThemeLibraryViewMode;
  readonly setLibraryView: (mode: ThemeLibraryViewMode) => Promise<void>;
  readonly saveTheme: (
    doc: ThemeDocumentV1,
    options?: SaveLibraryThemeOptions,
  ) => Promise<SavedThemeEntry>;
  readonly renameTheme: (entryId: string, nextName: string) => Promise<SavedThemeEntry | null>;
  readonly removeTheme: (entryId: string) => Promise<SavedThemeEntry | null>;
  readonly restoreTheme: (entry: SavedThemeEntry) => Promise<void>;
  readonly applyToAllSites: (
    doc: ThemeDocumentV1,
    options?: ThemeDocumentFilterOptions,
  ) => Promise<GlobalThemeOverride>;
  readonly onChange: (listener: (state: ThemeLibraryState) => void) => () => void;
  readonly dispose: () => void;
}

export const EMPTY_THEME_LIBRARY: ThemeLibraryState = {
  schemaVersion: 1,
  themes: [],
};

function readTimestamp(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/** Validates a per-site applied global-theme revision counter (`>= 0` safe integer). */
export function readGlobalThemeRevision(raw: unknown): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
}

function readGlobalThemeOverride(raw: unknown): GlobalThemeOverride | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const revision = readGlobalThemeRevision(raw.revision);
  if (revision <= 0) {
    return undefined;
  }
  const parsed = parseThemeDocument(raw.document);
  if (!parsed.ok || !parsed.document) {
    return undefined;
  }
  return { revision, document: parsed.document };
}

function readSavedThemeEntry(raw: unknown, seenIds: Set<string>): SavedThemeEntry | null {
  if (!isRecord(raw)) {
    return null;
  }
  const parsed = parseThemeDocument(raw.document);
  if (!parsed.ok || !parsed.document) {
    return null;
  }
  const rawId = cleanDocumentText(raw.id, 48);
  const id = slugifyThemeId(rawId ?? parsed.document.id, parsed.document.id);
  if (seenIds.has(id)) {
    return null;
  }
  seenIds.add(id);
  const savedAt = readTimestamp(raw.savedAt, 0);
  const updatedAt = Math.max(savedAt, readTimestamp(raw.updatedAt, savedAt));
  return {
    id,
    document: parsed.document,
    savedAt,
    updatedAt,
  };
}

/** Validates a raw stored `v2/theme-library` payload into a clean `ThemeLibraryState`. */
export function readThemeLibraryState(raw: unknown): ThemeLibraryState {
  if (!isRecord(raw)) {
    return EMPTY_THEME_LIBRARY;
  }
  const themes: SavedThemeEntry[] = [];
  const seenIds = new Set<string>();
  if (Array.isArray(raw.themes)) {
    for (const item of raw.themes) {
      if (themes.length >= MAX_LIBRARY_THEMES) {
        break;
      }
      const entry = readSavedThemeEntry(item, seenIds);
      if (entry) {
        themes.push(entry);
      }
    }
  }
  const globalTheme = readGlobalThemeOverride(raw.globalTheme);
  return {
    schemaVersion: 1,
    themes,
    ...(globalTheme ? { globalTheme } : {}),
    ...(raw.hoverPreview === true ? { hoverPreview: true } : {}),
    ...(raw.libraryView === 'list' ? { libraryView: 'list' } : {}),
  };
}

function allocateUniqueEntryId(baseId: string, existing: readonly SavedThemeEntry[]): string {
  const taken = new Set(existing.map((entry) => entry.id));
  const cleanBase = slugifyThemeId(baseId, 'saved-theme');
  if (!taken.has(cleanBase)) {
    return cleanBase;
  }
  const prefix = cleanBase.slice(0, 42).replace(/-+$/, '') || 'saved-theme';
  for (let suffix = 2; ; suffix++) {
    const candidate = `${prefix}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

function prepareLibraryDocument(
  doc: ThemeDocumentV1,
  options: ThemeDocumentFilterOptions & { readonly name?: string } = {},
): ThemeDocumentV1 {
  const filtered = applyThemeDocument(doc, {
    includeCustomCss: options.includeCustomCss ?? true,
    includeCustomShader: options.includeCustomShader ?? true,
  });
  const customName = options.name === undefined ? undefined : cleanDocumentText(options.name, 60);
  const candidate: ThemeDocumentV1 = customName
    ? {
        ...filtered,
        id: slugifyThemeId(customName, filtered.id),
        meta: {
          ...filtered.meta,
          name: customName,
        },
      }
    : filtered;
  const parsed = parseThemeDocument(candidate);
  if (!parsed.ok || !parsed.document) {
    throw new Error(parsed.errors[0] ?? 'Theme document is invalid and cannot be saved.');
  }
  return parsed.document;
}

/** Creates a reactive cross-tab `ThemeLibraryClient` backed by `v2/theme-library`. */
export function createThemeLibrary(store: Store): ThemeLibraryClient {
  let state: ThemeLibraryState = EMPTY_THEME_LIBRARY;
  let lastJson: string | undefined;
  let unread = false;
  let pendingSaves = 0;
  let disposed = false;
  let unsubscribeStore: (() => void) | undefined;
  let saveQueue: Promise<void> = Promise.resolve();
  const listeners = new Listeners<[ThemeLibraryState]>(log);

  const apply = (next: ThemeLibraryState): void => {
    if (state === next) {
      return;
    }
    const prevJson = lastJson ?? JSON.stringify(state);
    const nextJson = JSON.stringify(next);
    state = next;
    lastJson = nextJson;
    if (prevJson !== nextJson) {
      listeners.emit(state);
    }
  };

  const ready = store
    .get(THEME_LIBRARY_KEY)
    .then((raw) => {
      if (!disposed) {
        apply(readThemeLibraryState(raw));
      }
    })
    .catch((error: unknown) => {
      unread = true;
      log.error('could not read theme library', error);
    })
    .finally(() => {
      if (disposed) {
        return;
      }
      unsubscribeStore = watchStoreKey(store, THEME_LIBRARY_KEY, (newValue) => {
        if (pendingSaves === 0) {
          if (newValue === undefined || isRecord(newValue)) {
            unread = false;
          }
          apply(readThemeLibraryState(newValue));
        }
      });
    });

  const enqueueMutation = <R>(
    mutate: (current: ThemeLibraryState) => {
      readonly next?: ThemeLibraryState;
      readonly result: R;
    },
  ): Promise<R> => {
    const run = saveQueue.then(async () => {
      await ready;
      if (unread) {
        throw new Error(`'${THEME_LIBRARY_KEY}' could not be read, so it is not overwritten`);
      }
      const { next, result } = mutate(state);
      if (next !== undefined) {
        pendingSaves++;
        try {
          await store.set(THEME_LIBRARY_KEY, next);
        } finally {
          pendingSaves--;
        }
        if (!disposed) {
          apply(next);
        }
      }
      return result;
    });
    saveQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const setOptionalPreference = <K extends 'hoverPreview' | 'libraryView'>(
    key: K,
    nextValue: ThemeLibraryState[K] | undefined,
  ): Promise<void> =>
    enqueueMutation((current) => {
      if (current[key] === nextValue) {
        return { result: undefined };
      }
      if (nextValue === undefined) {
        const { [key]: _removed, ...rest } = current;
        return { next: rest as ThemeLibraryState, result: undefined };
      }
      return { next: { ...current, [key]: nextValue }, result: undefined };
    });

  return {
    ready,
    list: () => state.themes,
    getGlobalTheme: () => state.globalTheme,
    getHoverPreview: () => state.hoverPreview === true,
    setHoverPreview: (enabled) => setOptionalPreference('hoverPreview', enabled ? true : undefined),
    getLibraryView: () => (state.libraryView === 'list' ? 'list' : 'cards'),
    setLibraryView: (mode) =>
      setOptionalPreference('libraryView', mode === 'list' ? 'list' : undefined),
    saveTheme(doc, options = {}) {
      return enqueueMutation((current) => {
        const normalized = prepareLibraryDocument(doc, options);
        const now = Date.now();
        const existingIndex = options.entryId
          ? current.themes.findIndex((entry) => entry.id === options.entryId)
          : -1;

        if (existingIndex >= 0) {
          const prev = current.themes[existingIndex]!;
          const updated: SavedThemeEntry = {
            id: prev.id,
            document: normalized,
            savedAt: prev.savedAt,
            updatedAt: Math.max(now, prev.updatedAt),
          };
          const themes = [
            updated,
            ...current.themes.slice(0, existingIndex),
            ...current.themes.slice(existingIndex + 1),
          ];
          return { next: { ...current, themes }, result: updated };
        }

        if (current.themes.length >= MAX_LIBRARY_THEMES) {
          throw new Error(
            `My Themes library is full (${MAX_LIBRARY_THEMES} themes). Delete an older theme to save a new one.`,
          );
        }

        const entry: SavedThemeEntry = {
          id: allocateUniqueEntryId(normalized.id, current.themes),
          document: normalized,
          savedAt: now,
          updatedAt: now,
        };
        return {
          next: { ...current, themes: [entry, ...current.themes] },
          result: entry,
        };
      });
    },
    renameTheme(entryId, nextName) {
      return enqueueMutation((current) => {
        const cleaned = cleanDocumentText(nextName, 60);
        if (!cleaned) {
          return { result: null };
        }
        const index = current.themes.findIndex((entry) => entry.id === entryId);
        if (index < 0) {
          return { result: null };
        }
        const prev = current.themes[index]!;
        const renamedDoc = prepareLibraryDocument(prev.document, { name: cleaned });
        const updated: SavedThemeEntry = {
          ...prev,
          document: renamedDoc,
          updatedAt: Math.max(Date.now(), prev.updatedAt),
        };
        const themes = [
          ...current.themes.slice(0, index),
          updated,
          ...current.themes.slice(index + 1),
        ];
        return { next: { ...current, themes }, result: updated };
      });
    },
    removeTheme(entryId) {
      return enqueueMutation((current) => {
        const index = current.themes.findIndex((entry) => entry.id === entryId);
        if (index < 0) {
          return { result: null };
        }
        const removed = current.themes[index]!;
        const themes = [...current.themes.slice(0, index), ...current.themes.slice(index + 1)];
        return { next: { ...current, themes }, result: removed };
      });
    },
    restoreTheme(entry) {
      return enqueueMutation((current) => {
        if (
          current.themes.length >= MAX_LIBRARY_THEMES ||
          current.themes.some((item) => item.id === entry.id)
        ) {
          return { result: undefined };
        }
        const normalized = prepareLibraryDocument(entry.document);
        const now = Date.now();
        const savedAt = readTimestamp(entry.savedAt, now);
        const restored: SavedThemeEntry = {
          id: entry.id,
          document: normalized,
          savedAt,
          updatedAt: Math.max(savedAt, readTimestamp(entry.updatedAt, savedAt)),
        };
        return {
          next: { ...current, themes: [restored, ...current.themes] },
          result: undefined,
        };
      });
    },
    applyToAllSites(doc, options = {}) {
      return enqueueMutation((current) => {
        const normalized = prepareLibraryDocument(doc, options);
        const prevRev = current.globalTheme?.revision ?? 0;
        const revision = Math.max(Date.now(), prevRev + 1);
        const globalTheme: GlobalThemeOverride = { revision, document: normalized };
        return {
          next: { ...current, globalTheme },
          result: globalTheme,
        };
      });
    },
    onChange: (listener) => listeners.add(listener),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeStore?.();
      unsubscribeStore = undefined;
      listeners.clear();
    },
  };
}
