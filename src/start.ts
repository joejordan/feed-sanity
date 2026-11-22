import type { Platform } from './core/platform';
import { version } from '../package.json';
import { FeatureRunner } from './core/app';
import { readLocatorOverrides } from './core/locator';
import { createLogger } from './core/log';
import { Options } from './core/options';
import { SavedData } from './core/saved';
import { dataPanel } from './data/data-panel';
import { collectDiagnostics } from './diagnostics/collect';
import { diagnosticsPanel } from './diagnostics/diagnostics-panel';
import { createPage, LOCATOR_OVERRIDES } from './facebook/feature';
import { currentUserId } from './facebook/user';
import { features, optionsPanels } from './features';
import { savedFilters } from './features/post-filters/types';
import { openOptionsDialog } from './ui/options-dialog';

/** Starts every feature on the current page. Shared by the extension and the userscript. */
export function start(platform: Platform): Promise<string[]> {
  const user = currentUserId();
  const options = new Options(platform.store, `${user}/options`);
  const data = new SavedData(platform.store, user);
  const page = createPage(data, () => platform.installPageWorld());
  const runner = new FeatureRunner(features, options, page, data);
  const overrides = data.value(LOCATOR_OVERRIDES, readLocatorOverrides);
  const panels = [
    ...optionsPanels(data),
    dataPanel({ options, filters: savedFilters(data), locators: overrides }),
    diagnosticsPanel({
      collect: () =>
        collectDiagnostics({ version, build: platform.build, page: page.stats, runner }),
      overrides,
      locatorNames: () => page.stats.locators.names(),
    }),
  ];

  // The browser may keep the badge of the page this tab showed before, so
  // the first one is sent even when it is empty.
  platform.setBadge(runner.badge());
  runner.onBadgeChange((badge) => platform.setBadge(badge));

  // Registers the features' options before its first await, so the dialog
  // can open once the saved values are read rather than after the slowest
  // feature has started.
  const started = runner.start();
  platform.onOpenOptions(() => {
    openOptionsDialog(options, panels).catch((error: unknown) => {
      createLogger('options').error('could not open the options dialog', error);
    });
  });
  return started;
}
