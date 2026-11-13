import type { AtomTranslator } from './atoms';
import { createLogger } from '../core/log';
import { sleep } from '../core/timing';
import { pageContext } from './page';
import { MARK, MARKETPLACE_ID_LINK, POST_ID_LINKS, TIMESTAMP } from './selectors';

const log = createLogger('post-id');

/** A run of at least six digits, optionally followed by a one or two digit sub-ID (`12345678:9`). */
const ID = String.raw`\d{6,}(?:|:\d{1,2})`;

/** Addresses that hold a number which is not a post ID. */
function isNotPost(url: URL): boolean {
  return (
    // A profile
    url.href.includes('/profile.php') ||
    // A member's page in a group
    /\/groups\/[^/]*\/user\//.test(url.pathname) ||
    // A fundraiser linked from the feed
    (/\/donate\/[\d:]{6,}\/$/.test(url.pathname) && url.search.includes('fundraiser_source=feed'))
  );
}

/** The post ID inside an encoded `comment_id` parameter, which decodes to `comment:POST_COMMENT`. */
function idFromCommentLink(url: URL): string | undefined {
  const encoded = /comment_id=((?:Y29|Q09|Q29)[A-Za-z0-9]{20,75}[=%3Dd]{0,12})(?:$|&)/.exec(
    url.search,
  )?.[1];
  if (!encoded) {
    return undefined;
  }
  try {
    const decoded = atob(decodeURIComponent(encoded)).toLowerCase();
    return /comment:(\d{6,})[:_]/.exec(decoded)?.[1];
  } catch {
    // Not base64 after all.
    return undefined;
  }
}

const idPattern = (before: string, after = ''): RegExp => new RegExp(`${before}(${ID})${after}`);

const IN_KNOWN_PATH = idPattern(
  String.raw`\/(?:posts|permalink|video|stories|marketplace\/item)\/`,
  String.raw`(?:$|\/)`,
);
const IN_PERMALINK = idPattern('permalinks?[=:]', String.raw`(?:$|\D)`);
const IN_FBID = idPattern('(?:fbid|post_id)[=:]', String.raw`(?:$|\D)`);
const IN_PCB = idPattern(String.raw`\Wpcb\.`, String.raw`(?:$|\D)`);
const ENDS_PATH = idPattern(String.raw`(?:\d:|\/)`, String.raw`\/?$`);
const ENDS_PATH_PART = idPattern('[=:/]', String.raw`(?:$|\/)`);
const AFTER_SEPARATOR = idPattern('[=:]', String.raw`(?:$|\D)`);
const IN_PHOTO_SET = idPattern(String.raw`set=[^&?/]*a\.`);

/** Tries the known places an ID sits in an address, most reliable first. */
function numericId(url: URL): string | undefined {
  const groupId = /\/groups\/(\d+)(?:$|\/)/.exec(url.pathname)?.[1];
  const notGroup = (id: string | undefined): string | undefined =>
    id === groupId ? undefined : id;

  return (
    // /posts/ID, /permalink/ID, /video/ID, /stories/ID, /marketplace/item/ID
    IN_KNOWN_PATH.exec(url.pathname)?.[1] ??
    // /watch/?v=ID
    (url.pathname === '/watch/' ? /\bv=(\d{6,})/.exec(url.search)?.[1] : undefined) ??
    // permalink=ID, multi_permalinks=ID
    IN_PERMALINK.exec(url.href)?.[1] ??
    // fbid=ID, post_id=ID
    IN_FBID.exec(url.href)?.[1] ??
    // pcb.ID
    IN_PCB.exec(url.href)?.[1] ??
    // A path ending in /ID, or in digits:ID
    notGroup(ENDS_PATH.exec(url.pathname)?.[1]) ??
    // =ID, :ID or /ID ending any part of the path
    notGroup(ENDS_PATH_PART.exec(url.pathname)?.[1]) ??
    // =ID or :ID anywhere
    AFTER_SEPARATOR.exec(url.href)?.[1] ??
    // set=a.ID, the address of a whole photo set
    IN_PHOTO_SET.exec(url.search)?.[1]
  );
}

/**
 * Reads Facebook's ID for a post out of a link to the post, a comment on it
 * or a reply. Returns null when the address holds none.
 *
 * Addresses of the `pfbid0...` kind are returned whole, because nobody
 * outside Facebook knows how to decode them into a number.
 */
export function extractPostId(
  href: string,
  base: string = location.origin + location.pathname,
): string | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (isNotPost(url)) {
    return null;
  }
  const opaque = /[/?&=](pfbid0[1-9A-HJ-NP-Za-km-z]{20,75}l)\b/.exec(url.href)?.[1];
  if (opaque) {
    return opaque;
  }
  const id = idFromCommentLink(url) ?? numericId(url);
  return id && /^\d+:?\d{0,2}$/.test(id) ? id.replace(/:.*/, '') : null;
}

function idFromLinks(post: Element, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    for (const link of post.querySelectorAll<HTMLAnchorElement>(selector)) {
      const id = extractPostId(link.href);
      if (id) {
        return id;
      }
    }
  }
  return null;
}

/**
 * Facebook only acts on pointer events whose coordinates are not zero.
 */
function hover(element: Element, type: 'pointerout' | 'pointerover'): void {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      screenX: 100,
      screenY: 100,
      clientX: 100,
      clientY: 100,
    }),
  );
}

const isRealAddress = (href: string | null): href is string =>
  !!href && href !== '#' && href !== `${location.href}#`;

const POLL_MS = 200;
/** Polls made while the post has no time link at all. */
const POLLS_WITHOUT_TIMESTAMP = 5;
const MAX_POLLS = 40;
/** The polls on which the time link is hovered again. */
const HOVER_POLLS = new Set([0, 1, 3, 5, 8, 11, 15, 20, 25, 31, 39]);

/**
 * Facebook leaves a post's time link pointing at `#` or a stub until the
 * pointer moves over it. This hovers the link and waits for the real address.
 * It takes up to eight seconds, and stops early if the post leaves the page.
 */
async function idFromTimestamp(post: Element, timestampSelector: string): Promise<string | null> {
  let timestamp: HTMLAnchorElement | null = null;
  let hovered = false;
  let id: string | null = null;

  post.classList.add(MARK.touch);
  for (
    let poll = 0;
    poll < MAX_POLLS && post.isConnected && (timestamp || poll < POLLS_WITHOUT_TIMESTAMP);
    poll++
  ) {
    timestamp = post.querySelector<HTMLAnchorElement>(timestampSelector);
    if (timestamp) {
      const href = isRealAddress(timestamp.href) ? timestamp.href : timestamp.getAttribute('href');
      id = isRealAddress(href) ? extractPostId(href) : null;
      if (id) {
        break;
      }
      if (HOVER_POLLS.has(poll)) {
        hovered = true;
        hover(timestamp, 'pointerover');
        hover(timestamp, 'pointerout');
      }
    }
    await sleep(POLL_MS);
  }
  if (timestamp && hovered) {
    hover(timestamp, 'pointerout');
  }
  post.classList.remove(MARK.touch);
  return id;
}

/**
 * Works out Facebook's ID for a post, or null when it cannot be found. Tries
 * the page address, then links inside the post, then hovering the time link.
 *
 * The page address only counts on a page that shows a single post. Elsewhere
 * a number in it belongs to something else, such as an event, and every post
 * on the page would get the same ID.
 */
export async function findPostId(
  post: Element,
  atoms: Pick<AtomTranslator, 'translate'>,
): Promise<string | null> {
  const page = pageContext();
  const fromPage = page.singlePost ? extractPostId(location.href) : null;
  if (fromPage) {
    return fromPage;
  }
  // On Marketplace, a listing's own link holds its ID.
  const links =
    page.type === 'marketplace' ? [MARKETPLACE_ID_LINK, ...POST_ID_LINKS] : POST_ID_LINKS;
  const fromLinks = idFromLinks(
    post,
    links.map((selector) => atoms.translate(selector)),
  );
  if (fromLinks) {
    return fromLinks;
  }
  const fromTimestamp = await idFromTimestamp(post, atoms.translate(TIMESTAMP));
  if (!fromTimestamp) {
    log.debug('no ID found for', post);
  }
  return fromTimestamp;
}
