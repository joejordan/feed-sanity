// Lightweight per-origin hint shared between isolated content scripts and
// MAIN-world entrypoints via `localStorage` so disabled/experimental sites
// avoid monkey-patching `fetch`, `XHR`, or `attachShadow` at `document_start`
// before async extension storage resolves.

const HINT_PREFIX = 'fs:site-enabled:';

export function readSiteEnabledHint(siteId: string, defaultEnabled: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(`${HINT_PREFIX}${siteId}`);
    if (raw === '1') {
      return true;
    }
    if (raw === '0') {
      return false;
    }
  } catch {
    // Sandboxed frames or restricted storage fall back cleanly to the default.
  }
  return defaultEnabled;
}

export function writeSiteEnabledHint(siteId: string, enabled: boolean): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return;
    }
    const key = `${HINT_PREFIX}${siteId}`;
    const next = enabled ? '1' : '0';
    if (storage.getItem(key) !== next) {
      storage.setItem(key, next);
    }
  } catch {
    // Ignore storage quota or privacy restrictions.
  }
}
