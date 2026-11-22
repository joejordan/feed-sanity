import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { xSite } from '../sites/x';

const STARTED = Symbol.for('feed-sanity/x-content-started');

// Registered dynamically at runtime once the user grants optional host
// permission for X.com / Twitter (see `src/platform/site-permissions.ts`).
export default defineUnlistedScript(() => {
  const host = globalThis as Record<symbol, boolean | undefined>;
  if (host[STARTED]) {
    return;
  }
  host[STARTED] = true;
  void startSite(xSite, extensionPlatform);
});
