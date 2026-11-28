import type { SiteAdapter } from '../../core/site';
import type { FacebookPage } from '../../facebook/feature';
import { version } from '../../../package.json';
import { readLocatorOverrides } from '../../core/locator';
import { siteDataPanel } from '../../data/data-panel';
import { collectDiagnostics, reportedPageType } from '../../diagnostics/collect';
import { diagnosticsPanel } from '../../diagnostics/diagnostics-panel';
import { scrub } from '../../diagnostics/report';
import { createPage, LOCATOR_OVERRIDES } from '../../facebook/feature';
import { savedReadHistory } from '../../facebook/read-history';
import facebookTheme from '../../facebook/theme.css?inline';
import { isFacebookHost } from '../../facebook/urls';
import { currentUserId } from '../../facebook/user';
import { features, optionsPanels } from '../../features';
import { facebookThemeMapping } from './theme-mapping';

/**
 * Facebook `SiteAdapter` wiring Feed Sanity's Facebook features, Meta Comet
 * page-world bridge, theme tokens, data backup panel, and diagnostics panel
 * into the multi-site kernel.
 */
export const facebookSite: SiteAdapter<FacebookPage, ReturnType<typeof createPage>> = {
  id: 'facebook',
  displayName: 'Facebook',
  matchesHost: isFacebookHost,
  themeCss: facebookTheme,
  themeMapping: facebookThemeMapping,
  accountId: currentUserId,
  scrubPii: scrub,
  createPage,
  features,
  createPanels({ options, data, page, runner, platform, siteSettings, themeLibrary }) {
    const { stats } = page;
    const overrides = data.value(LOCATOR_OVERRIDES, readLocatorOverrides);
    return [
      ...optionsPanels(data),
      siteDataPanel({
        siteId: 'facebook',
        siteName: 'Facebook',
        options,
        data,
        locators: overrides,
        siteSettings,
        themeLibrary,
        readHistory: savedReadHistory(data),
      }),
      diagnosticsPanel({
        collect: () => collectDiagnostics({ version, build: platform.build, page: stats, runner }),
        overrides,
        locatorNames: () => stats.locators.names(),
        scrubPageType: reportedPageType,
      }),
    ];
  },
};
