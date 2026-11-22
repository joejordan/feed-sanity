import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInShadow, setUserThemeCss } from '../ui/mount';
import { addStyle } from './dom';
import { createDomEnvironment } from './dom-env';
import { Scope } from './scope';
import { concealPending, hideElement, markElement, mountSlot } from './surface';
import { BUILTIN_THEMES, createThemeController } from './theming';

/**
 * Simulates a strict Trusted Types host (such as Gmail or YouTube) where any
 * assignment to `innerHTML`, `outerHTML`, or `insertAdjacentHTML` throws a
 * `TypeError`. Ensures core DOM, surface, theming, and shadow-UI primitives
 * never rely on HTML string sinks.
 */
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

describe('strict Trusted Types compatibility (Gmail / YouTube invariant)', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    // Run cleanups LIFO so Trusted Types stays enforced during teardown as well.
    for (const stop of cleanups.splice(0).reverse()) {
      stop();
    }
    setUserThemeCss('');
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('runs core DOM, watcher, surface, theming, and shadow UI mounting with zero HTML string sinks', () => {
    cleanups.push(enforceStrictTrustedTypes());

    const anchor = document.createElement('section');
    const card = document.createElement('article');
    anchor.append(card);
    document.body.append(anchor);

    const env = createDomEnvironment({ pierceShadow: true });
    cleanups.push(() => env.dispose());

    const watched: Element[] = [];
    const stopWatch = env.watcher.watch('article', {
      added: (el) => watched.push(el),
    });
    cleanups.push(stopWatch);

    const scope = new Scope();
    cleanups.push(() => scope.dispose());

    // Styles, marks, hiding, concealment, and slot mounting must all use DOM APIs (`textContent`, `setAttribute`, `append`).
    scope.add(addStyle('tt_test_style', '.x { color: red; }'));
    markElement(scope, card, 'data-tt-mark', '1');
    hideElement(scope, card);
    concealPending(scope, {
      id: 'tt_conceal',
      activeAttr: 'data-tt-active',
      pendingSelector: 'article:not([data-tt-checked])',
    });

    const slot = document.createElement('div');
    mountSlot(scope, anchor, 'after', slot);

    // Shadow-DOM Preact UI mount must also avoid `innerHTML`.
    const unmountUi = renderInShadow(
      slot,
      <button type="button">Strict Trusted Types OK</button>,
      'button { color: var(--fs-text); }',
    );
    cleanups.push(unmountUi);

    // First-class theming engine (apply, preview, clearPreview, dispose) must also avoid `innerHTML`.
    const theme = createThemeController(
      env,
      { rootSelectors: [':root'], colorVars: { '--bg': (p) => p.background } },
      setUserThemeCss,
    );
    cleanups.push(() => theme.dispose());
    const midnight = BUILTIN_THEMES[0]!.palette;
    theme.apply({ palette: midnight });
    theme.preview(null);
    theme.clearPreview();

    expect(watched).toEqual([card]);
    expect(card.getAttribute('data-feed-sanity-hidden')).toBe('none');
    expect(slot.isConnected).toBe(true);
    expect(slot.shadowRoot?.textContent).toContain('Strict Trusted Types OK');
    expect(document.querySelector('#feed_sanity_user_theme')?.textContent).toContain(
      midnight.background,
    );
  });
});
