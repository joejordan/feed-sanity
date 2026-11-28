import type { Locate } from '../core/locator';
import { pageContext } from './page';
import {
  collapse,
  postBody,
  postElements,
  postMessages,
  postText,
  textSkip,
  textUnder,
  walkText,
} from './post-text';
import {
  GROUP_NAME,
  POST_AUTHOR,
  POST_GROUP_LINK,
  POST_HEADER,
  SUGGESTION_BUTTON,
} from './selectors';
import { facebookUrl, isFacebookHost, isOwnHost } from './urls';

/** A part's value. Null when the post has no such part. */
export type FieldValue = string | readonly string[] | null;

/** The parts whose text a "replace" action may rewrite. */
export const TEXT_PARTS = ['author', 'header', 'body'] as const;
export type TextPart = (typeof TEXT_PARTS)[number];

/** The value of the `sponsored` part on an ad. */
export const SPONSORED = 'sponsored';

/** The parts of a post that filters test. Structurally a `FilterFields` (`src/core/filter-types.ts`). */
export interface PostFields {
  get: (name: string) => FieldValue;
  set: (name: string, value: FieldValue) => void;
  /** The elements whose text makes up a text part, for text replacement. */
  elements: (name: TextPart) => Element[];
  readonly textParts: readonly TextPart[];
}

/** The separator dot between a header's who-did-what and its time and audience. */
const SEPARATOR = '·';

/** What a header's text leaves out besides the usual: its buttons (Follow, Join, badges, the menu). */
const HEADER_SKIP = '[role=button]';

/** The distinct non-empty strings of `values`, or null when there are none. */
function distinct(values: Iterable<string>): readonly string[] | null {
  const kept = [...new Set([...values].map(collapse).filter((value) => value !== ''))];
  return kept.length > 0 ? kept : null;
}

/** Facebook's redirect hosts for outbound links: the target is in the `u` parameter. */
const REDIRECT_HOST = /^lm?\.facebook\.com$/i;

/** The redirect page's path. A relative `/l.php?u=` link reaches it on the site's own host. */
const REDIRECT_PATH = '/l.php';

/** The real target of a link in a post, or null for a link within Facebook. */
function outboundTarget(href: string | null): string | null {
  let url = facebookUrl(href);
  if (!url) {
    return null;
  }
  if (
    REDIRECT_HOST.test(url.hostname) ||
    (isFacebookHost(url.hostname) && url.pathname === REDIRECT_PATH)
  ) {
    const target = url.searchParams.get('u');
    if (!target || !URL.canParse(target)) {
      return null;
    }
    url = new URL(target);
  } else if (isOwnHost(url.hostname)) {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  // Facebook adds its click ID to every target.
  url.searchParams.delete('fbclid');
  return url.href;
}

/** True when `href` is a group's own page, as `/groups/<group>/`, and not a post in it. */
function isGroupPage(href: string | null): boolean {
  const url = facebookUrl(href);
  return url !== null && isFacebookHost(url.hostname) && /^\/groups\/[^/]+\/?$/.test(url.pathname);
}

/** A header's text up to the separator dot that starts the time and audience. */
function headerText(header: Element, skip: string): string {
  const pieces: string[] = [];
  walkText(header, `${skip},${HEADER_SKIP}`, (text) => {
    const cut = text.data.indexOf(SEPARATOR);
    pieces.push(cut === -1 ? text.data : text.data.slice(0, cut));
    return cut !== -1;
  });
  return collapse(pieces.join(' '));
}

/** The name of the group a group page is about, or null on any other page. */
function pageGroup(locate: Locate): string | null {
  if (
    pageContext().type !== 'groups' ||
    /^\/groups\/(?:feed|discover)(?:\/|$)/.test(location.pathname)
  ) {
    return null;
  }
  const heading = locate(GROUP_NAME).first(document);
  return heading ? collapse(heading.textContent ?? '') || null : null;
}

/** Reads the parts of the post whose content is `content`. Each part is read once, when first asked for. */
export function readPostFields(content: Element, locate: Locate): PostFields {
  const values = new Map<string, FieldValue>();
  const skip = textSkip(locate);
  let parts: { header: Element | null; author: Element | null } | undefined;

  /** The post's own header (a shared post's header comes later) and the author link in it. */
  const ownParts = (): { header: Element | null; author: Element | null } => {
    if (!parts) {
      const header = postElements(content, locate(POST_HEADER), locate)[0] ?? null;
      const author = postElements(header ?? content, locate(POST_AUTHOR), locate)[0] ?? null;
      parts = { header, author };
    }
    return parts;
  };

  let linkList: HTMLAnchorElement[] | undefined;
  const links = (): HTMLAnchorElement[] => {
    linkList ??= postElements<HTMLAnchorElement>(content, 'a[href]', locate);
    return linkList;
  };

  let outboundList: { link: HTMLAnchorElement; target: string }[] | undefined;
  const outbound = (): { link: HTMLAnchorElement; target: string }[] => {
    outboundList ??= links().flatMap((link) => {
      const target = outboundTarget(link.getAttribute('href'));
      return target ? [{ link, target }] : [];
    });
    return outboundList;
  };

  const imageText = (): readonly string[] | null =>
    distinct(postElements(content, 'img[alt]', locate).map((img) => img.getAttribute('alt') ?? ''));

  const read = (name: string): FieldValue => {
    switch (name) {
      case 'text':
        return postText(content, locate);
      case 'text_with_images': {
        const images = (get('image_text') as readonly string[] | null) ?? [];
        return [get('text') as string, ...images].filter((piece) => piece !== '').join(' ');
      }
      case 'body':
        return postBody(content, locate);
      case 'header': {
        const { header } = ownParts();
        return header ? headerText(header, skip) : null;
      }
      case 'author': {
        const { author } = ownParts();
        return author ? textUnder(author, skip) || null : null;
      }
      case 'group': {
        const onPage = pageGroup(locate);
        if (onPage) {
          return onPage;
        }
        const { header } = ownParts();
        const link = header
          ? locate(POST_GROUP_LINK)
              .all(header)
              .find((a) => isGroupPage(a.getAttribute('href')))
          : undefined;
        return link ? textUnder(link, skip) || null : null;
      }
      case 'hashtags':
        return distinct(
          links()
            .map((link) => collapse(link.textContent ?? ''))
            .filter((text) => text.startsWith('#'))
            .map((text) => text.slice(1)),
        );
      case 'link_urls':
        return distinct(outbound().map(({ target }) => target));
      case 'link_texts':
        return distinct(outbound().map(({ link }) => link.textContent ?? ''));
      case 'image_text':
        return imageText();
      case 'suggested': {
        const { header } = ownParts();
        const button = header ? locate(SUGGESTION_BUTTON).first(header) : null;
        return button ? collapse(button.textContent ?? '') || 'suggested' : null;
      }
      default:
        // `sponsored` is set by post filters; every other name is no part of a post.
        return null;
    }
  };

  const get = (name: string): FieldValue => {
    if (!values.has(name)) {
      values.set(name, read(name));
    }
    return values.get(name) ?? null;
  };

  return {
    get,
    set: (name, value) => {
      values.set(name, value);
    },
    elements: (name) => {
      switch (name) {
        case 'author': {
          const { author } = ownParts();
          return author ? [author] : [];
        }
        case 'header': {
          const { header } = ownParts();
          return header ? [header] : [];
        }
        default:
          return postMessages(content, locate);
      }
    },
    textParts: TEXT_PARTS,
  };
}

/**
 * The time the post was made, from a machine-readable time in its markup,
 * or null. In the live checks of 2026-11 the feed showed none, so this is
 * null there and age conditions do not match.
 */
export function postTime(content: Element, locate: Locate): Date | null {
  for (const time of postElements(content, 'time[datetime]', locate)) {
    const value = Date.parse(time.getAttribute('datetime') ?? '');
    if (!Number.isNaN(value)) {
      return new Date(value);
    }
  }
  return null;
}
