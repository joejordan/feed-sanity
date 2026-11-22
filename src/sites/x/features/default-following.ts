import { defineXFeature } from '../feature';
import { xPageType } from '../page';
import { X_TIMELINE_TAB } from '../selectors';

function isFollowingTab(el: Element): boolean {
  return /^Following$/i.test((el.textContent ?? '').trim());
}

/**
 * Automatically selects the native "Following" timeline tab when arriving on
 * `/home`. Triggers at most once per visit to `/home` so you can still switch
 * back to "For you" manually without being pulled back. Stops its tab watcher
 * immediately once switched to keep idle overhead at zero.
 */
export default defineXFeature({
  id: 'x_default_following',
  options: {
    x_default_following: {
      section: 'Feed',
      title: 'Default to Following tab',
      description:
        'Select the chronological Following tab automatically when opening X Home instead of For you.',
      default: false,
    },
  },
  enabledBy: 'x_default_following',
  setup({ page, scope }) {
    let switchedForCurrentHome = false;
    let stopWatch: (() => void) | undefined;

    const detachWatch = (): void => {
      stopWatch?.();
      stopWatch = undefined;
    };

    const trySelect = (tab: Element): void => {
      if (switchedForCurrentHome || xPageType() !== 'home') {
        return;
      }
      if (!isFollowingTab(tab)) {
        return;
      }
      switchedForCurrentHome = true;
      detachWatch();
      if (tab.getAttribute('aria-selected') !== 'true' && tab instanceof HTMLElement) {
        tab.click();
      }
    };

    const syncForRoute = (): void => {
      if (xPageType() !== 'home') {
        switchedForCurrentHome = false;
        detachWatch();
        return;
      }
      if (switchedForCurrentHome || stopWatch) {
        return;
      }
      const stop = page.watch(page.locate(X_TIMELINE_TAB), {
        added: (tab) => trySelect(tab),
      });
      if (switchedForCurrentHome) {
        stop();
      } else {
        stopWatch = stop;
      }
    };

    scope.add(detachWatch);
    page.onUrlChange(syncForRoute);
    syncForRoute();
  },
});
