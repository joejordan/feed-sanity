import type { XPage } from '../feature';
import {
  createDisplayNoticeFeature,
  findHeaderAfterAnchor,
} from '../../../features/display-notice';
import { isXDisplaySettingsPath } from '../page';
import { X_DISPLAY_SETTINGS } from '../selectors';

/**
 * Displays a compact Shadow DOM notice on `x.com/settings/display` informing
 * the user that Feed Sanity is active with a direct button to open Appearance.
 */
export default createDisplayNoticeFeature<XPage>({
  id: 'x_display_notice',
  siteName: 'X',
  layout: 'inset',
  matchesRoute: isXDisplaySettingsPath,
  container: X_DISPLAY_SETTINGS,
  findAnchor: (container) => findHeaderAfterAnchor(container, '#detail-header'),
});
