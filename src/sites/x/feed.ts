import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { FilterFields } from '../../core/filter-engine';
import type { Locate } from '../../core/locator';
import type { SiteFeedItem } from '../shared/feed';
import { listPart } from '../../core/filter-engine';
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

/** Parts whose text a filter's replace action rewrites on screen. */
const X_TEXT_PARTS: readonly string[] = ['text', 'body', 'author', 'hashtags'];

function readXFields(
  article: HTMLElement,
  signals: { readonly isAd: boolean; readonly isSuggested: boolean },
): FilterFields {
  let allText: string | undefined;
  let tweetText: string | undefined;
  let author: string | undefined;
  let hashtags: readonly string[] | null | undefined;
  let links: readonly string[] | null | undefined;
  let images: readonly string[] | null | undefined;

  return {
    textParts: X_TEXT_PARTS,
    get(name) {
      switch (name) {
        case 'text':
          allText ??= article.textContent ?? '';
          return allText;
        case 'body':
          if (tweetText === undefined) {
            const direct = article.querySelector('[data-testid="tweetText"]')?.textContent;
            if (direct) {
              tweetText = direct;
            } else {
              allText ??= article.textContent ?? '';
              tweetText = allText;
            }
          }
          return tweetText;
        case 'author':
          author ??= article.querySelector('[data-testid="User-Name"]')?.textContent ?? '';
          return author;
        case 'hashtags':
          hashtags ??= listPart(
            [...article.querySelectorAll('a[href^="/hashtag/"]')].map((a) =>
              (a.textContent ?? '').trim().replace(/^#/, ''),
            ),
          );
          return hashtags;
        case 'link_urls':
          links ??= listPart(
            [...article.querySelectorAll('a[href]')]
              .map((a) => a.getAttribute('href') ?? '')
              .filter((href) => href.startsWith('http')),
          );
          return links;
        case 'image_text':
          images ??= listPart(
            [...article.querySelectorAll('img[alt]')]
              .map((img) => img.getAttribute('alt')?.trim() ?? '')
              .filter((alt) => alt !== 'Image'),
          );
          return images;
        case 'sponsored':
          return signals.isAd ? 'sponsored' : null;
        case 'suggested':
          return signals.isSuggested ? 'suggested' : null;
        default:
          return null;
      }
    },
  };
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
        readFields: readXFields,
      },
      onBridgeActive,
    );
  }
}
