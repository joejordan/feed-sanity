import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startXPageWorld } from '../sites/x/page-world';

const STARTED = Symbol.for('feed-sanity/x-page-world-started');

// Registered dynamically at runtime in MAIN world once the user grants optional
// host permission for X.com / Twitter.
export default defineUnlistedScript(() => {
  const host = globalThis as Record<symbol, boolean | undefined>;
  if (host[STARTED]) {
    return;
  }
  host[STARTED] = true;
  startXPageWorld();
});
