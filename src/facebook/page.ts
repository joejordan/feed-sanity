/** What kind of Facebook page a URL is, worked out from its path. */
export interface PageContext {
  /** `newsfeed`, `profile`, `groups`, `marketplace`, `messages`, or the first path segment. */
  type: string;
  /** The profile, group, conversation or category the page is about, when the path names one. */
  id: string | null;
  /** True when the page shows a single post. */
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

function isPermalink(path: string[], search: string): boolean {
  const [first, second, third] = path;
  if (second === 'posts' && third !== undefined && /^(?:\d|pfbid0)/.test(third)) {
    return true;
  }
  if (first === 'permalink.php' || search.includes('notif_id=')) {
    return true;
  }
  return (
    first === 'groups' &&
    (search.includes('view=permalink') ||
      search.includes('multi_permalinks=') ||
      third === 'posts' ||
      third === 'permalink')
  );
}

/** Describes the page at `url`, which defaults to the current one. */
export function pageContext(url: PageUrl = location): PageContext {
  const path = url.pathname.replaceAll(/^\/+|\/+$/g, '').split('/');
  return { ...typeAndId(url.hostname, path), permalink: isPermalink(path, url.search) };
}
