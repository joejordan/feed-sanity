import type { Platform } from './core/platform';
import { SiteRegistry, startSite } from './core/site';
import { facebookSite } from './sites/facebook';
import { instagramSite } from './sites/instagram';

/** Registry of all compiled site adapters (Facebook and Instagram; ready for X.com, TikTok, Gmail). */
export const siteRegistry = new SiteRegistry().register(facebookSite).register(instagramSite);

/** Starts the matching site adapter on the current page. Shared by extensions and userscript. */
export function start(platform: Platform): Promise<string[]> {
  const matched = siteRegistry.matchHost(location.hostname);
  return matched ? matched.start(platform) : startSite(facebookSite, platform);
}
