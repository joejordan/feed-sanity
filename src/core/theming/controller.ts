import type { DomEnvironment } from '../dom-env';
import type { Scope } from '../scope';
import type { RootCssomSnapshot, ThemeAuditReport, ThemeHealer } from '../theme';
import type { ThemeEffectsConfig } from '../theme-effects';
import type {
  ResolvedTheme,
  SiteThemeMapping,
  ThemeAmbientGlowSpec,
  ThemeChromeConfig,
  ThemeColorScheme,
  ThemePalette,
  ThemeRibbonSpec,
} from './types';
import { OWN_ATTR } from '../surface';
import {
  auditThemeCoverage,
  captureCssomSnapshot,
  captureLayoutSnapshot,
  compileAdaptiveRootCss,
  createThemeHealer,
  detectConfirmedHostColorScheme,
  HEALER_STYLE_ID,
  HOST_SCHEME_ATTRS,
  isOwnUiElement,
  sameCssomSnapshot,
  samePalette,
} from '../theme';
import { createEffectsLayerController } from '../theme-effects';
import { compileHostThemeCss, compileShadowThemeCss, compileUiThemeCss } from './compile';
import { THEME_STYLE_ID } from './early-cache';

const ADAPTIVE_STYLE_ID = 'feed_sanity_adaptive_theme';
const SCHEME_RECHECK_DEBOUNCE_MS = 80;
const CSSOM_CHECK_DEBOUNCE_MS = 400;
const SCHEME_ATTR_FILTER = ['class', 'style', ...HOST_SCHEME_ATTRS];

const isConnectedRoot = (root: Document | ShadowRoot): boolean =>
  root.nodeType === Node.DOCUMENT_NODE || (root as ShadowRoot).host.isConnected;

const isOwnShadowRoot = (shadow: ShadowRoot): boolean => isOwnUiElement(shadow.host);

const hasAdaptiveTarget = (theme: ResolvedTheme | null): boolean =>
  Boolean(theme?.palette || theme?.fontFamily);

const hasActiveBackdrop = (theme: ResolvedTheme | null): boolean =>
  Boolean(theme?.effects && theme.effects.backdrop !== 'none');

function sameRibbon(a: ThemeRibbonSpec | undefined, b: ThemeRibbonSpec | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (
    !a ||
    !b ||
    a.enabled !== b.enabled ||
    a.angle !== b.angle ||
    a.height !== b.height ||
    a.position !== b.position ||
    a.stops.length !== b.stops.length
  ) {
    return false;
  }
  return a.stops.every((stop, idx) => stop === b.stops[idx]);
}

function sameAmbientGlow(
  a: ThemeAmbientGlowSpec | undefined,
  b: ThemeAmbientGlowSpec | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.enabled !== b.enabled || a.spots.length !== b.spots.length) {
    return false;
  }
  return a.spots.every((s1, idx) => {
    const s2 = b.spots[idx];
    return (
      s2 !== undefined &&
      s1.color === s2.color &&
      s1.alpha === s2.alpha &&
      s1.x === s2.x &&
      s1.y === s2.y &&
      s1.radiusX === s2.radiusX &&
      s1.radiusY === s2.radiusY
    );
  });
}

function sameChrome(a: ThemeChromeConfig | undefined, b: ThemeChromeConfig | undefined): boolean {
  return (
    a === b || (sameRibbon(a?.ribbon, b?.ribbon) && sameAmbientGlow(a?.ambientGlow, b?.ambientGlow))
  );
}

function sameShadowRelevantTheme(prev: ResolvedTheme | null, next: ResolvedTheme | null): boolean {
  return (
    prev === next ||
    (samePalette(prev?.palette ?? null, next?.palette ?? null) &&
      (prev?.fontFamily ?? '') === (next?.fontFamily ?? '') &&
      (prev?.customCss ?? '') === (next?.customCss ?? ''))
  );
}

function sameCssRelevantTheme(prev: ResolvedTheme | null, next: ResolvedTheme | null): boolean {
  if (!sameShadowRelevantTheme(prev, next) || !sameChrome(prev?.chrome, next?.chrome)) {
    return false;
  }
  const prevBackdrop = hasActiveBackdrop(prev);
  const nextBackdrop = hasActiveBackdrop(next);
  if (prevBackdrop !== nextBackdrop) {
    return false;
  }
  const prevSurface = prev?.effects?.surface ?? 'default';
  const nextSurface = next?.effects?.surface ?? 'default';
  if (prevSurface !== nextSurface) {
    return false;
  }
  if (
    (nextBackdrop || nextSurface === 'glass') &&
    (prev?.effects?.glassStrength ?? 0) !== (next?.effects?.glassStrength ?? 0)
  ) {
    return false;
  }
  return true;
}

function sameEffectsConfig(
  a: ThemeEffectsConfig | undefined,
  b: ThemeEffectsConfig | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.backdrop === b.backdrop &&
    a.intensity === b.intensity &&
    a.speed === b.speed &&
    a.glassStrength === b.glassStrength &&
    a.paused === b.paused &&
    a.interactive === b.interactive &&
    a.rainLook === b.rainLook &&
    a.rainCharset === b.rainCharset &&
    a.rainDensity === b.rainDensity &&
    a.rainIntro === b.rainIntro &&
    a.surface === b.surface &&
    a.click === b.click
  );
}

function readInlineSchemeStyle(el: Element | null): string {
  if (!el || !('style' in el)) {
    return '';
  }
  const s = (el as HTMLElement).style;
  return `${s.backgroundColor}|${s.colorScheme}`;
}

export interface ThemeController {
  /** Applies the persisted user theme (or clears it when `null`). Pass `{ clearPreview: true }` to clear any active preview atomically in one render. */
  apply: (theme: ResolvedTheme | null, options?: { readonly clearPreview?: boolean }) => void;
  /** Temporarily previews a theme (including `null` to preview Site Default). */
  preview: (theme: ResolvedTheme | null) => void;
  /** Ends any active preview and restores the persisted user theme. */
  clearPreview: () => void;
  /** Currently active effective theme (preview if active, else saved). */
  current: () => ResolvedTheme | null;
  /** Returns the most recently compiled host-document theme CSS (for early-cache sync). */
  compiledHostCss?: () => string;
  /** Runs the Theme Coverage & Layout-Integrity Auditor against the live page. */
  audit?: () => ThemeAuditReport | null;
  /** Triggers an immediate self-healing pass across visible light DOM + open Shadow Roots. */
  healNow?: () => number;
  dispose: () => void;
}

/**
 * Manages live host + host Shadow DOM + same-origin iframe + Feed Sanity UI
 * theming for one `DomEnvironment`. Attaches styles directly to `documentElement`
 * when `<head>` is not yet parsed so themes apply before first paint at
 * `document_start`.
 */
export function createThemeController(
  env: DomEnvironment,
  mapping: SiteThemeMapping,
  setUiThemeCss: (css: string) => void,
): ThemeController {
  let savedTheme: ResolvedTheme | null = null;
  let previewTheme: ResolvedTheme | null | undefined;
  let hostCss = '';
  let shadowCss: string | undefined;
  let disposed = false;

  const adaptiveConfig = mapping.adaptive?.enabled === true ? mapping.adaptive : undefined;
  const mediaOpt = adaptiveConfig?.mediaPreserveSelectors
    ? { mediaPreserveSelectors: adaptiveConfig.mediaPreserveSelectors }
    : {};
  let detectedHostScheme: ThemeColorScheme | undefined;
  const dirtyRoots = new Set<Document | ShadowRoot>();
  const lastCssomSnapshots = new WeakMap<Document | ShadowRoot, RootCssomSnapshot>();
  const pendingCssomRoots = new Set<Document | ShadowRoot>();
  const shadowCssomCleanups = new Map<ShadowRoot, () => void>();
  let cssomWatchActive = false;
  let recompileTimer: ReturnType<typeof setTimeout> | undefined;
  let schemeRecheckTimer: ReturnType<typeof setTimeout> | undefined;
  let cssomCheckTimer: ReturnType<typeof setTimeout> | undefined;
  let backdropHealQueued = false;
  let stopBackdropWatch: (() => void) | undefined;
  let stopCssomWatch: (() => void) | undefined;
  let schemeObserverActive = false;
  const linkLoadAbort = new AbortController();

  const styles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const adaptiveStyles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const iframeDocs = new Set<Document>();
  const iframeCleanups = new Set<() => void>();
  const cleanups: Array<() => void> = [];
  const healer: ThemeHealer | undefined = adaptiveConfig
    ? createThemeHealer(env, env.scope, {
        ...mediaOpt,
        ...(mapping.surfaces?.transparentShell
          ? { transparentShellSelectors: mapping.surfaces.transparentShell }
          : {}),
      })
    : undefined;
  if (healer) {
    cleanups.push(() => healer.dispose());
  }
  const effectsLayer = createEffectsLayerController(env.doc);
  cleanups.push(() => effectsLayer.dispose());

  const effectiveTheme = (): ResolvedTheme | null =>
    previewTheme === undefined ? savedTheme : previewTheme;

  const disableThemeSheetsForMeasure = (includeShadowRoots: boolean): (() => void) => {
    const toggled: CSSStyleSheet[] = [];
    const disableEl = (el: HTMLStyleElement | Element | null | undefined): void => {
      const sheet = el && el.localName === 'style' ? (el as HTMLStyleElement).sheet : null;
      if (sheet && !sheet.disabled) {
        sheet.disabled = true;
        toggled.push(sheet);
      }
    };
    const toggleRoot = (root: Document | ShadowRoot): void => {
      const trackedUser = styles.get(root);
      disableEl(trackedUser?.isConnected ? trackedUser : root.querySelector(`#${THEME_STYLE_ID}`));
      const trackedAdaptive = adaptiveStyles.get(root);
      disableEl(
        trackedAdaptive?.isConnected
          ? trackedAdaptive
          : root.querySelector(`#${ADAPTIVE_STYLE_ID}`),
      );
      disableEl(root.querySelector(`#${HEALER_STYLE_ID}`));
    };
    toggleRoot(env.doc);
    if (includeShadowRoots) {
      for (const shadow of env.shadowRoots) {
        if (!isOwnShadowRoot(shadow)) {
          toggleRoot(shadow);
        }
      }
    }
    return () => {
      for (const sheet of toggled) {
        sheet.disabled = false;
      }
    };
  };

  const detectNativeHostScheme = (): ThemeColorScheme | null => {
    const restore = disableThemeSheetsForMeasure(false);
    try {
      return detectConfirmedHostColorScheme(env.doc);
    } finally {
      restore();
    }
  };

  /** Probes native host polarity and caches it only when `<body>` exists and an explicit signal is found. */
  const refreshHostScheme = (): ThemeColorScheme | null => {
    const confirmed = detectNativeHostScheme();
    if (env.doc.body && confirmed !== null) {
      detectedHostScheme = confirmed;
    }
    return confirmed;
  };

  const getHostScheme = (): ThemeColorScheme =>
    detectedHostScheme ?? refreshHostScheme() ?? 'light';

  const forEachHostRoot = (
    fn: (root: Document | ShadowRoot) => void,
    includeIframes = true,
  ): void => {
    fn(env.doc);
    for (const shadow of env.shadowRoots) {
      if (!isOwnShadowRoot(shadow)) {
        fn(shadow);
      }
    }
    if (includeIframes) {
      for (const iframeDoc of iframeDocs) {
        fn(iframeDoc);
      }
    }
  };

  const getShadowCss = (): string => {
    if (shadowCss === undefined) {
      const effective = effectiveTheme();
      shadowCss = effective ? compileShadowThemeCss(effective, mapping) : '';
    }
    return shadowCss;
  };

  const findExistingStyle = (
    root: Document | ShadowRoot,
    styleId: string,
    store: Map<Document | ShadowRoot, HTMLStyleElement>,
  ): HTMLStyleElement | undefined => {
    const tracked = store.get(root);
    if (tracked?.isConnected) {
      return tracked;
    }
    const found = root.querySelector(`#${styleId}`);
    // Use `localName` rather than `instanceof HTMLStyleElement` so cross-realm
    // `<style>` elements inside same-origin iframes are matched reliably.
    if (found && found.localName === 'style') {
      const style = found as HTMLStyleElement;
      store.set(root, style);
      return style;
    }
    return undefined;
  };

  const syncNamedRoot = (
    root: Document | ShadowRoot,
    styleId: string,
    store: Map<Document | ShadowRoot, HTMLStyleElement>,
    cssText: string,
    beforeStyle?: HTMLStyleElement,
  ): void => {
    const existing = findExistingStyle(root, styleId, store);
    if (!cssText) {
      existing?.remove();
      store.delete(root);
      return;
    }
    const isDoc = root.nodeType === Node.DOCUMENT_NODE;
    if (existing) {
      if (existing.textContent !== cssText) {
        existing.textContent = cssText;
      }
      // Promote an early `document_start` style appended to `<html>` into `<head>`
      // once parsed so it sits after host stylesheets in CSS cascade order.
      if (isDoc) {
        const head = (root as Document).head;
        if (head && existing.parentElement !== head) {
          if (beforeStyle && beforeStyle.parentElement === head) {
            beforeStyle.before(existing);
          } else {
            head.append(existing);
          }
        }
      }
      return;
    }
    const owner = isDoc ? (root as Document) : (root.ownerDocument ?? env.doc);
    const style = owner.createElement('style');
    style.id = styleId;
    style.textContent = cssText;
    const target = isDoc ? ((root as Document).head ?? (root as Document).documentElement) : root;
    if (!target) {
      return;
    }
    if (beforeStyle && beforeStyle.parentNode === target) {
      beforeStyle.before(style);
    } else {
      target.append(style);
    }
    store.set(root, style);
  };

  let hasRenderedCss = false;
  let lastCssTheme: ResolvedTheme | null = null;
  let lastCssScheme: ThemeColorScheme | undefined;
  let lastAdaptiveScheme: ThemeColorScheme | undefined;
  let hasSyncedEffects = false;
  let lastEffectsConfig: ThemeEffectsConfig | undefined;
  let lastEffectsPalette: ThemePalette | null = null;
  let lastEffectsScheme: ThemeColorScheme | undefined;

  const syncAdaptiveForRoot = (
    root: Document | ShadowRoot,
    resolvedHostScheme?: ThemeColorScheme,
  ): void => {
    if (!adaptiveConfig) {
      return;
    }
    dirtyRoots.delete(root);
    clearPendingCssomRoot(root);
    const effective = effectiveTheme();
    if (!hasAdaptiveTarget(effective)) {
      lastCssomSnapshots.delete(root);
      syncNamedRoot(root, ADAPTIVE_STYLE_ID, adaptiveStyles, '');
      return;
    }
    const palette = effective?.palette ?? null;
    const fontFamily = effective?.fontFamily;
    const backdropActive = hasActiveBackdrop(effective);
    const css = compileAdaptiveRootCss(root, palette, {
      hostScheme: resolvedHostScheme ?? getHostScheme(),
      rootSelectors: mapping.rootSelectors,
      backdropActive,
      ...(fontFamily ? { fontFamily } : {}),
      ...(adaptiveConfig.brandColors ? { brandColors: adaptiveConfig.brandColors } : {}),
      onCssomSnapshot: (snapshot) => {
        lastCssomSnapshots.set(root, snapshot);
      },
      ...mediaOpt,
    });
    const userStyle = findExistingStyle(root, THEME_STYLE_ID, styles);
    syncNamedRoot(root, ADAPTIVE_STYLE_ID, adaptiveStyles, css, userStyle);
  };

  const cancelAdaptiveRecompile = (): void => {
    if (recompileTimer !== undefined) {
      clearTimeout(recompileTimer);
      recompileTimer = undefined;
    }
    dirtyRoots.clear();
  };

  const scheduleAdaptiveRecompile = (root: Document | ShadowRoot): void => {
    const effective = effectiveTheme();
    if (!adaptiveConfig || disposed || !hasAdaptiveTarget(effective)) {
      return;
    }
    dirtyRoots.add(root);
    if (recompileTimer !== undefined) {
      return;
    }
    // Debounce bursts of lazy-loaded stylesheet chunks during scroll/navigation.
    recompileTimer = setTimeout(() => {
      recompileTimer = undefined;
      if (disposed || !hasAdaptiveTarget(effectiveTheme())) {
        dirtyRoots.clear();
        return;
      }
      const batch = [...dirtyRoots];
      dirtyRoots.clear();
      // Re-probe polarity once when a stylesheet loads while host polarity was still unconfirmed
      // (e.g. X dark stylesheet arriving after `document_start` boot).
      let scheme: ThemeColorScheme;
      if (detectedHostScheme === undefined && env.doc.body) {
        const confirmed = refreshHostScheme();
        if (
          confirmed !== null &&
          (confirmed !== lastCssScheme || confirmed !== lastAdaptiveScheme)
        ) {
          render();
          return;
        }
        scheme = confirmed ?? 'light';
      } else {
        scheme = getHostScheme();
      }
      for (const dirty of batch) {
        if (isConnectedRoot(dirty)) {
          syncAdaptiveForRoot(dirty, scheme);
        }
      }
    }, 100);
  };

  // Detect CSSOM `sheet.insertRule()` / `replaceSync()` / `adoptedStyleSheets`
  // changes across both the main document and open Shadow Roots without polling
  // timers by checking lightweight CSSOM snapshots on debounced DOM additions.
  const cancelCssomCheck = (): void => {
    if (cssomCheckTimer !== undefined) {
      clearTimeout(cssomCheckTimer);
      cssomCheckTimer = undefined;
    }
    pendingCssomRoots.clear();
  };

  const clearPendingCssomRoot = (root: Document | ShadowRoot): void => {
    if (pendingCssomRoots.delete(root) && pendingCssomRoots.size === 0) {
      cancelCssomCheck();
    }
  };

  const scheduleCssomCheck = (root: Document | ShadowRoot): void => {
    if (
      disposed ||
      pendingCssomRoots.has(root) ||
      dirtyRoots.has(root) ||
      !hasAdaptiveTarget(effectiveTheme())
    ) {
      return;
    }
    pendingCssomRoots.add(root);
    if (cssomCheckTimer !== undefined) {
      return;
    }
    cssomCheckTimer = setTimeout(() => {
      cssomCheckTimer = undefined;
      if (disposed || !hasAdaptiveTarget(effectiveTheme())) {
        pendingCssomRoots.clear();
        return;
      }
      const rootsToCheck = [...pendingCssomRoots];
      pendingCssomRoots.clear();
      for (const candidate of rootsToCheck) {
        if (dirtyRoots.has(candidate) || !isConnectedRoot(candidate)) {
          continue;
        }
        const current = captureCssomSnapshot(candidate);
        const prev = lastCssomSnapshots.get(candidate);
        if (!prev || !sameCssomSnapshot(prev, current)) {
          scheduleAdaptiveRecompile(candidate);
        }
      }
    }, CSSOM_CHECK_DEBOUNCE_MS);
  };

  const watchShadowCssom = (shadow: ShadowRoot): void => {
    if (!adaptiveConfig || !cssomWatchActive || disposed || shadowCssomCleanups.has(shadow)) {
      return;
    }
    const shadowWatcher = env.shadowWatcherOf(shadow);
    if (!shadowWatcher) {
      return;
    }
    shadowCssomCleanups.set(
      shadow,
      shadowWatcher.watchTree({
        added: () => scheduleCssomCheck(shadow),
      }),
    );
  };

  const setCssomWatcherActive = (active: boolean): void => {
    if (!adaptiveConfig) {
      return;
    }
    if (!active) {
      cssomWatchActive = false;
      stopCssomWatch?.();
      stopCssomWatch = undefined;
      for (const stopShadow of shadowCssomCleanups.values()) {
        stopShadow();
      }
      shadowCssomCleanups.clear();
      cancelCssomCheck();
      return;
    }
    if (cssomWatchActive || disposed) {
      return;
    }
    cssomWatchActive = true;
    stopCssomWatch = env.watcher.watchTree({
      added: () => scheduleCssomCheck(env.doc),
    });
    for (const shadow of env.shadowRoots) {
      if (!isOwnShadowRoot(shadow)) {
        watchShadowCssom(shadow);
      }
    }
  };
  cleanups.push(() => setCssomWatcherActive(false));

  const syncRoot = (
    root: Document | ShadowRoot,
    cssText: string,
    includeAdaptive = true,
    resolvedHostScheme?: ThemeColorScheme,
  ): void => {
    syncNamedRoot(root, THEME_STYLE_ID, styles, cssText);
    if (includeAdaptive) {
      syncAdaptiveForRoot(root, resolvedHostScheme);
    }
  };

  const syncEffectsIfNeeded = (
    effects: ThemeEffectsConfig | undefined,
    palette: ThemePalette | null,
    scheme: ThemeColorScheme,
    force = false,
  ): void => {
    const backdropActive = Boolean(effects && effects.backdrop !== 'none');
    const unchanged =
      !force &&
      hasSyncedEffects &&
      sameEffectsConfig(lastEffectsConfig, effects) &&
      samePalette(lastEffectsPalette, palette) &&
      lastEffectsScheme === scheme &&
      (!backdropActive || effectsLayer.isBackdropConnected());
    if (unchanged) {
      return;
    }
    hasSyncedEffects = true;
    lastEffectsConfig = effects;
    lastEffectsPalette = palette;
    lastEffectsScheme = scheme;
    effectsLayer.sync(effects, palette, scheme);
  };

  // Self-heal if the host SPA (e.g. React/Shreddit re-hydration) detaches our live backdrop host.
  // Subscribed ONLY while a live backdrop is active so Site Default / static themes pay zero cost.
  const setBackdropWatcherActive = (active: boolean): void => {
    if (!active) {
      stopBackdropWatch?.();
      stopBackdropWatch = undefined;
      return;
    }
    if (stopBackdropWatch || disposed) {
      return;
    }
    stopBackdropWatch = env.watcher.watchTree({
      removed: () => {
        if (disposed || backdropHealQueued || effectsLayer.isBackdropConnected()) {
          return;
        }
        if (!hasActiveBackdrop(effectiveTheme())) {
          return;
        }
        backdropHealQueued = true;
        queueMicrotask(() => {
          backdropHealQueued = false;
          if (disposed || effectsLayer.isBackdropConnected()) {
            return;
          }
          const latest = effectiveTheme();
          if (!hasActiveBackdrop(latest)) {
            return;
          }
          syncEffectsIfNeeded(latest?.effects, latest?.palette ?? null, getHostScheme(), true);
        });
      },
    });
  };
  cleanups.push(() => setBackdropWatcherActive(false));

  // Re-detect native host Dark/Light polarity when the OS color scheme or root theme
  // attributes flip, ignoring noisy non-color inline style writes (e.g. modal `overflow: hidden`).
  // Connected ONLY while a theme is active so Site Default stays zero-overhead.
  const lastInlineSchemeStyles = new WeakMap<Element, string>();

  const cancelSchemeRecheck = (): void => {
    if (schemeRecheckTimer !== undefined) {
      clearTimeout(schemeRecheckTimer);
      schemeRecheckTimer = undefined;
    }
  };

  const scheduleSchemeRecheck = (): void => {
    if (disposed || !effectiveTheme() || !env.doc.body || schemeRecheckTimer !== undefined) {
      return;
    }
    schemeRecheckTimer = setTimeout(() => {
      schemeRecheckTimer = undefined;
      if (disposed || !effectiveTheme() || !env.doc.body) {
        return;
      }
      const prev = detectedHostScheme;
      const measured = refreshHostScheme();
      if (measured !== null && (measured !== prev || measured !== lastCssScheme)) {
        render();
      }
    }, SCHEME_RECHECK_DEBOUNCE_MS);
  };

  const schemeObserver =
    typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
          for (const rec of records) {
            if (rec.attributeName === 'style') {
              const target = rec.target as Element;
              const next = readInlineSchemeStyle(target);
              if (next === lastInlineSchemeStyles.get(target)) {
                continue;
              }
              lastInlineSchemeStyles.set(target, next);
            }
            scheduleSchemeRecheck();
            return;
          }
        })
      : undefined;

  const observeRootForScheme = (rootEl: Element | null): void => {
    if (!schemeObserver || !rootEl) {
      return;
    }
    lastInlineSchemeStyles.set(rootEl, readInlineSchemeStyle(rootEl));
    schemeObserver.observe(rootEl, { attributes: true, attributeFilter: SCHEME_ATTR_FILTER });
  };

  const setSchemeObserverActive = (active: boolean): void => {
    if (!schemeObserver) {
      return;
    }
    if (!active) {
      if (schemeObserverActive) {
        schemeObserverActive = false;
        schemeObserver.disconnect();
        cancelSchemeRecheck();
      }
      return;
    }
    if (!schemeObserverActive && !disposed) {
      schemeObserverActive = true;
      observeRootForScheme(env.doc.documentElement);
      observeRootForScheme(env.doc.body);
    }
  };
  cleanups.push(() => {
    setSchemeObserverActive(false);
    cancelSchemeRecheck();
  });

  const colorSchemeMedia = (env.doc.defaultView ?? globalThis).matchMedia?.(
    '(prefers-color-scheme: dark)',
  );
  colorSchemeMedia?.addEventListener?.('change', scheduleSchemeRecheck, {
    signal: linkLoadAbort.signal,
  });

  const render = (): void => {
    if (disposed) {
      return;
    }
    const effective = effectiveTheme();
    const nextPalette = effective?.palette ?? null;
    const nextFont = effective?.fontFamily;
    const backdropActive = hasActiveBackdrop(effective);
    const adaptiveTarget = hasAdaptiveTarget(effective);
    if (!effective) {
      detectedHostScheme = undefined;
    }
    setSchemeObserverActive(Boolean(effective));
    setBackdropWatcherActive(backdropActive);
    setCssomWatcherActive(adaptiveTarget);

    // Re-verify native host polarity on palette transitions (including Appearance Panel
    // `preview()` / `clearPreview()` flows) so toggling from a dark Studio theme to a
    // Light preset never inherits a stale cached scheme.
    if (
      effective &&
      env.doc.body &&
      detectedHostScheme !== undefined &&
      !samePalette(nextPalette, lastCssTheme?.palette ?? null)
    ) {
      refreshHostScheme();
    }

    const currentScheme: ThemeColorScheme = effective ? getHostScheme() : 'dark';
    const adaptiveChanged =
      !hasRenderedCss ||
      !samePalette(nextPalette, lastCssTheme?.palette ?? null) ||
      nextFont !== lastCssTheme?.fontFamily ||
      backdropActive !== hasActiveBackdrop(lastCssTheme) ||
      (adaptiveTarget && currentScheme !== lastAdaptiveScheme);
    const shadowChanged =
      !hasRenderedCss || adaptiveChanged || !sameShadowRelevantTheme(lastCssTheme, effective);
    const cssChanged =
      adaptiveChanged ||
      currentScheme !== lastCssScheme ||
      !sameCssRelevantTheme(lastCssTheme, effective);

    if (adaptiveChanged) {
      cancelAdaptiveRecompile();
      cancelCssomCheck();
      lastAdaptiveScheme = adaptiveTarget ? currentScheme : undefined;
    }

    if (cssChanged) {
      hasRenderedCss = true;
      lastCssTheme = effective;
      lastCssScheme = currentScheme;
      hostCss = effective ? compileHostThemeCss(effective, mapping, currentScheme) : '';
      if (shadowChanged) {
        shadowCss = undefined;
      }
      const uiCss = effective ? compileUiThemeCss(effective) : '';
      setUiThemeCss(uiCss);
      const resolvedScheme = adaptiveChanged ? currentScheme : undefined;
      forEachHostRoot((root) => {
        if (root.nodeType === Node.DOCUMENT_NODE) {
          syncRoot(root, hostCss, adaptiveChanged, resolvedScheme);
        } else if (shadowChanged) {
          syncRoot(root, getShadowCss(), adaptiveChanged, resolvedScheme);
        }
      });
    }
    if (adaptiveChanged) {
      healer?.setBackdropActive(backdropActive);
      healer?.setPalette(nextPalette, currentScheme);
    }
    syncEffectsIfNeeded(effective?.effects, nextPalette, currentScheme);
  };

  const watchHead = (targetEnv: DomEnvironment): (() => void) | undefined => {
    if (targetEnv.doc.head) {
      return undefined;
    }
    const stopHead = targetEnv.watcher.watch('head', {
      added: (head) => {
        stopHead();
        if (disposed) {
          return;
        }
        const existing = findExistingStyle(targetEnv.doc, THEME_STYLE_ID, styles);
        if (existing) {
          if (existing.parentElement !== head) {
            head.append(existing);
          }
          syncAdaptiveForRoot(targetEnv.doc);
        } else if (hostCss) {
          syncRoot(targetEnv.doc, hostCss);
        }
      },
    });
    return stopHead;
  };

  if (adaptiveConfig) {
    // Re-compile Layer 1 automatically whenever the host lazy-loads a new `<style>` or `<link rel="stylesheet">`
    // in light DOM or any discovered open Shadow Root.
    cleanups.push(
      env.watch('style, link[rel="stylesheet"]', {
        added: (el) => {
          if (el.id.startsWith('feed_sanity_') || el.hasAttribute(OWN_ATTR)) {
            return;
          }
          const root = el.getRootNode();
          if (
            root.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
            'host' in root &&
            isOwnShadowRoot(root as ShadowRoot)
          ) {
            return;
          }
          const targetRoot =
            root.nodeType === Node.DOCUMENT_NODE ||
            (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in root)
              ? (root as Document | ShadowRoot)
              : env.doc;
          if (el.localName === 'link') {
            if ((el as HTMLLinkElement).sheet) {
              scheduleAdaptiveRecompile(targetRoot);
            } else {
              el.addEventListener('load', () => scheduleAdaptiveRecompile(targetRoot), {
                once: true,
                signal: linkLoadAbort.signal,
              });
            }
            return;
          }
          scheduleAdaptiveRecompile(targetRoot);
        },
      }),
    );
  }

  cleanups.push(
    env.onShadowRoot((shadow, rootScope) => {
      if (isOwnShadowRoot(shadow)) {
        return;
      }
      syncRoot(shadow, getShadowCss());
      watchShadowCssom(shadow);
      rootScope.add(() => {
        shadowCssomCleanups.get(shadow)?.();
        shadowCssomCleanups.delete(shadow);
        clearPendingCssomRoot(shadow);
        dirtyRoots.delete(shadow);
        lastCssomSnapshots.delete(shadow);
        styles.get(shadow)?.remove();
        styles.delete(shadow);
        adaptiveStyles.get(shadow)?.remove();
        adaptiveStyles.delete(shadow);
      });
    }),
  );

  cleanups.push(
    env.onIframe((childEnv) => {
      iframeDocs.add(childEnv.doc);
      syncRoot(childEnv.doc, hostCss);
      const stopChildHead = watchHead(childEnv);
      if (stopChildHead) {
        iframeCleanups.add(stopChildHead);
        childEnv.scope.add(() => {
          iframeCleanups.delete(stopChildHead);
          stopChildHead();
        });
      }
      childEnv.scope.add(() => {
        iframeDocs.delete(childEnv.doc);
        dirtyRoots.delete(childEnv.doc);
        lastCssomSnapshots.delete(childEnv.doc);
        styles.get(childEnv.doc)?.remove();
        styles.delete(childEnv.doc);
        adaptiveStyles.get(childEnv.doc)?.remove();
        adaptiveStyles.delete(childEnv.doc);
      });
    }),
  );

  // Attach or move `<style>` into `<head>` once parsed (handles both early
  // `documentElement` attachment and `document_start` before `<html>` exists).
  const stopMainHead = watchHead(env);
  if (stopMainHead) {
    cleanups.push(stopMainHead);
  }
  if (!env.doc.body) {
    const stopBody = env.watcher.watch('body', {
      added: (bodyEl) => {
        stopBody();
        if (disposed) {
          return;
        }
        if (schemeObserverActive) {
          observeRootForScheme(env.doc.documentElement);
          observeRootForScheme(bodyEl);
        }
        const effective = effectiveTheme();
        if (effective) {
          const scheme = getHostScheme();
          if (
            scheme !== lastCssScheme ||
            (hasAdaptiveTarget(effective) && scheme !== lastAdaptiveScheme)
          ) {
            render();
          } else if (effective.effects) {
            syncEffectsIfNeeded(effective.effects, effective.palette, scheme, true);
          }
        }
      },
    });
    cleanups.push(stopBody);
  }

  return {
    apply(theme, options) {
      savedTheme = theme;
      if (options?.clearPreview) {
        previewTheme = undefined;
      }
      if (previewTheme === undefined) {
        render();
      }
    },
    preview(theme) {
      previewTheme = theme;
      render();
    },
    clearPreview() {
      if (previewTheme === undefined) {
        return;
      }
      previewTheme = undefined;
      render();
    },
    current: effectiveTheme,
    compiledHostCss: () => {
      if (previewTheme === undefined) {
        return hostCss;
      }
      return savedTheme ? compileHostThemeCss(savedTheme, mapping, getHostScheme()) : '';
    },
    audit() {
      if (disposed) {
        return null;
      }
      const effective = effectiveTheme();
      if (!effective?.palette) {
        return null;
      }
      // Perform a synchronous zero-flicker A/B snapshot on the exact current DOM:
      // disable Feed Sanity's theme stylesheets within one JS turn (before any paint),
      // measure true host geometry & opacity, re-enable them, then run the full audit.
      const restore = disableThemeSheetsForMeasure(true);
      let beforeSnapshot: ReturnType<typeof captureLayoutSnapshot>;
      try {
        beforeSnapshot = captureLayoutSnapshot(env.doc, mediaOpt);
      } finally {
        restore();
      }
      return auditThemeCoverage(env.doc, effective.palette, {
        beforeSnapshot,
        ignoreLayoutShift: Boolean(effective.fontFamily),
        hostScheme: getHostScheme(),
        ...mediaOpt,
      });
    },
    ...(adaptiveConfig
      ? {
          healNow() {
            if (disposed) {
              return 0;
            }
            const scheme = getHostScheme();
            forEachHostRoot((root) => syncAdaptiveForRoot(root, scheme));
            return healer ? healer.healNow() : 0;
          },
        }
      : {}),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      hostCss = '';
      shadowCss = undefined;
      hasRenderedCss = false;
      hasSyncedEffects = false;
      lastCssTheme = null;
      lastCssScheme = undefined;
      lastAdaptiveScheme = undefined;
      lastEffectsConfig = undefined;
      lastEffectsPalette = null;
      lastEffectsScheme = undefined;
      cancelAdaptiveRecompile();
      linkLoadAbort.abort();
      for (const stop of iframeCleanups) {
        stop();
      }
      iframeCleanups.clear();
      for (const stop of cleanups.splice(0)) {
        stop();
      }
      for (const style of styles.values()) {
        style.remove();
      }
      styles.clear();
      for (const style of adaptiveStyles.values()) {
        style.remove();
      }
      adaptiveStyles.clear();
      iframeDocs.clear();
      setUiThemeCss('');
    },
  };
}

/** Helper to wire `ThemeController` cleanup into a `Scope`. */
export function attachThemeScope(scope: Scope, controller: ThemeController): ThemeController {
  scope.add(() => controller.dispose());
  return controller;
}
