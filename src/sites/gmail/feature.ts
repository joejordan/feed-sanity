import type { CapablePage, SiteCapabilities } from '../../capabilities';
import type { DomEnvironment } from '../../core/dom-env';
import type { Binder, Feature, FeatureDefinition, PageFactory } from '../../core/feature';
import type { Locate, Locator, LocatorSpec, LocatorStats } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { PageWatcher } from '../../core/page-watcher';
import type { SavedData } from '../../core/saved';
import { bindLocator, bindThreads, bindWatch } from '../../core/bind';
import { createDomEnvironment } from '../../core/dom-env';
import { defineFeature as defineCoreFeature } from '../../core/feature';
import {
  IDENTITY_RESOLVER,
  isLocatorSpec,
  Locators,
  readLocatorOverrides,
} from '../../core/locator';
import { createLogger } from '../../core/log';
import * as selectors from './selectors';
import { GmailThreadList } from './threads';

export const GMAIL_LOCATOR_OVERRIDES = 'gmail_locators';

export interface GmailStats {
  readonly locators: {
    stats: () => LocatorStats[];
    names: () => string[];
  };
  readonly threads: GmailThreadList;
}

export interface GmailPage extends CapablePage {
  readonly doc: Document;
  readonly locate: Locate;
  readonly watch: PageWatcher['watch'];
  readonly onUrlChange: (listener: () => void) => () => void;
  readonly threads: Pick<GmailThreadList, 'onAdd' | 'onRemove'> &
    Partial<Pick<GmailThreadList, 'onReset'>>;
  readonly capabilities: SiteCapabilities;
}

/**
 * Creates Gmail's `PageFactory`: zero React, zero MAIN-world bridge, and
 * strictly Trusted Types safe. (Same-origin iframe observation is scoped to
 * `gmailSite.themeEnvOptions` so no redundant iframe observer runs here.)
 */
export function createGmailPage(
  data: SavedData,
): PageFactory<GmailPage> & { readonly stats: GmailStats } {
  const env: DomEnvironment = createDomEnvironment({
    log: createLogger('gmail-dom'),
  });
  const locators = new Locators(IDENTITY_RESOLVER, Object.values(selectors).filter(isLocatorSpec));
  const overrides = data.value(GMAIL_LOCATOR_OVERRIDES, readLocatorOverrides);
  locators.override(overrides.get());
  overrides.onChange((value) => locators.override(value));

  const locate: Locate = (spec) => locators.locate(spec);
  const threads = new GmailThreadList(env, locate);

  const factory: PageFactory<GmailPage> = (binder: Binder) => {
    const boundLocators = new Map<LocatorSpec, Locator>();
    const boundThreads = bindThreads(threads, binder);
    return {
      doc: env.doc,
      locate: (spec) => {
        let locator = boundLocators.get(spec);
        if (!locator) {
          locator = bindLocator(locate(spec), binder);
          boundLocators.set(spec, locator);
        }
        return locator;
      },
      watch: bindWatch(env.watcher, binder),
      onUrlChange: (listener) => binder.listen((guarded) => env.onUrlChange(guarded), listener),
      threads: boundThreads,
      capabilities: {
        threads: boundThreads,
      },
    };
  };

  return Object.assign(factory, {
    stats: {
      locators,
      threads,
    },
  });
}

/** Declares a Gmail feature with typed access to `GmailPage`. */
export function defineGmailFeature<S extends OptionSpecs>(
  definition: FeatureDefinition<S, GmailPage>,
): Feature<GmailPage> {
  return defineCoreFeature(definition);
}
