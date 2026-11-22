// Page-world actions for Facebook's own Comet UI. They run in the page's own
// world, as part of the page-world side of the bridge (see `src/page-world.ts`),
// so this file imports only small page-world helpers and types.

import type { PageAction, PageActions } from '../core/page-world';
import type { AnyFunction, Loose, PageLoader } from './module-hook';
import { isObject, observeModules, readModulesMap } from './module-hook';
import { findContextValue, findMountAnchor, loadModule, resolveDefaultExport } from './react-host';

/** The action that opens Facebook's native "Create post" composer dialog. */
export const OPEN_POST_COMPOSER = 'open-post-composer';

/**
 * The action that configures and optionally refreshes Facebook's Home feed
 * stream (`CometModernHomeFeedQuery`) in place on `https://www.facebook.com/`
 * without changing the URL.
 */
export const SET_HOME_FEED = 'set-home-feed';

const HOME_VARS_MODULE = 'CometHomeRootEntryPointVariables';
const MAX_DIALOG_CONTEXT_DEPTH = 200;

export interface OpenPostComposerAnswer {
  opened: boolean;
}

export interface SetHomeFeedAnswer {
  applied: boolean;
  refreshed: boolean;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

function showArgsFor(mode: 'post' | 'media' | 'feeling'): Loose {
  if (mode === 'feeling') {
    return { pushedPageOnLoad: 'feeling' };
  }
  if (mode === 'media') {
    return { additionalMediaAttachmentItems: [] };
  }
  return {};
}

/**
 * Builds the `open-post-composer` page-world action bound to `loader`.
 *
 * Pushes a tiny renderless launcher component into Facebook's own
 * `CometDialogContext` so `useFeedComposerCometDialog` runs inside Facebook's
 * Relay, Router and theme providers and opens the native "Create post" modal
 * on pages such as Friends, Favorites, Groups, Pages and Most recent.
 */
export function createOpenPostComposerAction(
  loader: PageLoader = globalThis as PageLoader,
): PageAction {
  return (payload): OpenPostComposerAnswer => {
    const mode =
      payload.mode === 'media' || payload.mode === 'feeling' || payload.mode === 'post'
        ? payload.mode
        : 'post';

    const root = findMountAnchor();
    if (!root) {
      return { opened: false };
    }
    const reactMod = loadModule(loader, 'react');
    const dialogCtx = loadModule(loader, 'CometDialogContext');
    const currentUser = loadModule(loader, 'CurrentUserInitialData');
    const composerHookMod = loadModule(loader, 'useFeedComposerCometDialog');

    const useEffect =
      isObject(reactMod) && typeof reactMod.useEffect === 'function'
        ? (reactMod.useEffect as (effect: () => void, deps: unknown[]) => void)
        : null;
    const useFeedComposer = resolveDefaultExport(composerHookMod);
    const userId = isObject(currentUser) ? text(currentUser.USER_ID) : null;
    const dialogVal = findContextValue(root, dialogCtx, MAX_DIALOG_CONTEXT_DEPTH);
    const pushDialog = typeof dialogVal === 'function' ? (dialogVal as AnyFunction) : null;

    if (!useEffect || !useFeedComposer || !userId || !pushDialog) {
      return { opened: false };
    }

    const showArgs = showArgsFor(mode);

    function ComposerLauncher(props: Loose): null {
      const cleanup =
        typeof props.onClose === 'function' ? (props.onClose as AnyFunction) : undefined;
      const result = useFeedComposer?.({
        composerEntryPointName: 'inline_composer',
        composerSourceSurface: 'newsfeed',
        composerType: 'feed',
        profileID: userId,
        tracePolicy: 'comet.composer.feed',
        onClose: cleanup,
        onCloseWithoutSave: cleanup,
        onSubmit: cleanup,
      });
      const show =
        Array.isArray(result) && typeof result[0] === 'function'
          ? (result[0] as AnyFunction)
          : null;
      useEffect?.(() => {
        show?.(showArgs);
      }, []);
      return null;
    }

    try {
      pushDialog(ComposerLauncher, {}, { loadType: 'eager', tracePolicy: 'comet.composer.feed' });
      return { opened: true };
    } catch {
      return { opened: false };
    }
  };
}

/**
 * True when `location` is the plain Home address (`/` or `/home.php` with an
 * empty query string), matching `isPlainHome` in `src/facebook/home-feed.ts`
 * so explicit queries like `/?sk=h_nor` or `/?notif_id=...` are left alone.
 */
function isPlainHomeLocation(): boolean {
  const { pathname, search } = location;
  return (pathname === '/' || pathname === '/home.php') && search === '';
}

/**
 * Builds the `set-home-feed` page-world action bound to `loader`.
 *
 * Passively hooks `CometHomeRootEntryPointVariables.getCometFeedVariablesForSk`
 * so `CometModernHomeFeedQuery` on `https://www.facebook.com/` loads and
 * paginates the user's chosen chronological feed (`Friends` = 17, `Favorites`
 * = 12, `Groups` = 18, `Pages` = 19, `Most recent` = 16) in place without
 * redirecting the URL. When `refresh: true` is passed, triggers Facebook's
 * live `CometHomeRefreshContext.refreshHandler('MANUAL')` to switch feeds
 * immediately.
 */
export function createSetHomeFeedAction(loader: PageLoader = globalThis as PageLoader): PageAction {
  let activeFeedStyle: number | null = null;
  let varsMod: Loose | undefined;
  let stopObserving: (() => void) | undefined;

  const stopObserver = (): void => {
    stopObserving?.();
    stopObserving = undefined;
  };

  const installWrapper = (mod: Loose): boolean => {
    if (varsMod) {
      return true;
    }
    if (typeof mod.getCometFeedVariablesForSk !== 'function') {
      return false;
    }
    const desc = Object.getOwnPropertyDescriptor(mod, 'getCometFeedVariablesForSk');
    if (desc?.writable !== true) {
      return false;
    }
    const base = mod.getCometFeedVariablesForSk as AnyFunction;
    mod.getCometFeedVariablesForSk = function wrappedGetVars(
      this: unknown,
      feedStyle: unknown,
      sk: unknown,
      refreshMode: unknown,
      vpvs: unknown,
    ): unknown {
      if (activeFeedStyle !== null && isPlainHomeLocation()) {
        return base.call(this, activeFeedStyle, 'h_chr', refreshMode, vpvs);
      }
      return base.call(this, feedStyle, sk, refreshMode, vpvs);
    };
    varsMod = mod;
    stopObserver();
    return true;
  };

  const ensureObserved = (): boolean => {
    if (varsMod) {
      return true;
    }
    // Prefer passive `__debug.modulesMap` observation whenever Facebook's
    // module registry exists so we never force-execute an uninitialized
    // `*EntryPointVariables` factory before ServerJS populates `qex`.
    if (readModulesMap(loader)) {
      if (!stopObserving) {
        stopObserving = observeModules(loader, [HOME_VARS_MODULE], (record) => {
          installWrapper(record.exports);
        });
      }
      return varsMod !== undefined;
    }
    const direct = loadModule(loader, HOME_VARS_MODULE);
    if (isObject(direct) && installWrapper(direct)) {
      return true;
    }
    if (!stopObserving) {
      stopObserving = observeModules(loader, [HOME_VARS_MODULE], (record) => {
        installWrapper(record.exports);
      });
    }
    return varsMod !== undefined;
  };

  const triggerRefresh = (): boolean => {
    const anchor =
      document.querySelector('[aria-posinset]') ??
      document.querySelector('[role=feed]') ??
      document.querySelector('[role=main]');
    const refreshCtx = loadModule(loader, 'CometHomeRefreshContext');
    if (!anchor || !refreshCtx) {
      return false;
    }
    const ctxVal = findContextValue(anchor, refreshCtx);
    if (isObject(ctxVal) && typeof ctxVal.refreshHandler === 'function') {
      try {
        (ctxVal.refreshHandler as AnyFunction)('MANUAL');
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  return (payload): SetHomeFeedAnswer => {
    const rawStyle = payload.feedStyle;
    activeFeedStyle =
      typeof rawStyle === 'number' && Number.isInteger(rawStyle) && rawStyle > 0 ? rawStyle : null;

    if (activeFeedStyle === null && !varsMod) {
      stopObserver();
      return { applied: false, refreshed: false };
    }
    const applied = ensureObserved();
    const refreshed = payload.refresh === true && applied ? triggerRefresh() : false;
    return { applied, refreshed };
  };
}

/** Every action the page-world side offers. */
export const PAGE_ACTIONS: PageActions = {
  [OPEN_POST_COMPOSER]: createOpenPostComposerAction(),
  [SET_HOME_FEED]: createSetHomeFeedAction(),
};
