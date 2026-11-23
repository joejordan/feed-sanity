import { intercept, isPlainPress } from '../../../core/intercept';
import { defineInstagramFeature } from '../feature';
import { instagramAccountId } from '../page';
import { IG_NAV_HOME } from '../selectors';

const FOLLOWING_URL = '/?variant=following';
const LOOP_GUARD_KEY = 'feed-sanity:ig-following-redirect';
const LOOP_GUARD_MS = 2000;

export function isPlainInstagramHome(loc: Pick<Location, 'pathname' | 'search'>): boolean {
  const path = loc.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/') {
    return false;
  }
  return !new URLSearchParams(loc.search).has('variant');
}

function readLastRedirect(fallback: number): number {
  try {
    const raw = sessionStorage.getItem(LOOP_GUARD_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return Math.max(fallback, parsed);
      }
    }
  } catch {
    // sessionStorage unavailable; use in-memory timestamp.
  }
  return fallback;
}

function writeLastRedirect(time: number): void {
  try {
    sessionStorage.setItem(LOOP_GUARD_KEY, String(time));
  } catch {
    // Ignore storage quota or privacy restrictions.
  }
}

/**
 * Redirects plain `https://www.instagram.com/` visits and Home button clicks
 * to the chronological Following feed (`/?variant=following`). Persists the
 * loop-guard timestamp in `sessionStorage` so a server redirect back to `/`
 * can never trigger a reload loop, and skips automatic redirect when signed out.
 */
export default defineInstagramFeature({
  id: 'ig_default_following',
  options: {
    ig_default_following: {
      section: 'Feed & Clutter',
      group: 'Feed',
      title: 'Default to Following feed',
      description:
        'Open the chronological Following feed (?variant=following) automatically instead of the algorithmic For You home feed.',
      keywords: ['chronological', 'following', 'feed'],
      default: false,
    },
  },
  enabledBy: 'ig_default_following',
  setup({ page, scope, log }) {
    let lastRedirectAt = 0;

    const goFollowing = (): void => {
      if (instagramAccountId() === 'anonymous') {
        return;
      }
      const now = Date.now();
      if (now - readLastRedirect(lastRedirectAt) < LOOP_GUARD_MS) {
        return;
      }
      lastRedirectAt = now;
      writeLastRedirect(now);
      location.replace(FOLLOWING_URL);
    };

    const checkCurrent = (): void => {
      if (isPlainInstagramHome(location)) {
        goFollowing();
      }
    };

    checkCurrent();
    page.onUrlChange(checkCurrent);

    const homeLocator = page.locate(IG_NAV_HOME);
    intercept(
      scope,
      ['click'],
      (event) => {
        const mouse = event as MouseEvent;
        if (!isPlainPress(mouse) || !(event.target instanceof Element)) {
          return false;
        }
        const link = homeLocator.closest(event.target);
        if (!link) {
          return false;
        }
        event.preventDefault();
        location.assign(FOLLOWING_URL);
        return true;
      },
      log,
    );
  },
});
