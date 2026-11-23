import type { PageBridge } from '../../core/bridge';
import type { DomEnvironment } from '../../core/dom-env';
import type { FilterFields } from '../../core/filter-engine';
import type { Locate } from '../../core/locator';
import type { SiteFeedItem } from '../shared/feed';
import { queryDeepFirst } from '../../core/dom';
import { OWN_ATTR } from '../../core/surface';
import { SiteFeed } from '../shared/feed';
import { REDDIT_POST } from './selectors';

export type RedditPost = SiteFeedItem;

const SKIP_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const COMMENTS_LINK = /\/comments\/([a-z0-9]+)/i;
const SUBREDDIT_LINK = /\/(r\/[A-Za-z0-9_]+)/;
const AUTHOR_LINK = /\/u(?:ser)?\/([A-Za-z0-9_-]+)/;
const SUGGESTED_PHRASE =
  /\b(?:because you visited|popular near you|similar to|recommended for you)\b/i;

/**
 * Collects readable text across both light DOM and arbitrarily nested open
 * Shadow Roots inside `root`, skipping `<script>`/`<style>` and Feed Sanity's
 * own injected overlays (`OWN_ATTR`).
 */
export function deepTextContent(root: Node): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue?.trim();
      if (value) {
        parts.push(value);
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (SKIP_TEXT_TAGS.has(el.tagName) || el.hasAttribute(OWN_ATTR)) {
        return;
      }
      for (const child of el.childNodes) {
        walk(child);
      }
      if (el.shadowRoot) {
        walk(el.shadowRoot);
      }
      return;
    }
    for (const child of node.childNodes) {
      walk(child);
    }
  };
  walk(root);
  return parts.join(' ');
}

const CREDIT_BAR_SELECTOR =
  '[slot="credit-bar"], .credit-bar, [data-testid="promoted-badge"], [data-testid="recommendation-reason"]';

function extractPostId(element: Element): string | null {
  const direct =
    element.getAttribute('id') ??
    element.getAttribute('thing-id') ??
    element.getAttribute('post-id');
  if (direct && /^t3_[a-z0-9_-]+$/i.test(direct.trim())) {
    return direct.trim().toLowerCase();
  }
  const permalink =
    element.getAttribute('permalink') ??
    queryDeepFirst(element, 'a[href*="/comments/"]', OWN_ATTR)?.getAttribute('href');
  const match = permalink ? COMMENTS_LINK.exec(permalink) : null;
  return match?.[1] ? `t3_${match[1].toLowerCase()}` : null;
}

function readDomSignals(element: Element): {
  readonly id: string | null;
  readonly isAd: boolean;
  readonly isSuggested: boolean;
} {
  const tag = element.localName;
  let isAd =
    tag === 'shreddit-ad-post' ||
    tag === 'shreddit-dynamic-ad-link' ||
    element.hasAttribute('promoted') ||
    element.getAttribute('is-promoted') === 'true' ||
    element.getAttribute('ad-events') !== null;

  let isSuggested =
    element.hasAttribute('is-recommended') ||
    element.getAttribute('recommendation-source') !== null ||
    element.getAttribute('feed-reason') !== null;

  if (!isAd || !isSuggested) {
    const credit = queryDeepFirst(element, CREDIT_BAR_SELECTOR, OWN_ATTR);
    if (credit) {
      const text = deepTextContent(credit);
      if (!isAd && /\bPromoted\b/.test(text)) {
        isAd = true;
      }
      if (!isSuggested && SUGGESTED_PHRASE.test(text)) {
        isSuggested = true;
      }
    }
  }

  return {
    id: extractPostId(element),
    isAd,
    isSuggested,
  };
}

function readSubreddit(element: Element): string {
  const prefixed = element.getAttribute('subreddit-prefixed-name')?.trim();
  if (prefixed) {
    return prefixed;
  }
  const name = element.getAttribute('subreddit-name')?.trim();
  if (name) {
    return name.startsWith('r/') ? name : `r/${name}`;
  }
  const link = queryDeepFirst(element, 'a[href*="/r/"]', OWN_ATTR);
  const href = link?.getAttribute('href') ?? '';
  const match = SUBREDDIT_LINK.exec(href);
  return match?.[1] ?? '';
}

function readAuthor(element: Element): string {
  const attr = element.getAttribute('author')?.trim();
  if (attr) {
    return attr.startsWith('u/') ? attr : `u/${attr}`;
  }
  const link = queryDeepFirst(element, 'a[href*="/user/"], a[href*="/u/"]', OWN_ATTR);
  const href = link?.getAttribute('href') ?? '';
  const match = AUTHOR_LINK.exec(href);
  return match?.[1] ? `u/${match[1]}` : '';
}

function readTitle(element: Element): string {
  const attr = element.getAttribute('post-title')?.trim();
  if (attr) {
    return attr;
  }
  const heading = queryDeepFirst(
    element,
    '[slot="title"], [data-testid="post-title"], h1, h2, h3',
    OWN_ATTR,
  );
  return heading ? deepTextContent(heading) : '';
}

function readDomain(element: Element): string {
  const attr = element.getAttribute('domain')?.trim();
  if (attr) {
    return attr;
  }
  const link = queryDeepFirst(element, 'a[href^="http"]', OWN_ATTR);
  const href = link?.getAttribute('href');
  if (!href) {
    return '';
  }
  try {
    return new URL(href).hostname;
  } catch {
    return '';
  }
}

function readFlair(element: Element): string {
  const attr = element.getAttribute('flair-text')?.trim();
  if (attr) {
    return attr;
  }
  const flair = queryDeepFirst(
    element,
    '[slot="post-flair"], [data-testid="post-flair"], shreddit-post-flair',
    OWN_ATTR,
  );
  return flair ? deepTextContent(flair) : '';
}

function readRedditFields(
  element: HTMLElement,
  signals: { readonly isAd: boolean; readonly isSuggested: boolean },
): FilterFields {
  let allText: string | undefined;
  let title: string | undefined;
  let subreddit: string | undefined;
  let author: string | undefined;
  let domain: string | undefined;
  let flair: string | undefined;

  return {
    get(name) {
      switch (name) {
        case 'all_content':
        case 'any': {
          if (allText === undefined) {
            title ??= readTitle(element);
            subreddit ??= readSubreddit(element);
            author ??= readAuthor(element);
            domain ??= readDomain(element);
            const deep = deepTextContent(element);
            allText = [title, subreddit, author, domain, deep].filter(Boolean).join(' ');
          }
          return allText;
        }
        case 'title':
        case 'content':
          title ??= readTitle(element);
          return title;
        case 'subreddit':
          subreddit ??= readSubreddit(element);
          return subreddit;
        case 'author':
          author ??= readAuthor(element);
          return author;
        case 'domain':
        case 'link_url':
          domain ??= readDomain(element);
          return domain;
        case 'flair':
          flair ??= readFlair(element);
          return flair;
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
 * Tracks Reddit Shreddit post Web Components (`shreddit-post`,
 * `shreddit-ad-post`, nested open Shadow DOM posts) via shared `SiteFeed`,
 * reading both custom-element attributes and nested open Shadow Root text.
 */
export class RedditFeed extends SiteFeed {
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
        logName: 'reddit-feed',
        itemSpec: REDDIT_POST,
        readerName: 'reddit-post-meta',
        readDomSignals,
        readText: (element) => {
          const combined = [
            element.getAttribute('post-title') ?? '',
            element.getAttribute('subreddit-prefixed-name') ?? '',
            element.getAttribute('author') ?? '',
            deepTextContent(element),
          ]
            .filter(Boolean)
            .join(' ');
          return combined.length > 0 ? combined : null;
        },
        readFields: readRedditFields,
      },
      onBridgeActive,
    );
  }
}
