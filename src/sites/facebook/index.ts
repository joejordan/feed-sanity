import type { SiteAdapter } from '../../core/site';
import type { FacebookPage } from '../../facebook/feature';
import { version } from '../../../package.json';
import { readLocatorOverrides } from '../../core/locator';
import { dataPanel } from '../../data/data-panel';
import { collectDiagnostics, reportedPageType } from '../../diagnostics/collect';
import { diagnosticsPanel } from '../../diagnostics/diagnostics-panel';
import { scrub } from '../../diagnostics/report';
import { createPage, LOCATOR_OVERRIDES } from '../../facebook/feature';
import { savedPostData } from '../../facebook/post-read';
import facebookTheme from '../../facebook/theme.css?inline';
import { isFacebookHost } from '../../facebook/urls';
import { currentUserId } from '../../facebook/user';
import { features, optionsPanels } from '../../features';
import { savedFilters } from '../../features/post-filters/types';
import { readThemeConfig, THEME_DATA_KEY } from '../../ui/appearance';
import { facebookThemeMapping } from './theme-mapping';

/**
 * Facebook `SiteAdapter` wiring Feed Sanity's Facebook features, Meta Comet
 * page-world bridge, storage prefix, theme tokens,
 * data backup panel, and diagnostics panel into the multi-site kernel.
 */
export const facebookSite: SiteAdapter<FacebookPage, ReturnType<typeof createPage>> = {
  id: 'facebook',
  displayName: 'Facebook',
  matchesHost: isFacebookHost,
  themeCss: facebookTheme,
  themeMapping: facebookThemeMapping,
  accountId: currentUserId,
  // Keep Facebook's `<c_user>` prefix so existing user settings stay where
  // they are; new sites use `siteStoragePrefix`.
  storagePrefix: (accountId) => accountId,
  scrubPii: scrub,
  createPage,
  features,
  createPanels({ options, data, page, runner, platform }) {
    const { stats } = page;
    const overrides = data.value(LOCATOR_OVERRIDES, readLocatorOverrides);
    return [
      ...optionsPanels(data),
      dataPanel(
        {
          options,
          filters: savedFilters(data),
          locators: overrides,
          theme: data.value(THEME_DATA_KEY, readThemeConfig),
          read_history: savedPostData(data),
        },
        { siteName: 'Facebook' },
      ),
      diagnosticsPanel({
        collect: () => collectDiagnostics({ version, build: platform.build, page: stats, runner }),
        overrides,
        locatorNames: () => stats.locators.names(),
        scrubPageType: reportedPageType,
      }),
    ];
  },
};
