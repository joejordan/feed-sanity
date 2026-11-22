// Re-exports Facebook's React runtime helpers from the site-agnostic
// `src/engines/react/` engine, keeping Facebook's mount anchor fallback and
// `mountFacebookComponent` alias for existing callers.
import { findMountAnchor as findGenericMountAnchor } from '../engines/react';

export type { AnyFunction, CapturedProvider, Loose, ReactLoader } from '../engines/react';
export {
  collectContextProviders,
  componentName,
  FIBER_PREFIX,
  fiberOf,
  findContextValue,
  isObject,
  loadModule,
  mountReactComponent as mountFacebookComponent,
  resolveDefaultExport,
  walkFiberBfs,
  walkFiberUp,
} from '../engines/react';

/** Returns Facebook's live React root anchor (`[role=main]` or `#mount_0_0...`). */
export function findMountAnchor(): Element | null {
  return findGenericMountAnchor(['[role=main]', '[id^=mount_0_0]']);
}
