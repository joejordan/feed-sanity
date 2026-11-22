import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { instagramSite } from '../sites/instagram';

const STARTED = Symbol.for('feed-sanity/instagram-content-started');

// Registered dynamically at runtime once the user grants optional host
// permission for Instagram (see `src/platform/site-permissions.ts`).
// Using an unlisted script keeps `instagram.com` strictly in
// `optional_host_permissions` rather than required `host_permissions`.
export default defineUnlistedScript(() => {
  const host = globalThis as Record<symbol, boolean | undefined>;
  if (host[STARTED]) {
    return;
  }
  host[STARTED] = true;
  void startSite(instagramSite, extensionPlatform);
});
