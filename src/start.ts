import type { Platform } from './core/platform';
import { SiteRegistry } from './core/site';
import { facebookSite } from './sites/facebook';
import { gmailSite } from './sites/gmail';
import { instagramSite } from './sites/instagram';
import { redditSite } from './sites/reddit';
import { xSite } from './sites/x';

/** Registry of all compiled site adapters (Facebook, X, Instagram, Reddit, Gmail). */
export const siteRegistry = new SiteRegistry()
  .register(facebookSite)
  .register(xSite)
  .register(instagramSite)
  .register(redditSite)
  .register(gmailSite);

/** Starts the matching site adapter on the current page. Shared by userscript and tests. */
export function start(platform: Platform): Promise<string[]> {
  const matched = siteRegistry.matchHost(location.hostname);
  return matched ? matched.start(platform) : Promise.resolve([]);
}
