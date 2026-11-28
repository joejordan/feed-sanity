import { defineFeature } from '../../core/feature';
import { OWN_ATTR, pageWatcher } from '../../core/page-watcher';
import { CUSTOM_STYLESHEET_LINK_ID, CUSTOM_STYLESHEET_URL_KEY } from './model';

const LINK_SELECTOR = `#${CUSTOM_STYLESHEET_LINK_ID}`;

/**
 * Loads a stylesheet from a web address the user gives, on every site. The
 * page gets one `<link rel="stylesheet">` in its `<head>`, which follows the
 * option as it changes and goes away when the address is cleared or the
 * feature stops. The browser fetches the sheet itself, so the site's
 * Content Security Policy may block it; nothing here checks the address.
 *
 * The Appearance panel draws the field for this option, so the generic
 * option list leaves it out.
 */
export default defineFeature({
  id: 'custom_stylesheet',
  options: {
    [CUSTOM_STYLESHEET_URL_KEY]: {
      section: 'Appearance',
      group: 'External Stylesheet',
      advanced: true,
      hiddenInList: true,
      title: 'Custom stylesheet URL',
      description:
        'Address of a CSS file to load on top of every page. Serve it over HTTPS as text/css, ' +
        'or the browser may refuse it. Some sites block outside stylesheets. Leave empty to load none.',
      default: '',
    },
  },
  setup({ options, scope }) {
    /** The trimmed address the option holds now. */
    let wanted = '';

    const apply = (): void => {
      // Also finds one left by an earlier copy of the content script, which is taken over.
      const current = document.querySelector(LINK_SELECTOR);
      if (!wanted || scope.disposed) {
        current?.remove();
        return;
      }
      const { head } = document;
      // A same-address link without the mark is replaced, so its removal is reported for healing.
      if (!head || (current?.hasAttribute(OWN_ATTR) && current.getAttribute('href') === wanted)) {
        return;
      }
      const next = document.createElement('link');
      next.id = CUSTOM_STYLESHEET_LINK_ID;
      next.rel = 'stylesheet';
      next.href = wanted;
      next.setAttribute(OWN_ATTR, '');
      if (current) {
        current.replaceWith(next);
      } else {
        head.append(next);
      }
    };

    if (!document.head) {
      // Content scripts can start before the parser reaches <head>.
      let stopWait: (() => void) | undefined;
      stopWait = pageWatcher.watch('head', {
        added: () => {
          stopWait?.();
          apply();
        },
      });
      scope.add(() => stopWait?.());
    }

    /** Puts the link back when the site takes it out, while an address is set. */
    let stopHeal: (() => void) | undefined;
    options.watch(CUSTOM_STYLESHEET_URL_KEY, (value) => {
      wanted = value.trim();
      if (wanted) {
        stopHeal ??= pageWatcher.watchTree({
          removed: (element) => {
            if (element.id === CUSTOM_STYLESHEET_LINK_ID) {
              apply();
            }
          },
        });
      } else {
        stopHeal?.();
        stopHeal = undefined;
      }
      apply();
    });

    scope.add(() => {
      stopHeal?.();
      document.querySelector(LINK_SELECTOR)?.remove();
    });
  },
});
