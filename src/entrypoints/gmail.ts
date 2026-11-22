import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startSite } from '../core/site';
import { extensionPlatform } from '../platform/extension';
import { gmailSite } from '../sites/gmail';

const STARTED = Symbol.for('feed-sanity/gmail-content-started');

// Registered dynamically at runtime once the user grants optional host
// permission for Gmail (`mail.google.com`). No MAIN-world page script needed.
export default defineUnlistedScript(() => {
  const host = globalThis as Record<symbol, boolean | undefined>;
  if (host[STARTED]) {
    return;
  }
  host[STARTED] = true;
  void startSite(gmailSite, extensionPlatform);
});
