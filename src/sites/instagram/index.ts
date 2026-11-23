import type { Feature } from '../../core/feature';
import type { SiteAdapter } from '../../core/site';
import type { InstagramPage } from './feature';
import { version } from '../../../package.json';
import { readLocatorOverrides } from '../../core/locator';
import { siteStoragePrefix } from '../../core/site-storage';
import { diagnosticsPanel } from '../../diagnostics/diagnostics-panel';
import externalCss from '../../features/external-css';
import { createFiltersPanel } from '../../ui/filters/filters-panel';
import { createInstagramPage, IG_LOCATOR_OVERRIDES } from './feature';
import igDefaultFollowing from './features/default-following';
import igFeedFilters from './features/feed-filters';
import igHideClutter from './features/hide-clutter';
import igVideoControls from './features/video-controls';
import { INSTAGRAM_FILTER_SCHEMA } from './filter-schema';
import { instagramAccountId, instagramPageType, scrubInstagramPii } from './page';
import instagramTheme from './theme.css?inline';
import { instagramThemeMapping } from './theme-mapping';
import { isInstagramHost } from './urls';

export const instagramFeatures: readonly Feature<InstagramPage>[] = [
  igDefaultFollowing,
  igFeedFilters,
  igHideClutter,
  igVideoControls,
  externalCss,
];

/**
 * Instagram `SiteAdapter` built on the shared multi-site kernel (`DomEnvironment`,
 * `PageBridge` v2, `engines/react`, `engines/network-tap`, `capabilities`,
 * `siteStoragePrefix`, and site-agnostic `external_css` + `SitesPanel`).
 */
export const instagramSite: SiteAdapter<InstagramPage, ReturnType<typeof createInstagramPage>> = {
  id: 'instagram',
  displayName: 'Instagram',
  matchesHost: isInstagramHost,
  themeCss: instagramTheme,
  themeMapping: instagramThemeMapping,
  accountId: instagramAccountId,
  storagePrefix: (accountId) => siteStoragePrefix('instagram', accountId),
  scrubPii: scrubInstagramPii,
  createPage: createInstagramPage,
  features: instagramFeatures,
  createPanels({ data, page, runner, platform }) {
    const { stats } = page;
    const overrides = data.value(IG_LOCATOR_OVERRIDES, readLocatorOverrides);
    return [
      createFiltersPanel(data, INSTAGRAM_FILTER_SCHEMA),
      diagnosticsPanel({
        collect: () => {
          const net = stats.networkStats();
          return {
            version,
            build: platform.build,
            site: 'instagram',
            pageType: instagramPageType(),
            badge: runner.badge(),
            features: runner.statuses(),
            posts: stats.feed.stats(),
            classNames: { started: false, known: 0, total: 0, missing: [] },
            locators: stats.locators.stats(),
            bridge: stats.bridge.status(),
            extraSections: [
              {
                title: 'Instagram network tap',
                lines: [
                  `Matched API responses: ${net.matchedResponses}`,
                  `Cached media entries: ${net.cachedItems}`,
                  ...(net.errors ? [`Tap errors: ${net.errors}`] : []),
                ],
              },
            ],
            at: Date.now(),
          };
        },
        overrides,
        locatorNames: () => stats.locators.names(),
        scrubMessage: scrubInstagramPii,
      }),
    ];
  },
};
