import type { PageUrl } from '../../facebook/home-feed';
import type { FeedEntry } from './feeds';
import { isPlainHome, linkTo, shows, siteAddress } from '../../facebook/home-feed';
import { FEEDS, feedById } from './feeds';

/**
 * Where a person arriving at `url` is taken, with the feed `choice` saved,
 * or null to leave them there. Only the plain home address is ever changed,
 * and never to an address that is plain home again, so it cannot go round
 * in a circle.
 */
export function destination(url: PageUrl, choice: string): string | null {
  if (!isPlainHome(url)) {
    return null;
  }
  const { address } = feedById(choice);
  return isPlainHome(siteAddress(address)) ? null : address;
}

/** The entry for the feed `url` shows, or null when it shows none of them. */
export const feedShown = (url: PageUrl): FeedEntry | null =>
  FEEDS.find((feed) => shows(url, feed.address)) ?? null;

/** Where the time of the last move to another feed is kept, for this tab only. */
const SENT_KEY = 'feed_sanity_home_feed_sent';

/**
 * How long after a move to another feed a return to the plain home
 * address counts as Facebook sending the person back. No move is made
 * then, so a feed that Facebook stopped offering cannot cause a loop.
 */
export const BOUNCE_MS = 10_000;

/** Notes the time of a move to another feed. */
export function noteMove(now = Date.now()): void {
  try {
    sessionStorage.setItem(SENT_KEY, String(now));
  } catch {
    // Storage is blocked. Each move is then made as if it were the first.
  }
}

/** True during the `BOUNCE_MS` after a move to another feed. */
export function movedRecently(now = Date.now()): boolean {
  try {
    const at = sessionStorage.getItem(SENT_KEY);
    const since = now - Number(at);
    return at !== null && since >= 0 && since < BOUNCE_MS;
  } catch {
    return false;
  }
}

/** How the page is loaded anew. Tests replace these. */
export const loader = {
  assign: (address: string): void => location.assign(address),
  replace: (address: string): void => location.replace(address),
};

/**
 * Takes the person to `address`. With `replace`, the address takes the
 * place of the current one in the history, so Back does not return to the
 * page that was left, and the page is loaded anew. Otherwise a click on one
 * of Facebook's own links to `address` lets Facebook move there without a
 * reload, and the page is loaded anew only when there is no such link.
 */
export function moveTo(address: string, { replace = false } = {}): void {
  noteMove();
  if (replace) {
    loader.replace(address);
    return;
  }
  const link = linkTo(address);
  if (link) {
    link.click();
  } else {
    loader.assign(address);
  }
}
