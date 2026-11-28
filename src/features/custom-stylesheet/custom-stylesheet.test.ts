import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageFactory } from '../../core/feature';
import { FeatureRunner } from '../../core/app';
import { Options } from '../../core/options';
import { OWN_ATTR } from '../../core/page-watcher';
import { SavedData } from '../../core/saved';
import { inMemoryStore } from '../../core/testing';
import customStylesheet from '.';
import { CUSTOM_STYLESHEET_LINK_ID } from './model';

const KEY = 'test/options';
const noPage: PageFactory<unknown> = () => undefined;

function links(): HTMLLinkElement[] {
  return [...document.querySelectorAll<HTMLLinkElement>(`#${CUSTOM_STYLESHEET_LINK_ID}`)];
}

describe('custom_stylesheet feature', () => {
  let options: Options;
  let runner: FeatureRunner<unknown>;

  async function start(url?: string): Promise<void> {
    const store = inMemoryStore(url === undefined ? {} : { [KEY]: { custom_stylesheet_url: url } });
    options = new Options(store, KEY);
    runner = new FeatureRunner([customStylesheet], options, noPage, new SavedData(store, 'test'));
    expect(await runner.start()).toEqual([]);
  }

  beforeEach(() => {
    if (!document.head) {
      document.documentElement.prepend(document.createElement('head'));
    }
    document.head.replaceChildren();
  });

  afterEach(() => {
    runner.stop();
  });

  it('adds no link while the address is empty', async () => {
    await start();
    expect(links()).toEqual([]);
  });

  it('keeps one marked stylesheet link in <head> that follows the option', async () => {
    await start(' https://example.com/one.css ');
    const [first] = links();
    expect(links()).toHaveLength(1);
    expect(first?.parentElement).toBe(document.head);
    expect(first?.rel).toBe('stylesheet');
    expect(first?.href).toBe('https://example.com/one.css');
    expect(first?.hasAttribute(OWN_ATTR)).toBe(true);

    await options.set('custom_stylesheet_url', 'https://example.com/two.css');
    const [second] = links();
    expect(links()).toHaveLength(1);
    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(second?.href).toBe('https://example.com/two.css');
  });

  it('removes the link when the address is cleared or only whitespace', async () => {
    await start('https://example.com/a.css');
    expect(links()).toHaveLength(1);

    await options.set('custom_stylesheet_url', '   ');
    expect(links()).toEqual([]);

    await options.set('custom_stylesheet_url', 'https://example.com/b.css');
    expect(links()).toHaveLength(1);

    await options.set('custom_stylesheet_url', '');
    expect(links()).toEqual([]);
  });

  it('removes the link when the feature stops', async () => {
    await start('https://example.com/a.css');
    expect(links()).toHaveLength(1);

    runner.stop();
    expect(links()).toEqual([]);

    await options.set('custom_stylesheet_url', 'https://example.com/b.css');
    expect(links()).toEqual([]);
  });

  it('waits for <head> when the page has none yet', async () => {
    document.head.remove();
    await start('https://example.com/late.css');
    expect(links()).toEqual([]);

    const head = document.createElement('head');
    document.documentElement.prepend(head);
    await vi.waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]?.parentElement).toBe(head);
  });

  it('takes over a link left by an earlier copy of the script instead of adding a second', async () => {
    const stale = document.createElement('link');
    stale.id = CUSTOM_STYLESHEET_LINK_ID;
    stale.rel = 'stylesheet';
    stale.href = 'https://example.com/old.css';
    document.head.append(stale);

    await start('https://example.com/new.css');
    expect(links().map((link) => link.href)).toEqual(['https://example.com/new.css']);
  });

  it('marks a left-over link with the same address by replacing it', async () => {
    const stale = document.createElement('link');
    stale.id = CUSTOM_STYLESHEET_LINK_ID;
    stale.href = 'https://example.com/same.css';
    document.head.append(stale);

    await start('https://example.com/same.css');
    expect(links()).toHaveLength(1);
    expect(links()[0]).not.toBe(stale);
    expect(links()[0]?.hasAttribute(OWN_ATTR)).toBe(true);
  });

  it('puts the link back when the page removes it', async () => {
    await start('https://example.com/a.css');
    const [first] = links();
    first?.remove();
    await vi.waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]?.href).toBe('https://example.com/a.css');

    await options.set('custom_stylesheet_url', '');
    expect(links()).toEqual([]);
  });
});
