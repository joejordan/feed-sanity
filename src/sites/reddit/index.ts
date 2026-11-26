import type { Feature } from '../../core/feature';
import type { SiteAdapter } from '../../core/site';
import type { RedditPage } from './feature';
import { version } from '../../../package.json';
import { readLocatorOverrides } from '../../core/locator';
import { siteDataPanel } from '../../data/data-panel';
import { diagnosticsPanel } from '../../diagnostics/diagnostics-panel';
import externalCss from '../../features/external-css';
import { createFiltersPanel } from '../../ui/filters/filters-panel';
import { createRedditPage, REDDIT_LOCATOR_OVERRIDES } from './feature';
import redditFeedFilters from './features/feed-filters';
import redditHideClutter from './features/hide-clutter';
import redditVideoControls from './features/video-controls';
import { REDDIT_FILTER_SCHEMA } from './filter-schema';
import { redditAccountId, redditPageType, scrubRedditPii } from './page';
import redditTheme from './theme.css?inline';
import { redditThemeMapping } from './theme-mapping';
import { isRedditHost } from './urls';

export const redditFeatures: readonly Feature<RedditPage>[] = [
  redditFeedFilters,
  redditHideClutter,
  redditVideoControls,
  externalCss,
];

/**
 * Reddit (Shreddit) `SiteAdapter` exercising the platform's full Shadow DOM
 * architecture: `envOptions: { pierceShadow: true }`, zero-polling
 * `engines/shadow` `attachShadow` notifications, `engines/hydration` SSR ad
 * indexing, shadow-piercing `SiteFeed` + `SiteVideos`, `shadowExtraCss` live
 * theming, `createFiltersPanel`, `dataPanel`, `diagnosticsPanel`, and
 * `external_css`.
 */
export const redditSite: SiteAdapter<RedditPage, ReturnType<typeof createRedditPage>> = {
  id: 'reddit',
  displayName: 'Reddit',
  pageWorldActiveToggle: 'reddit-active',
  matchesHost: isRedditHost,
  themeCss: redditTheme,
  themeMapping: redditThemeMapping,
  envOptions: { pierceShadow: true },
  accountId: redditAccountId,
  scrubPii: scrubRedditPii,
  createPage: createRedditPage,
  features: redditFeatures,
  createPanels({ options, data, page, runner, platform }) {
    const { stats } = page;
    const overrides = data.value(REDDIT_LOCATOR_OVERRIDES, readLocatorOverrides);
    return [
      createFiltersPanel(data, REDDIT_FILTER_SCHEMA),
      siteDataPanel({
        siteId: 'reddit',
        siteName: 'Reddit',
        options,
        data,
        locators: overrides,
      }),
      diagnosticsPanel({
        collect: () => {
          const runtime = stats.runtimeStats();
          return {
            version,
            build: platform.build,
            site: 'reddit',
            pageType: redditPageType(),
            badge: runner.badge(),
            features: runner.statuses(),
            posts: stats.feed.stats(),
            classNames: { started: false, known: 0, total: 0, missing: [] },
            locators: stats.locators.stats(),
            bridge: stats.bridge.status(),
            extraSections: [
              {
                title: 'Reddit Shadow DOM & hydration',
                lines: [
                  `Tracked open Shadow Roots: ${stats.env.shadowRoots.size}`,
                  `Shadow attachments captured: ${runtime.shadowAttachments}`,
                  `Hydration scripts scanned: ${runtime.scannedScripts}`,
                  `Hydration-indexed ads: ${runtime.indexedAds}`,
                  `Hydration-indexed recommendations: ${runtime.indexedSuggested}`,
                ],
              },
            ],
            at: Date.now(),
          };
        },
        overrides,
        locatorNames: () => stats.locators.names(),
        scrubMessage: scrubRedditPii,
      }),
    ];
  },
};
