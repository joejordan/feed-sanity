import type { FeatureRunner, FeatureStatus } from '../core/app';
import type { LocatorStats } from '../core/locator';
import type { Badge } from '../core/platform';
import type { ClassNameStats } from '../facebook/atoms';
import type { PageStats } from '../facebook/feature';
import type { PostStats } from '../facebook/posts';
import { pageContext } from '../facebook/page';

/** Everything the Diagnostics section shows, read at one moment. */
export interface Diagnostics {
  readonly version: string;
  /** Which build this is, such as `Chrome extension`. */
  readonly build: string;
  /** The page type from `pageContext`. On some pages it is a profile's name. */
  readonly pageType: string;
  readonly badge: Badge;
  readonly features: readonly FeatureStatus[];
  readonly posts: PostStats;
  readonly classNames: ClassNameStats;
  readonly locators: readonly LocatorStats[];
  /** When it was read, in milliseconds since 1970. */
  readonly at: number;
}

/** Where the diagnostics come from. */
export interface DiagnosticsSource {
  readonly version: string;
  readonly build: string;
  readonly page: PageStats;
  readonly runner: Pick<FeatureRunner<unknown>, 'badge' | 'statuses'>;
}

/** Reads the diagnostics for the current page. */
export function collectDiagnostics({
  version,
  build,
  page,
  runner,
}: DiagnosticsSource): Diagnostics {
  return {
    version,
    build,
    pageType: pageContext().type,
    badge: runner.badge(),
    features: runner.statuses(),
    posts: page.posts.stats(),
    classNames: page.atoms.stats(),
    locators: page.locators.stats(),
    at: Date.now(),
  };
}
