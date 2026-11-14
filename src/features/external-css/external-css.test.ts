import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { createPage } from '../../facebook/feature';
import { extensionStore } from '../../platform/extension-store';
import externalCss from '.';

const LINK = 'link#feed_sanity_external_css';
const link = () => document.querySelector<HTMLLinkElement>(LINK);

describe('external_css', () => {
  let options: Options;

  beforeEach(async () => {
    fakeBrowser.reset();
    link()?.remove();
    options = new Options(extensionStore, 'u/options');
    await startFeatures([externalCss], options, createPage(), new SavedData(extensionStore, 'u'));
  });

  it('adds nothing while the URL is empty', () => {
    expect(link()).toBeNull();
  });

  it('adds a stylesheet link for the URL, and replaces it when the URL changes', async () => {
    await options.set('external_css_url', 'https://example.com/a.css');
    expect(link()?.href).toBe('https://example.com/a.css');
    expect(link()?.rel).toBe('stylesheet');

    await options.set('external_css_url', 'https://example.com/b.css');
    expect(document.querySelectorAll(LINK)).toHaveLength(1);
    expect(link()?.href).toBe('https://example.com/b.css');
  });

  it('removes the link when the URL is cleared', async () => {
    await options.set('external_css_url', 'https://example.com/a.css');
    await options.set('external_css_url', '');
    expect(link()).toBeNull();
    await options.set('external_css_url', '  ');
    expect(link()).toBeNull();
  });
});
