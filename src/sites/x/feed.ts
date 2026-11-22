import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { Locate } from '../../core/locator';
import type { SiteFeedItem } from '../shared/feed';
import { SiteFeed } from '../shared/feed';
import { X_TWEET } from './selectors';

export type XTweet = SiteFeedItem;

const STATUS_LINK = /\/status\/(\d+)/;

function extractTweetId(article: Element): string | null {
  const link = article.querySelector('a[href*="/status/"]');
  const href = link?.getAttribute('href');
  if (!href) {
    return null;
  }
  return STATUS_LINK.exec(href)?.[1] ?? null;
}

function hasDomAdSignal(article: Element): boolean {
  if (article.querySelector('[data-testid="placementTracking"]') !== null) {
    return true;
  }
  const doc = article.ownerDocument ?? document;
  const walker = doc.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue;
    if (!value || value.length > 16) {
      continue;
    }
    const raw = value.trim();
    if (raw !== 'Ad' && raw !== 'Promoted') {
      continue;
    }
    // Ignore ordinary tweet body text whose content happens to be "Ad" or "Promoted".
    if (node.parentElement?.closest('[data-testid="tweetText"]')) {
      continue;
    }
    return true;
  }
  return false;
}

/**
 * Tracks `article[data-testid="tweet"]` cards on X.com via shared `SiteFeed`
 * and enriches them with React fiber `promotedContent` / `socialContext`
 * metadata over `PageBridge`.
 */
export class XFeed extends SiteFeed {
  constructor(
    env: DomEnvironment,
    locate: Locate,
    bridge: PageBridge,
    onBridgeActive?: () => void,
  ) {
    super(
      env,
      locate,
      bridge,
      {
        logName: 'x-feed',
        itemSpec: X_TWEET,
        readerName: 'x-tweet-meta',
        readDomSignals: (element) => ({
          id: extractTweetId(element),
          isAd: hasDomAdSignal(element),
          isSuggested: false,
        }),
        readText: (element) => {
          const textEl = element.querySelector('[data-testid="tweetText"]');
          const text = textEl?.textContent;
          return text && text.length > 0 ? text : null;
        },
      },
      onBridgeActive,
    );
  }
}
