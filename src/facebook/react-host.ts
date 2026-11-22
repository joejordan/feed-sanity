// Page-world React runtime helpers for inspecting Facebook's fiber tree and
// mounting native Facebook React/Relay components into isolated roots while
// inheriting Facebook's live Context providers (Relay, Router, Dialogs, Theme,
// Density, Tooltips) without touching `CometDialogContext` or `aria-hidden`.
//
// Runs in the page's own world, so it imports only small page-world helpers.

import type { AnyFunction, Loose } from './module-hook';
import { isObject } from './module-hook';

export interface ReactLoader {
  readonly require?: unknown;
}

type RequireModule = (name: string) => unknown;

/** React attaches internal fibers to DOM elements under this prefix. */
export const FIBER_PREFIX = '__reactFiber$';

/** React's fiber tag for `Context.Provider` elements (stable across React 17–19). */
const CONTEXT_PROVIDER_TAG = 10;

const MAX_CONTEXT_DEPTH = 300;

let cachedFiberKey: string | undefined;

/** Returns the React fiber attached to `element`, if any. */
export function fiberOf(element: Element): Loose | undefined {
  const host = element as unknown as Loose;
  if (cachedFiberKey && cachedFiberKey in host) {
    const value = host[cachedFiberKey];
    return isObject(value) ? value : undefined;
  }
  for (const key of Object.keys(element)) {
    if (key.startsWith(FIBER_PREFIX)) {
      cachedFiberKey = key;
      const value = host[key];
      return isObject(value) ? value : undefined;
    }
  }
  return undefined;
}

/** Unwraps either a direct function export or a `{ default: fn }` module object. */
export function resolveDefaultExport(mod: unknown): AnyFunction | null {
  if (typeof mod === 'function') {
    return mod as AnyFunction;
  }
  if (isObject(mod) && typeof mod.default === 'function') {
    return mod.default as AnyFunction;
  }
  return null;
}

/** Returns the live Facebook React root anchor (`[role=main]` or `#mount_0_0...`). */
export function findMountAnchor(): Element | null {
  return document.querySelector('[role=main]') ?? document.querySelector('[id^=mount_0_0]');
}

/** Requires a Facebook module safely, returning undefined on error or missing loader. */
export function loadModule(loader: ReactLoader, name: string): unknown {
  if (typeof loader.require !== 'function') {
    return undefined;
  }
  try {
    return (loader.require as RequireModule)(name);
  } catch {
    return undefined;
  }
}

/**
 * Walks up `root`'s React fiber chain to find the nearest Provider value for
 * `context`, returning undefined if not found within `maxDepth` fibers.
 */
export function findContextValue(
  root: Element,
  context: unknown,
  maxDepth = MAX_CONTEXT_DEPTH,
): unknown {
  if (!isObject(context)) {
    return undefined;
  }
  let fiber: unknown = fiberOf(root);
  for (let depth = 0; depth <= maxDepth && isObject(fiber); depth++) {
    const { type } = fiber;
    const isProvider = fiber.tag === undefined || fiber.tag === CONTEXT_PROVIDER_TAG;
    const matches =
      isProvider &&
      (type === context ||
        (context.Provider !== undefined && type === context.Provider) ||
        (isObject(type) && type._context === context));
    if (matches && isObject(fiber.memoizedProps) && 'value' in fiber.memoizedProps) {
      return fiber.memoizedProps.value;
    }
    fiber = fiber.return;
  }
  return undefined;
}

export interface CapturedProvider {
  readonly provider: unknown;
  readonly value: unknown;
}

/**
 * Collects the nearest live value for every React Context Provider above
 * `anchor`, ordered inner-to-outer so reducing wraps the tree faithfully.
 */
export function collectContextProviders(
  anchor: Element,
  maxDepth = MAX_CONTEXT_DEPTH,
): CapturedProvider[] {
  const providers: CapturedProvider[] = [];
  const seen = new Set<unknown>();
  let fiber: unknown = fiberOf(anchor);
  for (let depth = 0; depth <= maxDepth && isObject(fiber); depth++) {
    if (fiber.tag === CONTEXT_PROVIDER_TAG && fiber.type && isObject(fiber.memoizedProps)) {
      const typeObj = isObject(fiber.type) ? fiber.type : null;
      const contextKey = typeObj?._context ?? fiber.type;
      if (!seen.has(contextKey)) {
        seen.add(contextKey);
        providers.push({ provider: fiber.type, value: fiber.memoizedProps.value });
      }
    }
    fiber = fiber.return;
  }
  return providers;
}

/**
 * Mounts a native Facebook React subtree into `target` using Facebook's own
 * `ReactDOM.createRoot`, inheriting every live React Context Provider from
 * `anchor` and isolating failures behind an `ErrorBoundary` and `Suspense`.
 *
 * Returns an unmount function, or null when Facebook's React runtime or
 * `createRoot` is unavailable.
 */
export function mountFacebookComponent(
  loader: ReactLoader,
  target: Element,
  anchor: Element,
  render: (react: Loose) => unknown,
): (() => void) | null {
  const reactMod = loadModule(loader, 'react');
  const reactDom = loadModule(loader, 'ReactDOM');
  if (!isObject(reactMod) || !isObject(reactDom)) {
    return null;
  }
  const createElement = reactMod.createElement;
  const createRoot = reactDom.createRoot;
  const Component = reactMod.Component;
  const Suspense = reactMod.Suspense;
  if (
    typeof createElement !== 'function' ||
    typeof createRoot !== 'function' ||
    typeof Component !== 'function'
  ) {
    return null;
  }

  let content = render(reactMod);
  if (content === null || content === undefined) {
    return null;
  }
  const providers = collectContextProviders(anchor);
  const BaseComponent = Component as new (
    props: Loose,
  ) => {
    props: Loose;
    state: Loose;
  };

  class SilentErrorBoundary extends BaseComponent {
    static getDerivedStateFromError(): Loose {
      return { failed: true };
    }

    constructor(props: Loose) {
      super(props);
      this.state = { failed: false };
    }

    render(): unknown {
      return this.state.failed ? null : this.props.children;
    }
  }

  if (Suspense) {
    content = (createElement as AnyFunction)(Suspense, { fallback: null }, content);
  }
  content = (createElement as AnyFunction)(SilentErrorBoundary, null, content);
  for (const { provider, value } of providers) {
    content = (createElement as AnyFunction)(provider, { value }, content);
  }

  const root = (createRoot as AnyFunction)(target);
  if (!isObject(root) || typeof root.render !== 'function' || typeof root.unmount !== 'function') {
    return null;
  }
  (root.render as AnyFunction)(content);

  let unmounted = false;
  return () => {
    if (unmounted) {
      return;
    }
    unmounted = true;
    try {
      (root.unmount as AnyFunction)();
    } catch {
      // Ignore unmount errors if Facebook already tore down the DOM subtree.
    }
  };
}
