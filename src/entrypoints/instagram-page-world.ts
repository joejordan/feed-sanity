import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startInstagramPageWorld } from '../sites/instagram/page-world';

const STARTED = Symbol.for('feed-sanity/instagram-page-world-started');

// Registered dynamically at runtime in MAIN world once the user grants optional
// host permission for Instagram.
export default defineUnlistedScript(() => {
  const host = globalThis as Record<symbol, boolean | undefined>;
  if (host[STARTED]) {
    return;
  }
  host[STARTED] = true;
  startInstagramPageWorld();
});
