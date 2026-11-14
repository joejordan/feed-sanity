// Facebook's home page and the feeds it can show. On 2026-11-14 the
// desktop site's Feeds page offered five, each an address on the home path
// with a `filter` and `sk=h_chr`. The plain home address shows Facebook's
// own choice of posts.

import { OWN_ELEMENT } from './selectors';

/** The plain home address, which shows Facebook's own feed. */
export const HOME_ADDRESS = '/';

/** The address of one of Facebook's own feeds, such as `friends` or `all`. */
export const feedAddress = (filter: string): string => `/?filter=${filter}&sk=h_chr`;

/** The paths that are the home page. */
const HOME_PATHS = new Set(['/', '/home.php']);

/** The parts of an address the home page is told by. */
export type PageUrl = Pick<URL, 'pathname' | 'search'>;

/** `address`, which may be relative to the site, as a full address. */
export const siteAddress = (address: string): URL => new URL(address, location.origin);

const pathOf = ({ pathname }: PageUrl): string => (HOME_PATHS.has(pathname) ? '/' : pathname);

/**
 * True for the plain home address: the home path with an empty query. A
 * query of any kind, such as a notification's or `?sk=h_nor`, asks for
 * something in particular and does not count.
 */
export const isPlainHome = (url: PageUrl): boolean =>
  HOME_PATHS.has(url.pathname) && url.search.replace(/^\?/, '') === '';

/**
 * True when `url` shows the page that `address` names: the same path, the
 * home paths counting as one, and every part of the query of `address` with
 * the same value. An address with no query matches only an address with
 * none.
 */
export const shows = (url: PageUrl, address: string): boolean =>
  showsPage(url, siteAddress(address));

function showsPage(url: PageUrl, wanted: URL): boolean {
  if (pathOf(url) !== pathOf(wanted)) {
    return false;
  }
  const has = new URLSearchParams(url.search);
  if (wanted.search === '') {
    return has.size === 0;
  }
  return [...wanted.searchParams].every(([name, value]) => has.getAll(name).includes(value));
}

/**
 * One of Facebook's own links in the page that leads to `address`, or null.
 * A click on it lets Facebook move there in the page, without a reload.
 */
export function linkTo(address: string): HTMLAnchorElement | null {
  const wanted = siteAddress(address);
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = siteAddressOf(link);
    if (url && showsPage(url, wanted)) {
      return link;
    }
  }
  return null;
}

/**
 * Where `link` leads, when it is one of Facebook's own links on this site
 * that opens in the same tab. Null for any other link, and for one in this
 * project's UI.
 */
export function siteAddressOf(link: HTMLAnchorElement): URL | null {
  const url = URL.canParse(link.href) ? new URL(link.href) : null;
  return url?.origin === location.origin && link.target === '' && !link.closest(OWN_ELEMENT)
    ? url
    : null;
}
