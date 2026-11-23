import { defineXFeature } from '../feature';
import { xPageType } from '../page';
import { X_TIMELINE_TAB } from '../selectors';

function isFollowingTab(el: Element): boolean {
  return /^Following$/i.test((el.textContent ?? '').trim());
}

/**
 * Automatically selects the native "Following" timeline tab when arriving on
 * `/home`. Uses `page.env.whileOnRoute` so each visit to `/home` triggers at
 * most once and stops watching immediately after clicking the tab.
 */
export default defineXFeature({
  id: 'x_default_following',
  options: {
    x_default_following: {
      section: 'Timeline & Clutter',
      group: 'Timeline',
      title: 'Default to Following tab',
      description:
        'Select the chronological Following tab automatically when opening X Home instead of For you.',
      keywords: ['chronological', 'for you', 'timeline', 'feed'],
      default: false,
    },
  },
  enabledBy: 'x_default_following',
  setup({ page, scope }) {
    page.env.whileOnRoute(
      scope,
      () => xPageType() === 'home',
      (routeScope) => {
        let switched = false;
        let stopWatch: (() => void) | undefined;

        const stop = page.watch(page.locate(X_TIMELINE_TAB), {
          added: (tab) => {
            if (switched || !isFollowingTab(tab)) {
              return;
            }
            switched = true;
            stopWatch?.();
            stopWatch = undefined;
            if (tab.getAttribute('aria-selected') !== 'true' && tab instanceof HTMLElement) {
              tab.click();
            }
          },
        });

        if (switched) {
          stop();
        } else {
          stopWatch = stop;
          routeScope.add(() => {
            stopWatch?.();
            stopWatch = undefined;
          });
        }
      },
    );
  },
});
