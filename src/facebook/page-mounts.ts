// Page-world mounts for rendering native Facebook Comet/Relay components into
// content-script-created slots (such as the Home left and right rails on
// alternate feed pages). Runs in the page's own world.

import type { PageMount, PageMounts } from '../core/page-world';
import type { AnyFunction, Loose, PageLoader, RequireLazy } from './module-hook';
import { isObject } from './module-hook';
import {
  findMountAnchor,
  loadModule,
  mountFacebookComponent,
  resolveDefaultExport,
} from './react-host';

/** Mounts Facebook's native Home left navigation rail (`CometClassicHomeLeftRailContainer`). */
export const HOME_LEFT_RAIL = 'home-left-rail';

/** Mounts Facebook's native Home right rail (`CometHomeRightRail`: Birthdays and cards). */
export const HOME_RIGHT_RAIL = 'home-right-rail';

interface RailSpec {
  readonly componentModule: string;
  readonly queryKey: string;
  readonly propName?: string;
}

const LEFT_RAIL_SPEC: RailSpec = {
  componentModule: 'CometClassicHomeLeftRailContainer.react',
  queryKey: 'leftRailContainerQueryReference',
};

const RIGHT_RAIL_SPEC: RailSpec = {
  componentModule: 'CometHomeRightRail.react',
  queryKey: 'rightSideHeaderCardsQueryReference',
};

/**
 * Builds a lifecycle-managed page-world mount for one of Facebook's Home rails
 * (`CometClassicHomeLeftRailContainer.react` or `CometHomeRightRail.react`).
 *
 * Preloads the `CometHomeRoot` JS bundle on demand, executes the matching
 * Relay query inside Facebook's own `CometRelay` environment inherited from
 * `[role=main]`, and disposes both the Relay query and the isolated React root
 * when unmounted.
 */
export function createHomeRailMount(
  spec: RailSpec,
  loader: PageLoader = globalThis as PageLoader,
): PageMount {
  const propName = spec.propName ?? spec.queryKey;
  return (target) => {
    const anchor = findMountAnchor();
    if (!anchor) {
      return null;
    }

    let disposed = false;
    let unmountRoot: (() => void) | null = null;
    let cachedEnv: unknown;
    let activeQueryRef: Loose | null = null;

    const disposeQueryRef = (ref: Loose | null): void => {
      if (ref && typeof ref.dispose === 'function') {
        try {
          (ref.dispose as () => void)();
        } catch {
          // Ignore Relay disposal errors during teardown.
        }
      }
      if (activeQueryRef === ref) {
        activeQueryRef = null;
        cachedEnv = undefined;
      }
    };

    const startWithModules = (entrypoint: unknown, relay: unknown): boolean => {
      if (disposed || !target.isConnected || !anchor.isConnected) {
        return false;
      }
      if (!isObject(entrypoint) || !isObject(relay)) {
        return false;
      }
      const getPreloadProps = entrypoint.getPreloadProps;
      const rootResource = entrypoint.root;
      const useRelayEnvironment = relay.useRelayEnvironment;
      const loadQuery = relay.loadQuery;
      if (
        typeof getPreloadProps !== 'function' ||
        !isObject(rootResource) ||
        typeof rootResource.load !== 'function' ||
        typeof useRelayEnvironment !== 'function' ||
        typeof loadQuery !== 'function'
      ) {
        return false;
      }

      let querySpec: Loose | undefined;
      try {
        const preload = (getPreloadProps as AnyFunction)({ routeProps: {}, routeParams: {} });
        const queries =
          isObject(preload) && isObject(preload.queries) ? preload.queries : undefined;
        const entry = queries ? queries[spec.queryKey] : undefined;
        if (isObject(entry) && entry.parameters) {
          querySpec = entry;
        }
      } catch {
        return false;
      }
      if (!querySpec) {
        return false;
      }
      const parameters = querySpec.parameters;
      const variables = isObject(querySpec.variables) ? querySpec.variables : {};

      const mountLoaded = (resolved?: AnyFunction | null): void => {
        if (disposed || !target.isConnected || !anchor.isConnected) {
          return;
        }
        const RailComponent =
          resolved ?? resolveDefaultExport(loadModule(loader, spec.componentModule));
        if (!RailComponent) {
          return;
        }
        unmountRoot = mountFacebookComponent(loader, target, anchor, (reactMod) => {
          const createElement = reactMod.createElement as AnyFunction;
          const useMemo = reactMod.useMemo as <T>(factory: () => T, deps: unknown[]) => T;
          const useEffect = reactMod.useEffect as (
            effect: () => undefined | (() => void),
            deps: unknown[],
          ) => void;
          if (typeof useMemo !== 'function' || typeof useEffect !== 'function') {
            return null;
          }
          function RailRunner(): unknown {
            const env = (useRelayEnvironment as AnyFunction)();
            const queryRef = useMemo(() => {
              // Reuse the live queryRef across React 18/19 Suspense retries for
              // the same Relay environment so uncommitted renders do not leak
              // duplicate `loadQuery` retain handles.
              if (activeQueryRef && cachedEnv === env) {
                return activeQueryRef;
              }
              disposeQueryRef(activeQueryRef);
              const next = (loadQuery as AnyFunction)(env, parameters, variables, {
                fetchPolicy: 'store-or-network',
              });
              if (isObject(next)) {
                cachedEnv = env;
                activeQueryRef = next;
              }
              return next;
            }, [env]);
            useEffect(
              () => () => {
                if (isObject(queryRef)) {
                  disposeQueryRef(queryRef);
                }
              },
              [queryRef],
            );
            return createElement(RailComponent, { [propName]: queryRef });
          }
          return createElement(RailRunner, null);
        });
      };

      const existing = resolveDefaultExport(loadModule(loader, spec.componentModule));
      if (existing) {
        mountLoaded(existing);
      } else {
        Promise.resolve((rootResource.load as () => Promise<unknown>)())
          .then(() => mountLoaded())
          .catch(() => undefined);
      }
      return true;
    };

    // Prefer Facebook's `requireLazy` so deferred dependencies of
    // `CometHomeRoot.entrypoint` finish loading before requiring it.
    if (typeof loader.requireLazy === 'function') {
      try {
        (loader.requireLazy as RequireLazy)(
          ['CometHomeRoot.entrypoint', 'CometRelay'],
          (entrypoint, relay) => {
            startWithModules(entrypoint, relay);
          },
        );
      } catch {
        return null;
      }
    } else if (
      !startWithModules(
        loadModule(loader, 'CometHomeRoot.entrypoint'),
        loadModule(loader, 'CometRelay'),
      )
    ) {
      return null;
    }

    return () => {
      disposed = true;
      unmountRoot?.();
      unmountRoot = null;
      disposeQueryRef(activeQueryRef);
    };
  };
}

/** Every lifecycle-managed mount the page-world side offers. */
export const PAGE_MOUNTS: PageMounts = {
  [HOME_LEFT_RAIL]: createHomeRailMount(LEFT_RAIL_SPEC),
  [HOME_RIGHT_RAIL]: createHomeRailMount(RIGHT_RAIL_SPEC),
};
