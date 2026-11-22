// Framework-generic React 17–19 page-world runtime helpers: inspecting fiber
// chains, reading ancestor Context values, capturing live Context Providers,
// and mounting native host React subtrees into isolated roots without touching
// host modals or `aria-hidden`.
//
// Shared across every React-based target site (Facebook, Instagram, X.com,
// TikTok). Runs in the page's own world, so it imports nothing.

export type Loose = Record<string, unknown>;
export type AnyFunction = (...args: unknown[]) => unknown;

export interface ReactLoader {
  readonly require?: unknown;
}

type RequireModule = (name: string) => unknown;

/** React attaches internal fibers to DOM elements under this prefix. */
export const FIBER_PREFIX = '__reactFiber$';

/** React's fiber tag for `Context.Provider` elements (stable across React 17–19). */
export const CONTEXT_PROVIDER_TAG = 10;

const MAX_CONTEXT_DEPTH = 300;

export const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null;

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

/** Extracts a readable component name from a fiber's `type` (`displayName`, `name`, or wrapper). */
export function componentName(type: unknown): string | undefined {
  if (typeof type === 'function') {
    const fn = type as { displayName?: unknown; name?: unknown };
    if (typeof fn.displayName === 'string' && fn.displayName.length > 0) {
      return fn.displayName;
    }
    return typeof fn.name === 'string' && fn.name.length > 0 ? fn.name : undefined;
  }
  if (isObject(type)) {
    if (typeof type.displayName === 'string' && type.displayName.length > 0) {
      return type.displayName;
    }
    if (typeof type.render === 'function') {
      return componentName(type.render);
    }
    if (type.type !== undefined && type.type !== type) {
      return componentName(type.type);
    }
  }
  return undefined;
}

/**
 * Walks up from `element`'s React fiber, returning the first non-undefined
 * value produced by `visit(fiber, depth)` within `maxDepth` steps.
 */
export function walkFiberUp<T>(
  element: Element,
  visit: (fiber: Loose, depth: number) => T | undefined,
  maxDepth = 30,
): T | undefined {
  let fiber: unknown = fiberOf(element);
  for (let depth = 0; depth <= maxDepth && isObject(fiber); depth++) {
    const found = visit(fiber, depth);
    if (found !== undefined) {
      return found;
    }
    fiber = fiber.return;
  }
  return undefined;
}

/**
 * Runs a bounded breadth-first walk down `element`'s React fiber subtree,
 * returning the first non-undefined value produced by `visit(fiber, depth)`.
 */
export function walkFiberBfs<T>(
  element: Element,
  visit: (fiber: Loose, depth: number) => T | undefined,
  { maxDepth = 16, maxNodes = 240 }: { maxDepth?: number; maxNodes?: number } = {},
): T | undefined {
  const root = fiberOf(element);
  if (!isObject(root)) {
    return undefined;
  }
  const fibers: Loose[] = [root];
  const depths: number[] = [0];
  let head = 0;
  while (head < fibers.length && head < maxNodes) {
    const fiber = fibers[head];
    const depth = depths[head] ?? 0;
    head++;
    if (!fiber) {
      break;
    }
    const found = visit(fiber, depth);
    if (found !== undefined) {
      return found;
    }
    if (depth < maxDepth) {
      let child: unknown = fiber.child;
      while (isObject(child) && fibers.length < maxNodes) {
        fibers.push(child);
        depths.push(depth + 1);
        child = child.sibling;
      }
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

/** Returns the first live React root anchor matching `selectors` (defaults to `[role=main]`, `#react-root`). */
export function findMountAnchor(
  selectors: readonly string[] = ['[role=main]', '#react-root'],
): Element | null {
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Requires a host module safely through `loader.require`, returning undefined on error or missing loader. */
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
 * Skips `<Context.Consumer>` fibers (`tag !== 10` without `value` prop).
 */
export function findContextValue(
  root: Element,
  context: unknown,
  maxDepth = MAX_CONTEXT_DEPTH,
): unknown {
  if (!isObject(context)) {
    return undefined;
  }
  return walkFiberUp(
    root,
    (fiber) => {
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
    },
    maxDepth,
  );
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
  walkFiberUp(
    anchor,
    (fiber) => {
      if (fiber.tag === CONTEXT_PROVIDER_TAG && fiber.type && isObject(fiber.memoizedProps)) {
        const typeObj = isObject(fiber.type) ? fiber.type : null;
        const contextKey = typeObj?._context ?? fiber.type;
        if (!seen.has(contextKey)) {
          seen.add(contextKey);
          providers.push({ provider: fiber.type, value: fiber.memoizedProps.value });
        }
      }
    },
    maxDepth,
  );
  return providers;
}

const boundaryByComponent = new WeakMap<AnyFunction, unknown>();

function getErrorBoundaryClass(Component: AnyFunction): unknown {
  let Boundary = boundaryByComponent.get(Component);
  if (!Boundary) {
    const BaseComponent = Component as unknown as new (
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
    Boundary = SilentErrorBoundary;
    boundaryByComponent.set(Component, Boundary);
  }
  return Boundary;
}

/**
 * Mounts a native host React subtree into `target` using the host's own
 * `ReactDOM.createRoot`, inheriting every live React Context Provider from
 * `anchor` and isolating failures behind an `ErrorBoundary` and `Suspense`.
 *
 * Returns an unmount function, or null when the host's React runtime or
 * `createRoot` is unavailable.
 */
export function mountReactComponent(
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
  const SilentErrorBoundary = getErrorBoundaryClass(Component as AnyFunction);

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
      // Ignore unmount errors if the host already tore down the DOM subtree.
    }
  };
}
