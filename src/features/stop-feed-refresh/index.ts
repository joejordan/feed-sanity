import { BridgeError } from '../../core/bridge';
import { defineFeature } from '../../facebook/feature';

/**
 * Stops Facebook from automatically refreshing the Home or Groups feed, or
 * sending you back to Home from another page, after you return to the tab or
 * close a photo or reel. New in this project.
 *
 * The work runs in the page's own world through the `stop-feed-refresh` toggle
 * on the bridge (`src/facebook/page-toggles.ts`), which overrides Facebook's
 * staleness constants and return-to-feed / Groups refresh hooks without
 * blocking global `visibilitychange` or `blur` events (so background video
 * pausing and Messenger presence keep working). Turning the option off
 * disposes this feature's scope, which restores Facebook's original values
 * immediately without a reload.
 */
export default defineFeature({
  id: 'stop_feed_refresh',
  options: {
    stop_feed_refresh: {
      section: 'Feed & Reading',
      group: 'Home Feed',
      title: "Stop automatic feed refresh (aka getting 'Zucked')",
      description:
        'Stop Facebook from refreshing the Home or Groups feed, or sending you back to Home from another page, after you return to the tab or close a photo or reel.',
      keywords: ['scroll', 'jump', 'reload', 'refresh'],
      default: true,
    },
  },
  enabledBy: 'stop_feed_refresh',
  setup({ page, log }) {
    void page.bridge.stopFeedRefresh().catch((error: unknown) => {
      const failure = error instanceof BridgeError ? error.failure : undefined;
      if (failure === 'cancelled' || failure === 'unavailable') {
        return;
      }
      log.error('could not stop automatic feed refreshes', error);
    });
  },
});
