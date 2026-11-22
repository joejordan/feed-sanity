import type { Platform } from './core/platform';
import { SiteRegistry, startSite } from './core/site';
import { facebookSite } from './sites/facebook';
import { instagramSite } from './sites/instagram';
import { xSite } from './sites/x';

/** Registry of all compiled site adapters (Facebook, Instagram, X; ready for TikTok, Gmail). */
export const siteRegistry = new SiteRegistry()
  .register(facebookSite)
  .register(instagramSite)
  .register(xSite);

/** Starts the matching site adapter on the current page. Shared by extensions and userscript. */
export function start(platform: Platform): Promise<string[]> {
  const matched = siteRegistry.matchHost(location.hostname);
  return matched ? matched.start(platform) : startSite(facebookSite, platform);
}
