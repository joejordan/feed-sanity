export const THEME_STYLE_ID = 'feed_sanity_user_theme';

const EARLY_THEME_CACHE_PREFIX = '__fs_early_theme__:';
const MAX_EARLY_CACHE_CHARS = 128_000;

const earlyThemeKey = (cacheKey: string): string => `${EARLY_THEME_CACHE_PREFIX}${cacheKey}`;

/** Reads the cached host theme CSS for `cacheKey` from `sessionStorage` (empty string if unavailable). */
export function readEarlyThemeCss(cacheKey: string): string {
  try {
    return globalThis.sessionStorage?.getItem(earlyThemeKey(cacheKey)) ?? '';
  } catch {
    return '';
  }
}

/** Persists or clears the synchronous per-origin early theme CSS cache for `cacheKey`. */
export function writeEarlyThemeCss(cacheKey: string, css: string): void {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) {
      return;
    }
    const key = earlyThemeKey(cacheKey);
    if (css && css.length <= MAX_EARLY_CACHE_CHARS) {
      if (storage.getItem(key) !== css) {
        storage.setItem(key, css);
      }
    } else if (storage.getItem(key) !== null) {
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage quota or sandboxed iframe restrictions.
  }
}

/**
 * Synchronously injects the cached host theme CSS into `doc` before async
 * storage resolves, preventing first-paint FOUC. `ThemeController` reconciles
 * or removes `#feed_sanity_user_theme` once persisted settings load.
 */
export function applyEarlyThemeCss(
  cacheKey: string,
  doc: Document = document,
): HTMLStyleElement | null {
  const css = readEarlyThemeCss(cacheKey);
  if (!css) {
    return null;
  }
  const existing = doc.querySelector(`#${THEME_STYLE_ID}`);
  if (existing && existing.localName === 'style') {
    if (existing.textContent !== css) {
      existing.textContent = css;
    }
    return existing as HTMLStyleElement;
  }
  const target = doc.head ?? doc.documentElement;
  if (!target) {
    return null;
  }
  const style = doc.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = css;
  target.append(style);
  return style;
}

/** Removes any synchronously injected early theme `<style>` from `doc`. */
export function clearEarlyThemeStyle(doc: Document = document): void {
  const existing = doc.querySelector(`#${THEME_STYLE_ID}`);
  if (existing && existing.localName === 'style') {
    existing.remove();
  }
}
