import type { FacebookPage } from '../facebook/feature';
import type { DisplayNoticeAnchor } from './display-notice';
import { FEED_MAIN } from '../facebook/selectors';
import { createDisplayNoticeFeature, findHeaderAfterAnchor } from './display-notice';

/** True when `loc` is Facebook's Dark mode settings tab (`/settings/?tab=dark_mode_category`). */
export function isFacebookDarkModeSettingsPath(
  loc: Pick<Location, 'pathname' | 'search'> = location,
): boolean {
  if (!/^\/settings\/?$/i.test(loc.pathname)) {
    return false;
  }
  return new URLSearchParams(loc.search).get('tab')?.toLowerCase() === 'dark_mode_category';
}

/**
 * Anchors the notice directly above Facebook's Dark mode `[role="radiogroup"]`
 * controls when present, otherwise below the settings heading or prepended inside
 * `[role="main"]`.
 */
export function findFacebookDarkModeAnchor(container: Element): DisplayNoticeAnchor {
  const radioGroup = container.querySelector('[role="radiogroup"]');
  if (radioGroup) {
    return { anchor: radioGroup, placement: 'before' };
  }
  return findHeaderAfterAnchor(container, 'h1, h2, [role="heading"]');
}

/**
 * Displays a compact Shadow DOM notice on
 * `facebook.com/settings/?tab=dark_mode_category` informing the user that Feed
 * Sanity is active with a direct button to open Appearance.
 */
export default createDisplayNoticeFeature<FacebookPage>({
  id: 'facebook_display_notice',
  siteName: 'Facebook',
  layout: 'centered',
  matchesRoute: isFacebookDarkModeSettingsPath,
  container: FEED_MAIN,
  findAnchor: findFacebookDarkModeAnchor,
});
