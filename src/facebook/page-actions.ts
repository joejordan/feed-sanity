// Page-world actions for Facebook's own Comet UI. They run in the page's own
// world, as part of the page-world side of the bridge (see `src/page-world.ts`),
// so this file imports nothing but types and keeps to small, well-scoped actions.

import type { PageAction, PageActions } from '../core/page-world';

/** The action that opens Facebook's native "Create post" composer dialog. */
export const OPEN_POST_COMPOSER = 'open-post-composer';

/** How many fibers up from `[role=main]` to search for `CometDialogContext`. */
const MAX_DIALOG_CONTEXT_DEPTH = 200;

const FIBER_PREFIX = '__reactFiber$';

type Loose = Record<string, unknown>;
type AnyFunction = (...args: unknown[]) => unknown;
type RequireModule = (name: string) => unknown;

export interface ActionLoader {
  readonly require?: unknown;
}

export interface OpenPostComposerAnswer {
  opened: boolean;
}

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

function fiberOf(element: Element): unknown {
  for (const key of Object.keys(element)) {
    if (key.startsWith(FIBER_PREFIX)) {
      return (element as unknown as Loose)[key];
    }
  }
  return undefined;
}

function loadModule(loader: ActionLoader, name: string): unknown {
  if (typeof loader.require !== 'function') {
    return undefined;
  }
  try {
    return (loader.require as RequireModule)(name);
  } catch {
    return undefined;
  }
}

/** Walks up from `root` to find Facebook's `CometDialogContext` Provider value (`pushDialog`). */
function findPushDialog(root: Element, dialogContext: unknown): AnyFunction | null {
  if (!isObject(dialogContext)) {
    return null;
  }
  let fiber = fiberOf(root);
  for (let depth = 0; depth <= MAX_DIALOG_CONTEXT_DEPTH && isObject(fiber); depth++) {
    const { type } = fiber;
    const matches =
      type === dialogContext ||
      type === dialogContext.Provider ||
      (isObject(type) && type._context === dialogContext);
    if (matches && isObject(fiber.memoizedProps)) {
      const { value } = fiber.memoizedProps;
      if (typeof value === 'function') {
        return value as AnyFunction;
      }
    }
    fiber = fiber.return;
  }
  return null;
}

function resolveHook(mod: unknown): AnyFunction | null {
  if (typeof mod === 'function') {
    return mod as AnyFunction;
  }
  if (isObject(mod) && typeof mod.default === 'function') {
    return mod.default as AnyFunction;
  }
  return null;
}

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
  loader: ActionLoader = globalThis as ActionLoader,
): PageAction {
  return (payload): OpenPostComposerAnswer => {
    const mode =
      payload.mode === 'media' || payload.mode === 'feeling' || payload.mode === 'post'
        ? payload.mode
        : 'post';

    const root = document.querySelector('[role=main]') ?? document.querySelector('[id^=mount_0_0]');
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
    const useFeedComposer = resolveHook(composerHookMod);
    const userId = isObject(currentUser) ? text(currentUser.USER_ID) : null;
    const pushDialog = findPushDialog(root, dialogCtx);

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

/** Every action the page-world side offers. */
export const PAGE_ACTIONS: PageActions = {
  [OPEN_POST_COMPOSER]: createOpenPostComposerAction(),
};
