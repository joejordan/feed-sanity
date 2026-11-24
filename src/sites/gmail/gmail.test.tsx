import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Badge, Platform } from '../../core/platform';
import { startSite } from '../../core/site';
import { HIDDEN_ATTR } from '../../core/surface';
import { inMemoryStore } from '../../core/testing';
import { applyThemePreset, DEFAULT_THEME_DOCUMENT } from '../../core/theming';
import { setUserThemeCss } from '../../ui/mount';
import { gmailSite } from '.';

function enforceStrictTrustedTypes(): () => void {
  const origInner = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const origOuter = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
  const origInsert = Element.prototype.insertAdjacentHTML;
  const origShadowInner =
    typeof ShadowRoot === 'undefined'
      ? undefined
      : Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'innerHTML');

  const deny = (): never => {
    throw new TypeError("This document requires 'TrustedHTML' assignment.");
  };

  Object.defineProperty(Element.prototype, 'innerHTML', {
    ...(origInner?.get ? { get: origInner.get } : {}),
    set: deny,
    configurable: true,
  });
  Object.defineProperty(Element.prototype, 'outerHTML', {
    ...(origOuter?.get ? { get: origOuter.get } : {}),
    set: deny,
    configurable: true,
  });
  Element.prototype.insertAdjacentHTML = deny;
  if (typeof ShadowRoot !== 'undefined') {
    Object.defineProperty(ShadowRoot.prototype, 'innerHTML', {
      ...(origShadowInner?.get ? { get: origShadowInner.get } : {}),
      set: deny,
      configurable: true,
    });
  }

  return () => {
    if (origInner) {
      Object.defineProperty(Element.prototype, 'innerHTML', origInner);
    }
    if (origOuter) {
      Object.defineProperty(Element.prototype, 'outerHTML', origOuter);
    }
    Element.prototype.insertAdjacentHTML = origInsert;
    if (typeof ShadowRoot !== 'undefined' && origShadowInner) {
      Object.defineProperty(ShadowRoot.prototype, 'innerHTML', origShadowInner);
    }
  };
}

describe('gmailSite adapter (zero React, strict Trusted Types, ThreadListCapability, iframe theming)', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    document.body.replaceChildren();
    document.head.replaceChildren();
    setUserThemeCss('');
    history.replaceState({}, '', '/mail/u/0/#inbox');
  });

  afterEach(() => {
    for (const stop of cleanups.splice(0).reverse()) {
      stop();
    }
    setUserThemeCss('');
    document.body.replaceChildren();
    document.head.replaceChildren();
    vi.restoreAllMocks();
  });

  it('filters inbox ads and keywords, hides clutter, propagates themes into same-origin iframes, and never uses HTML sinks or page-world scripts', async () => {
    // Build Gmail DOM before enforcing Trusted Types so fixture setup is concise, then enforce strict TT for the entire runtime.
    const main = document.createElement('div');
    main.setAttribute('role', 'main');
    const table = document.createElement('table');
    table.setAttribute('role', 'grid');
    const tbody = document.createElement('tbody');

    const makeRow = (id: string, cells: HTMLElement[], attrs: Record<string, string> = {}) => {
      const tr = document.createElement('tr');
      tr.id = id;
      tr.setAttribute('role', 'row');
      for (const [k, v] of Object.entries(attrs)) {
        tr.setAttribute(k, v);
      }
      for (const cell of cells) {
        const td = document.createElement('td');
        td.append(cell);
        tr.append(td);
      }
      return tr;
    };

    const organicSender = document.createElement('span');
    organicSender.setAttribute('email', 'alice@example.com');
    organicSender.textContent = 'Alice';
    const attachmentChip = document.createElement('span');
    attachmentChip.setAttribute('data-tooltip', 'Sponsored_Deck.pdf');
    attachmentChip.textContent = 'Sponsored_Deck.pdf';
    const organicRow = makeRow('row-organic', [organicSender, attachmentChip], {
      'data-legacy-thread-id': 't100',
      'data-unread': 'true',
    });

    const subjectAdLink = document.createElement('span');
    subjectAdLink.setAttribute('data-thread-subject', '1');
    subjectAdLink.textContent = 'Ad';
    const subjectAdRow = makeRow('row-subject-ad', [subjectAdLink], {
      'data-legacy-thread-id': 't101',
    });

    const adBadge = document.createElement('span');
    adBadge.setAttribute('data-tooltip', 'Ad');
    adBadge.textContent = 'Ad';
    const adText = document.createElement('span');
    adText.textContent = 'Mega Sale 50% Off';
    const promoAdRow = makeRow('row-ad', [adBadge, adText]);

    // Bare text-only ad badge (no data-tooltip/aria-label/data-ad) exercises the TreeWalker branch.
    const bareAdBadge = document.createElement('span');
    bareAdBadge.textContent = 'Sponsored';
    const bareAdText = document.createElement('span');
    bareAdText.textContent = 'Try Cloud Storage';
    const bareAdRow = makeRow('row-bare-ad', [bareAdBadge, bareAdText]);

    const kwSpan = document.createElement('span');
    kwSpan.textContent = 'Weekly Crypto Digest Newsletter';
    const kwRow = makeRow('row-kw', [kwSpan], { 'data-legacy-thread-id': 't103' });

    tbody.append(organicRow, subjectAdRow, promoAdRow, bareAdRow, kwRow);
    table.append(tbody);
    main.append(table);

    const header = document.createElement('header');
    header.setAttribute('role', 'banner');
    const geminiBtn = document.createElement('button');
    geminiBtn.setAttribute('aria-label', 'Ask Gemini');
    header.append(geminiBtn);
    const sidePanel = document.createElement('div');
    sidePanel.setAttribute('aria-label', 'Side panel');
    document.body.append(header, main, sidePanel);

    const iframe = document.createElement('iframe');
    const childDoc = document.implementation.createHTMLDocument('compose');
    Object.defineProperty(iframe, 'contentDocument', { value: childDoc, configurable: true });
    document.body.append(iframe);

    // Enforce strict Trusted Types for the entire Gmail adapter lifecycle!
    cleanups.push(enforceStrictTrustedTypes());

    const installPageWorld = vi.fn(() => Promise.reject(new Error('should never be called')));
    const store = inMemoryStore({
      'v2/gmail/u0/options': {
        gmail_hide_ads: true,
        gmail_keywords: 'crypto\n',
        gmail_hide_side_panel: true,
        gmail_hide_gemini: true,
        custom_stylesheet_url: 'https://example.com/gmail.css',
      },
      'v2/gmail/u0/theme': applyThemePreset(DEFAULT_THEME_DOCUMENT, 'catppuccin-mocha'),
    });
    const badges: Badge[] = [];
    const platform: Platform = {
      store,
      build: 'test',
      onOpenOptions: () => undefined,
      setBadge: (badge) => badges.push(badge),
      installPageWorld,
    };

    const failed = await startSite(gmailSite, platform);
    expect(failed).toEqual([]);
    expect(installPageWorld).not.toHaveBeenCalled();

    // Organic row (with `Sponsored_Deck.pdf` attachment!) & email whose subject says "Ad" stay visible;
    // tooltip ad, bare-text TreeWalker ad, and keyword rows are hidden.
    expect(organicRow.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(subjectAdRow.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(promoAdRow.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(bareAdRow.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(kwRow.getAttribute(HIDDEN_ATTR)).toBe('none');
    expect(badges.at(-1)).toEqual({ count: 3, failed: false });

    // External CSS and clutter rules injected cleanly without touching HTML sinks.
    const extLink = document.querySelector('#feed_sanity_custom_stylesheet') as HTMLLinkElement | null;
    expect(extLink?.href).toBe('https://example.com/gmail.css');
    expect(document.querySelector('#feed_sanity_clutter_gmail_hide_side_panel')).not.toBeNull();
    expect(document.querySelector('#feed_sanity_clutter_gmail_hide_gemini')).not.toBeNull();
    expect(document.querySelector('#feed_sanity_clutter_gmail_hide_chat_meet')).toBeNull();

    // Live theme applied to BOTH Gmail main document AND same-origin iframe!
    await vi.waitFor(() =>
      expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#1e1e2e'),
    );
    await vi.waitFor(() =>
      expect(childDoc.querySelector('#feed_sanity_user_theme')?.textContent).toContain('#1e1e2e'),
    );

    // Dynamic append hides new keyword row and increments badge; removal decrements badge; hash change resets cleanly.
    const dynSpan = document.createElement('span');
    dynSpan.textContent = 'Late Crypto Alert';
    const dynRow = makeRow('row-dyn', [dynSpan], { 'data-legacy-thread-id': 't104' });
    tbody.append(dynRow);
    await vi.waitFor(() => expect(dynRow.getAttribute(HIDDEN_ATTR)).toBe('none'));
    expect(badges.at(-1)).toEqual({ count: 4, failed: false });

    promoAdRow.remove();
    await vi.waitFor(() => expect(badges.at(-1)).toEqual({ count: 3, failed: false }));

    history.pushState({}, '', '/mail/u/0/#sent');
    globalThis.dispatchEvent(new HashChangeEvent('hashchange'));

    // Toggling filters off restores hidden rows and removes external CSS + clutter rules cleanly without reload.
    await store.set('v2/gmail/u0/options', {
      gmail_hide_ads: false,
      gmail_keywords: '',
      gmail_hide_side_panel: false,
      gmail_hide_gemini: false,
      custom_stylesheet_url: '',
    });
    expect(bareAdRow.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(kwRow.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(dynRow.hasAttribute(HIDDEN_ATTR)).toBe(false);
    expect(badges.at(-1)).toEqual({ count: 0, failed: false });
    expect(document.querySelector('#feed_sanity_clutter_gmail_hide_side_panel')).toBeNull();
    expect(document.querySelector('#feed_sanity_custom_stylesheet')).toBeNull();
  });
});
