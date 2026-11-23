import type { Feature } from '../../core/feature';
import type { SiteAdapter } from '../../core/site';
import type { GmailPage } from './feature';
import { version } from '../../../package.json';
import { readLocatorOverrides } from '../../core/locator';
import { siteStoragePrefix } from '../../core/site-storage';
import { diagnosticsPanel } from '../../diagnostics/diagnostics-panel';
import externalCss from '../../features/external-css';
import { createFiltersPanel } from '../../ui/filters/filters-panel';
import { createGmailPage, GMAIL_LOCATOR_OVERRIDES } from './feature';
import gmailHideClutter from './features/hide-clutter';
import gmailThreadFilters from './features/thread-filters';
import { GMAIL_FILTER_SCHEMA } from './filter-schema';
import { gmailAccountId, gmailPageType, scrubGmailPii } from './page';
import gmailTheme from './theme.css?inline';
import { gmailThemeMapping } from './theme-mapping';
import { isGmailHost } from './urls';

export const gmailFeatures: readonly Feature<GmailPage>[] = [
  gmailThreadFilters,
  gmailHideClutter,
  externalCss,
];

/**
 * Gmail `SiteAdapter` proving the multi-site kernel outside React and social
 * feeds: zero React, zero MAIN-world bridge, strict Trusted Types compliance,
 * `ThreadListCapability`, and live same-origin `<iframe>` theme propagation.
 */
export const gmailSite: SiteAdapter<GmailPage, ReturnType<typeof createGmailPage>> = {
  id: 'gmail',
  displayName: 'Gmail',
  matchesHost: isGmailHost,
  themeCss: gmailTheme,
  themeMapping: gmailThemeMapping,
  themeEnvOptions: { includeIframes: true },
  accountId: gmailAccountId,
  storagePrefix: (accountId) => siteStoragePrefix('gmail', accountId),
  scrubPii: scrubGmailPii,
  createPage: createGmailPage,
  features: gmailFeatures,
  createPanels({ data, page, runner, platform }) {
    const { stats } = page;
    const overrides = data.value(GMAIL_LOCATOR_OVERRIDES, readLocatorOverrides);
    return [
      createFiltersPanel(data, GMAIL_FILTER_SCHEMA),
      diagnosticsPanel({
        collect: () => ({
          version,
          build: platform.build,
          site: 'gmail',
          pageType: gmailPageType(),
          badge: runner.badge(),
          features: runner.statuses(),
          posts: stats.threads.stats(),
          classNames: { started: false, known: 0, total: 0, missing: [] },
          locators: stats.locators.stats(),
          bridge: {
            state: 'not started',
            problem: null,
            readers: [],
            toggles: [],
            actions: [],
            mounts: [],
          },
          at: Date.now(),
        }),
        overrides,
        locatorNames: () => stats.locators.names(),
        scrubMessage: scrubGmailPii,
      }),
    ];
  },
};
