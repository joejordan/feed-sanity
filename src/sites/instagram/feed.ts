import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { FilterFields } from '../../core/filter-engine';
import type { Locate } from '../../core/locator';
import type { SiteFeedItem } from '../shared/feed';
import { SiteFeed } from '../shared/feed';
import { IG_FEED_POST } from './selectors';

export type InstagramPost = SiteFeedItem;

const SHORTCODE_LINK = /\/(?:p|reel|reels)\/([A-Za-z0-9_-]{4,})/;
const SHORTCODE_SELECTOR = 'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]';

function extractShortcode(article: Element): string | null {
  const link = article.querySelector(SHORTCODE_SELECTOR);
  const href = link?.getAttribute('href');
  if (!href) {
    return null;
  }
  return SHORTCODE_LINK.exec(href)?.[1] ?? null;
}

function readInstagramDomSignals(article: HTMLElement): {
  id: string | null;
  isAd: boolean;
  isSuggested: boolean;
} {
  let isAd = false;
  let isSuggested = false;
  const doc = article.ownerDocument ?? document;
  const walker = doc.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = (node.nodeValue ?? '').trim();
    if (!raw || raw.length > 32) {
      continue;
    }
    if (/^Sponsored$/i.test(raw)) {
      isAd = true;
    } else if (/^Suggested for you$/i.test(raw)) {
      isSuggested = true;
    }
    if (isAd && isSuggested) {
      break;
    }
  }
  return {
    id: extractShortcode(article),
    isAd,
    isSuggested,
  };
}

function readInstagramFields(
  article: HTMLElement,
  signals: { readonly isAd: boolean; readonly isSuggested: boolean },
): FilterFields {
  let fullText: string | undefined;
  let author: string | undefined;
  let hashtags: string[] | undefined;
  let images: string[] | undefined;

  return {
    get(name) {
      switch (name) {
        case 'all_content':
        case 'any':
        case 'content':
          fullText ??= article.textContent ?? '';
          return fullText;
        case 'author':
          author ??=
            article.querySelector('header a[href^="/"]')?.textContent?.trim() ??
            article.querySelector('a[role="link"]')?.textContent?.trim() ??
            '';
          return author;
        case 'hashtag':
          hashtags ??= [...article.querySelectorAll('a[href*="/explore/tags/"]')]
            .map((a) => a.textContent?.trim() ?? '')
            .filter((tag) => tag.length > 0);
          return hashtags;
        case 'image':
          images ??= [...article.querySelectorAll('img[alt]')]
            .map((img) => img.getAttribute('alt')?.trim() ?? '')
            .filter((alt) => alt.length > 0);
          return images;
        case 'sponsored':
          return signals.isAd ? 'sponsored' : '';
        case 'suggested':
          return signals.isSuggested ? 'suggested' : '';
        default:
          return null;
      }
    },
  };
}

/**
 * Tracks Instagram `<article>` feed posts via shared `SiteFeed` and enriches
 * each post with React fiber + Network Tap ad/suggested metadata over the
 * `PageBridge`.
 */
export class InstagramFeed extends SiteFeed {
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
        logName: 'ig-feed',
        itemSpec: IG_FEED_POST,
        readerName: 'ig-post-meta',
        readDomSignals: readInstagramDomSignals,
        readFields: readInstagramFields,
      },
      onBridgeActive,
    );
  }
}
