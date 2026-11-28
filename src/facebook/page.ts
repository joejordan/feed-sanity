import type { Address } from './post-id';
import { postAddress } from './post-id';

/** What kind of Facebook page an address is. */
export interface PageContext {
  /**
   * `newsfeed`, `groups`, `profile`, `post`, `stories`, `reel`, `reels`,
   * or the name of one of Facebook's fixed sections, such as `marketplace`
   * or `watch`.
   */
  readonly type: string;
  /** True when the address names exactly one post. */
  readonly singlePost: boolean;
  /** True when the address focuses one post: a single post's page, a photo, a video or a reel. */
  readonly permalink: boolean;
}

/**
 * Facebook's fixed sections: first path segments that are never a person's
 * or page's name. Each is the page type of the pages under it.
 */
const SECTIONS: ReadonlySet<string> = new Set([
  'bookmarks',
  'business',
  'events',
  'friends',
  'fundraisers',
  'gaming',
  'hashtag',
  'help',
  'live',
  'marketplace',
  'memories',
  'messages',
  'notifications',
  'pages',
  'photo',
  'privacy',
  'search',
  'settings',
  'saved',
  'videos',
  'watch',
]);

/** Every page type `pageContext` can give. None of them can be a person's or page's name. */
const FIXED_PAGE_TYPES: ReadonlySet<string> = new Set([
  ...SECTIONS,
  'newsfeed',
  'groups',
  'profile',
  'post',
  'stories',
  'reel',
  'reels',
]);

/** True when `type` could be a person's or page's name: it is not one of the fixed page types. */
export function mayBeName(type: string): boolean {
  return !FIXED_PAGE_TYPES.has(type);
}

/** The page type of a path's first segment and its single-post flag. */
function pageType(first: string, singlePost: boolean): string {
  switch (first) {
    case '':
    case 'home.php':
      return 'newsfeed';
    case 'groups':
    case 'stories':
    case 'reel':
    case 'reels':
      return first;
    case 'profile.php':
    case 'people':
      return 'profile';
    case 'permalink.php':
    case 'story.php':
      return 'post';
    case 'photo.php':
      return 'photo';
    default:
      break;
  }
  if (SECTIONS.has(first)) {
    return first;
  }
  // Any other first segment is a person's or page's username.
  return singlePost ? 'post' : 'profile';
}

/**
 * The page context of `url`, by default the current page. Reads only the
 * path and the query.
 */
export function pageContext(url: Address & { readonly hostname: string } = location): PageContext {
  const first = url.pathname.split('/').find(Boolean)?.toLowerCase() ?? '';
  const post = postAddress(url);
  return {
    type: pageType(first, post.singlePost),
    singlePost: post.singlePost,
    permalink: post.singlePost || post.id !== null,
  };
}
