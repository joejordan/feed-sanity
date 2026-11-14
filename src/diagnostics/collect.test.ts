import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FeatureRunner } from '../core/app';
import { Options } from '../core/options';
import { SavedData } from '../core/saved';
import { createPage, defineFeature } from '../facebook/feature';
import { POST } from '../facebook/selectors';
import { extensionStore } from '../platform/extension-store';
import { collectDiagnostics } from './collect';

describe('collectDiagnostics', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/marketplace/');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  it("reads the page's counts and the features' states", async () => {
    const data = new SavedData(extensionStore, 'u');
    const page = createPage(data);
    const looker = defineFeature({
      id: 'looker',
      setup: ({ badge, page: facebook }) => {
        facebook.locate(POST).all(document);
        badge(4);
      },
    });
    const runner = new FeatureRunner(
      [looker],
      new Options(extensionStore, 'u/options'),
      page,
      data,
    );
    await runner.start();

    const diagnostics = collectDiagnostics({
      version: '1.2.3',
      build: 'userscript',
      page: page.stats,
      runner,
    });

    expect(diagnostics).toMatchObject({
      version: '1.2.3',
      build: 'userscript',
      pageType: 'marketplace',
      badge: { count: 4, failed: false },
      features: [{ id: 'looker', state: 'running', errors: 0, lastError: null }],
      posts: { started: false, tracked: 0 },
      classNames: { started: true },
    });
    const post = diagnostics.locators.find((locator) => locator.name === 'post');
    expect(post).toMatchObject({ lookups: 1, found: 0, overridden: false });
  });
});
