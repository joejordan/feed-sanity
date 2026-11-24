import type { Feature } from '../../core/feature';
import type { SiteAdapter } from '../../core/site';
import type { XPage } from './feature';
import { version } from '../../../package.json';
import { savedFilters } from '../../core/filter-types';
import { readLocatorOverrides } from '../../core/locator';
import { dataPanel } from '../../data/data-panel';
import { diagnosticsPanel } from '../../diagnostics/diagnostics-panel';
import externalCss from '../../features/external-css';
import { readThemeDocument, THEME_DATA_KEY } from '../../ui/appearance';
import { createFiltersPanel } from '../../ui/filters/filters-panel';
import { createXPage, X_LOCATOR_OVERRIDES } from './feature';
import xDefaultFollowing from './features/default-following';
import xDisplayNotice from './features/display-notice';
import xFeedFilters from './features/feed-filters';
import xHideClutter from './features/hide-clutter';
import xVideoScrubber from './features/video-controls';
import xVideoSpeed from './features/video-speed';
import { X_FILTER_SCHEMA } from './filter-schema';
import { scrubXPii, xAccountId, xPageType } from './page';
import xTheme from './theme.css?inline';
import { xThemeMapping } from './theme-mapping';
import { isXHost } from './urls';

export const xFeatures: readonly Feature<XPage>[] = [
  xDefaultFollowing,
  xDisplayNotice,
  xFeedFilters,
  xHideClutter,
  xVideoScrubber,
  xVideoSpeed,
  externalCss,
];

/**
 * X (Twitter) `SiteAdapter` built on the shared multi-site kernel (`DomEnvironment`,
 * `PageBridge` v2, `engines/react`, transforming `engines/network-tap`, shared
 * `createFeedFiltersFeature`, `overlayEachVideo`, and site-agnostic `external_css`).
 */
export const xSite: SiteAdapter<XPage, ReturnType<typeof createXPage>> = {
  id: 'x',
  displayName: 'X (Twitter)',
  matchesHost: isXHost,
  themeCss: xTheme,
  themeMapping: xThemeMapping,
  envOptions: { pierceShadow: true },
  accountId: xAccountId,
  scrubPii: scrubXPii,
  createPage: createXPage,
  features: xFeatures,
  createPanels({ options, data, page, runner, platform }) {
    const { stats } = page;
    const overrides = data.value(X_LOCATOR_OVERRIDES, readLocatorOverrides);
    return [
      createFiltersPanel(data, X_FILTER_SCHEMA),
      dataPanel(
        {
          options,
          filters: savedFilters(data),
          locators: overrides,
          theme: data.value(THEME_DATA_KEY, readThemeDocument),
        },
        { siteName: 'X (Twitter)' },
      ),
      diagnosticsPanel({
        collect: () => {
          const net = stats.networkStats();
          return {
            version,
            build: platform.build,
            site: 'x',
            pageType: xPageType(),
            badge: runner.badge(),
            features: runner.statuses(),
            posts: stats.feed.stats(),
            classNames: { started: false, known: 0, total: 0, missing: [] },
            locators: stats.locators.stats(),
            bridge: stats.bridge.status(),
            extraSections: [
              {
                title: 'X network tap',
                lines: [
                  `Matched timeline responses: ${net.matchedResponses}`,
                  `Promoted entries stripped before render: ${net.strippedPromoted}`,
                  ...(net.errors ? [`Tap errors: ${net.errors}`] : []),
                ],
              },
            ],
            at: Date.now(),
          };
        },
        overrides,
        locatorNames: () => stats.locators.names(),
        scrubMessage: scrubXPii,
      }),
    ];
  },
};
