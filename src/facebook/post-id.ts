import type { Locate } from '../core/locator';
import { postElements } from './post-text';
import { FEED_SLOT, POST_TIME_LINK } from './selectors';
import { facebookUrl, isFacebookHost } from './urls';

/** The parts of an address this module reads. `location` and `URL` both have them. */
export interface Address {
  readonly pathname: string;
  readonly search: string;
}

/** A numeric Facebook ID: at least six digits, with no leading zero. */
const NUMERIC_ID = /^[1-9]\d{5,}$/;

/**
 * Facebook's opaque story token: `pfbid0`, a run of base58 letters (no 0,
 * O, I or l), then a closing `l`.
 */
const STORY_TOKEN = /^pfbid0[1-9A-HJ-NP-Za-km-z]{10,}l$/;

/** True when `value` has the shape of a post ID: a numeric ID or a `pfbid0…` token. */
export function isPostId(value: string): boolean {
  return NUMERIC_ID.test(value) || STORY_TOKEN.test(value);
}

/** The ID in one path segment or parameter. Of `123:4`, only the part before the colon counts. */
function cleanId(raw: string | null | undefined): string | null {
  const id = raw?.split(':', 1)[0]?.trim() ?? '';
  return isPostId(id) ? id : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** What an address says about a post. */
export interface PostAddress {
  /** The ID of the post the address names, or null. Never a group's, profile's or user's ID. */
  readonly id: string | null;
  /** True when the address is a single post's page, even if its ID could not be read. */
  readonly singlePost: boolean;
}

const NOWHERE: PostAddress = { id: null, singlePost: false };

/**
 * Reads the post an address names. The shapes, all seen on Facebook:
 * `/<user>/posts/<id>`, `/groups/<group>/posts/<id>`,
 * `/groups/<group>/permalink/<id>`, `/permalink.php?story_fbid=<id>`,
 * `/story.php?story_fbid=<id>`, `/photo/?fbid=<id>`, `/watch/?v=<id>`,
 * `/reel/<id>`, `/videos/<id>` (also under a user) and
 * `/marketplace/item/<id>`. The first five are single-post pages.
 */
export function postAddress({ pathname, search }: Address): PostAddress {
  const segments = pathname.split('/').filter(Boolean).map(decodeSegment);
  const [first = '', second = '', third = '', fourth = ''] = segments;
  const section = first.toLowerCase();
  const params = new URLSearchParams(search);
  switch (section) {
    case 'groups': {
      const single = (third === 'posts' || third === 'permalink') && fourth !== '';
      return single ? { id: cleanId(fourth), singlePost: true } : NOWHERE;
    }
    case 'permalink.php':
    case 'story.php':
      return { id: cleanId(params.get('story_fbid')), singlePost: true };
    case 'photo':
    case 'photo.php':
      return { id: cleanId(params.get('fbid')), singlePost: false };
    case 'watch':
      return { id: cleanId(params.get('v')), singlePost: false };
    case 'reel':
    case 'videos':
      return { id: cleanId(second), singlePost: false };
    case 'marketplace':
      return { id: second === 'item' ? cleanId(third) : null, singlePost: false };
    default:
      break;
  }
  if (second === 'posts' && third !== '') {
    return { id: cleanId(third), singlePost: true };
  }
  if (second === 'videos') {
    return { id: cleanId(third), singlePost: false };
  }
  return NOWHERE;
}

/** The ID of the post a link's address names, or null for any address that is not Facebook's. */
export function postIdFromLink(href: string | null): string | null {
  const url = facebookUrl(href);
  return url?.protocol === 'https:' && isFacebookHost(url.hostname) ? postAddress(url).id : null;
}

/**
 * True when the address names the post `id`: it appears in the decoded
 * address as a whole token, not as part of a longer number or token.
 */
export function addressNames(id: string, { pathname, search }: Address = location): boolean {
  if (!isPostId(id)) {
    return false;
  }
  // An address with a stray % is read as it is.
  const address = decodeSegment(`${pathname}${search}`);
  return new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(address);
}

/**
 * The Facebook ID of the post `post`, or null when it has none that can be
 * read. Tries the post's time link first, whose address is the post's own,
 * and then, for a post outside the news feed on a single post's page, the
 * page's address. Links in comments do not count.
 */
export function findPostId(post: Element, locate: Locate): Promise<string | null> {
  for (const link of postElements(post, locate(POST_TIME_LINK), locate)) {
    const id = postIdFromLink(link.getAttribute('href'));
    if (id) {
      return Promise.resolve(id);
    }
  }
  if (!locate(FEED_SLOT).closest(post)) {
    const page = postAddress(location);
    if (page.singlePost) {
      return Promise.resolve(page.id);
    }
  }
  return Promise.resolve(null);
}
