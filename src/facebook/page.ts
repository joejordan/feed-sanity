/** What kind of Facebook page a URL is, worked out from its path. */
export interface PageContext {
  /** `newsfeed`, `profile`, `groups`, `marketplace`, `messages`, or the first path segment. */
  type: string;
  /** The profile, group, conversation or category the page is about, when the path names one. */
  id: string | null;
  /** True when the address names one post, so the page shows that post and its comments. */
  singlePost: boolean;
  /**
   * True when the address points at particular posts: a single post, a page
   * opened from a notification, or a group feed with linked posts on top.
   */
  permalink: boolean;
}

interface PageUrl {
  hostname: string;
  pathname: string;
  search: string;
}

function typeAndId(hostname: string, path: string[]): Pick<PageContext, 'id' | 'type'> {
  const [first, second, third] = path;
  if (!first || first === 'home.php') {
    return { type: 'newsfeed', id: null };
  }
  if (first === 'marketplace') {
    return { type: 'marketplace', id: (second === 'category' ? third : second) ?? null };
  }
  if (first === 'messages') {
    return { type: 'messages', id: (second === 't' ? third : null) ?? null };
  }
  if (hostname.endsWith('messenger.com')) {
    return { type: 'messages', id: (first === 't' ? second : null) ?? null };
  }
  if (path.length === 1 || second === 'posts') {
    return { type: 'profile', id: first };
  }
  if (first === 'pg' && third === 'posts') {
    return { type: 'profile', id: second ?? null };
  }
  return { type: first, id: second ?? null };
}

function isSinglePost(path: string[], search: string): boolean {
  const [first, second, third] = path;
  if (second === 'posts' && third !== undefined && /^(?:\d|pfbid0)/.test(third)) {
    return true;
  }
  if (first === 'permalink.php') {
    return true;
  }
  return (
    first === 'groups' &&
    (search.includes('view=permalink') || third === 'posts' || third === 'permalink')
  );
}

/** A page opened from a notification, or a group feed with linked posts on top. */
function pointsAtPosts(path: string[], search: string): boolean {
  return (
    search.includes('notif_id=') || (path[0] === 'groups' && search.includes('multi_permalinks='))
  );
}

/** Describes the page at `url`, which defaults to the current one. */
export function pageContext(url: PageUrl = location): PageContext {
  const path = url.pathname.replaceAll(/^\/+|\/+$/g, '').split('/');
  const singlePost = isSinglePost(path, url.search);
  return {
    ...typeAndId(url.hostname, path),
    singlePost,
    permalink: singlePost || pointsAtPosts(path, url.search),
  };
}
