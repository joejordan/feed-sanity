import type { DomEnvironment } from '../dom-env';
import type { Scope } from '../scope';
import type { ThemeAuditReport, ThemeHealer } from '../theme';
import type { ResolvedTheme, SiteThemeMapping, ThemeColorScheme, ThemePalette } from './types';
import { OWN_ATTR } from '../surface';
import {
  auditThemeCoverage,
  captureLayoutSnapshot,
  compileAdaptiveRootCss,
  createThemeHealer,
  detectHostColorScheme,
  HEALER_STYLE_ID,
  isOwnUiElement,
} from '../theme';
import { createEffectsLayerController } from '../theme-effects';
import { compileHostThemeCss, compileShadowThemeCss, compileUiThemeCss } from './compile';
import { THEME_STYLE_ID } from './early-cache';

const ADAPTIVE_STYLE_ID = 'feed_sanity_adaptive_theme';

const isOwnShadowRoot = (shadow: ShadowRoot): boolean => isOwnUiElement(shadow.host);

export interface ThemeController {
  /** Applies the persisted user theme (or clears it when `null`). */
  apply: (theme: ResolvedTheme | null) => void;
  /** Temporarily previews a theme (including `null` to preview Site Default). */
  preview: (theme: ResolvedTheme | null) => void;
  /** Ends any active preview and restores the persisted user theme. */
  clearPreview: () => void;
  /** Currently active effective theme (preview if active, else saved). */
  current: () => ResolvedTheme | null;
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
  let recompileTimer: ReturnType<typeof setTimeout> | undefined;
  const linkLoadAbort = new AbortController();

  const styles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const adaptiveStyles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const iframeDocs = new Set<Document>();
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
    const toggleRoot = (root: Document | ShadowRoot): void => {
      for (const id of [THEME_STYLE_ID, ADAPTIVE_STYLE_ID, HEALER_STYLE_ID]) {
        const el = root.querySelector(`#${id}`);
        const sheet = el && el.localName === 'style' ? (el as HTMLStyleElement).sheet : null;
        if (sheet && !sheet.disabled) {
          sheet.disabled = true;
          toggled.push(sheet);
        }
      }
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

  const detectNativeHostScheme = (): ThemeColorScheme => {
    const restore = disableThemeSheetsForMeasure(false);
    try {
      return detectHostColorScheme(env.doc);
    } finally {
      restore();
    }
  };

  const getHostScheme = (): ThemeColorScheme => {
    if (detectedHostScheme !== undefined) {
      return detectedHostScheme;
    }
    const scheme = detectNativeHostScheme();
    // Only lock in the detected scheme once `<body>` exists so an early `document_start`
    // render before host styles parse never permanently caches a fallback scheme.
    if (env.doc.body) {
      detectedHostScheme = scheme;
    }
    return scheme;
  };

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

  let lastAdaptivePalette: ThemePalette | null = null;

  const samePaletteColors = (a: ThemePalette | null, b: ThemePalette | null): boolean => {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return (
      a.colorScheme === b.colorScheme &&
      a.background === b.background &&
      a.surface === b.surface &&
      a.surfaceAlt === b.surfaceAlt &&
      a.text === b.text &&
      a.textMuted === b.textMuted &&
      a.border === b.border &&
      a.accent === b.accent &&
      a.accentText === b.accentText &&
      a.danger === b.danger
    );
  };

  const syncAdaptiveForRoot = (
    root: Document | ShadowRoot,
    resolvedHostScheme?: ThemeColorScheme,
  ): void => {
    if (!adaptiveConfig) {
      return;
    }
    dirtyRoots.delete(root);
    const palette = effectiveTheme()?.palette ?? null;
    if (!palette) {
      syncNamedRoot(root, ADAPTIVE_STYLE_ID, adaptiveStyles, '');
      return;
    }
    const css = compileAdaptiveRootCss(root, palette, {
      hostScheme: resolvedHostScheme ?? getHostScheme(),
      ...(adaptiveConfig.brandColors ? { brandColors: adaptiveConfig.brandColors } : {}),
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
    if (!adaptiveConfig || disposed || !effectiveTheme()?.palette) {
      return;
    }
    dirtyRoots.add(root);
    if (recompileTimer !== undefined) {
      return;
    }
    recompileTimer = setTimeout(() => {
      recompileTimer = undefined;
      if (disposed || !effectiveTheme()?.palette) {
        dirtyRoots.clear();
        return;
      }
      const batch = [...dirtyRoots];
      dirtyRoots.clear();
      const scheme = getHostScheme();
      for (const dirty of batch) {
        if (dirty.nodeType === Node.DOCUMENT_NODE || (dirty as ShadowRoot).host.isConnected) {
          syncAdaptiveForRoot(dirty, scheme);
        }
      }
    }, 0);
  };

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

  const render = (): void => {
    if (disposed) {
      return;
    }
    const effective = effectiveTheme();
    const nextPalette = effective?.palette ?? null;
    const paletteChanged = !samePaletteColors(nextPalette, lastAdaptivePalette);
    if (paletteChanged) {
      cancelAdaptiveRecompile();
      lastAdaptivePalette = nextPalette;
    }
    let resolvedScheme: ThemeColorScheme | undefined;
    if (adaptiveConfig) {
      if (nextPalette) {
        if (detectedHostScheme === undefined && env.doc.body) {
          detectedHostScheme = detectNativeHostScheme();
        }
        if (paletteChanged) {
          resolvedScheme = getHostScheme();
        }
      } else {
        detectedHostScheme = undefined;
      }
    }
    const currentScheme = resolvedScheme ?? getHostScheme();
    hostCss = effective ? compileHostThemeCss(effective, mapping, currentScheme) : '';
    shadowCss = undefined;
    const uiCss = effective ? compileUiThemeCss(effective) : '';
    setUiThemeCss(uiCss);
    syncRoot(env.doc, hostCss, paletteChanged, resolvedScheme);
    if (env.shadowRoots.size > 0) {
      const compiledShadow = getShadowCss();
      for (const shadow of env.shadowRoots) {
        if (!isOwnShadowRoot(shadow)) {
          syncRoot(shadow, compiledShadow, paletteChanged, resolvedScheme);
        }
      }
    }
    for (const iframeDoc of iframeDocs) {
      syncRoot(iframeDoc, hostCss, paletteChanged, resolvedScheme);
    }
    const backdropActive = Boolean(effective?.effects && effective.effects.backdrop !== 'none');
    healer?.setBackdropActive(backdropActive);
    healer?.setPalette(nextPalette);
    effectsLayer.sync(effective?.effects, nextPalette, currentScheme);
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
      rootScope.add(() => {
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
        childEnv.scope.add(stopChildHead);
        cleanups.push(stopChildHead);
      }
      childEnv.scope.add(() => {
        iframeDocs.delete(childEnv.doc);
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
      added: () => {
        stopBody();
        if (disposed) {
          return;
        }
        const effective = effectiveTheme();
        if (effective?.effects) {
          effectsLayer.sync(effective.effects, effective.palette, getHostScheme());
        }
      },
    });
    cleanups.push(stopBody);
  }

  return {
    apply(theme) {
      savedTheme = theme;
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
      cancelAdaptiveRecompile();
      linkLoadAbort.abort();
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
