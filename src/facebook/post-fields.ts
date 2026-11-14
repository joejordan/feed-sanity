import type { Locate } from '../core/locator';
import { postCaptions, postElements, postText } from './post-text';
import {
  APP_LINK,
  APP_NAMED,
  AUTHOR_HEADING,
  AUTHOR_LINK_OR_IMAGE,
  AUTHOR_NAME,
  EXTERNAL_LINK,
  HASHTAG_LINK,
  NOT_AUTHOR_ADDRESS,
  PAGE_GROUP_NAME,
  POST_GROUP_LABELLED,
  POST_GROUP_NAMED,
  POST_HEADER,
  POST_MESSAGE,
  POST_TIME,
  SHARED_POST_DIVIDER,
} from './selectors';

/**
 * What one part of a post holds. Null means the post has no such part. A
 * list is tested item by item.
 */
export type FieldValue = string | string[] | null;

/** The parts of a post whose text a filter can also rewrite. */
export const TEXT_FIELDS = ['author', 'action', 'content'] as const;

export type TextField = (typeof TEXT_FIELDS)[number];

/**
 * The parts of one post that filters test, read from the page when first
 * asked for and remembered until the post is filtered again.
 */
export interface PostFields {
  /** The value of the part called `name`. An unknown name gives `${name}`, as in Social Fixer. */
  get: (name: string) => FieldValue;
  /** Replaces the remembered value, after a filter rewrote the text. */
  set: (name: string, value: FieldValue) => void;
  /** The elements that hold the text of `name`. */
  elements: (name: TextField) => Element[];
}

const text = (element: Element): string => element.textContent.replaceAll(/\s+/g, ' ').trim();

/** The text of the first element that has any, or null. */
function firstText(elements: Iterable<Element>): string | null {
  for (const element of elements) {
    const found = text(element);
    if (found) {
      return found;
    }
  }
  return null;
}

/** The list without repeats, or null when it is empty. */
function distinct(values: string[]): string[] | null {
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique : null;
}

type Found = [value: string | null, elements: Element[]];

function findAuthor(post: Element, locate: Locate): Found {
  // Works for most posts, and avoids "Joe likes Page" when Page is the author.
  for (const heading of locate(AUTHOR_HEADING).all(post)) {
    for (const name of locate(AUTHOR_NAME).all(heading)) {
      if (text(name)) {
        return [text(name), [name]];
      }
    }
  }
  // Works almost everywhere, but can pick up other links in the header.
  for (const candidate of locate(AUTHOR_LINK_OR_IMAGE).all(post)) {
    if (!(candidate instanceof HTMLAnchorElement)) {
      // The author is never after the first image.
      break;
    }
    const { href } = candidate;
    const isAuthor =
      text(candidate) !== '' &&
      href.includes('www.facebook.com/') &&
      !NOT_AUTHOR_ADDRESS.test(href) &&
      // In a group, the author's link is the member link.
      (!href.includes('/groups/') || href.includes('/user/'));
    if (isAuthor) {
      return [text(candidate), [candidate]];
    }
  }
  return [null, []];
}

function findGroup(post: Element, locate: Locate): string | null {
  const inPage = firstText(locate(PAGE_GROUP_NAME).all(document));
  if (inPage) {
    return inPage;
  }
  const divider = locate(SHARED_POST_DIVIDER);
  for (const link of locate(POST_GROUP_LABELLED).all(post)) {
    const label = link.getAttribute('aria-label');
    if (label && !divider.closest(link)) {
      return label;
    }
  }
  return firstText(locate(POST_GROUP_NAMED).all(post));
}

function findMessage(post: Element, locate: Locate): Found {
  const elements = postElements(post, locate(POST_MESSAGE), locate);
  return elements.length > 0
    ? [elements.map((element) => postText(element, locate)).join('\n'), elements]
    : ['', []];
}

function findAction(post: Element, locate: Locate): Found {
  const header = locate(POST_HEADER).first(post) ?? locate(AUTHOR_HEADING).first(post);
  // The header ends where the post's time and audience begin.
  return header ? [postText(header, locate).replace(/\s*·.*/s, ''), [header]] : ['', []];
}

function findApp(post: Element, locate: Locate): string | null {
  return (
    locate(APP_NAMED).first(post)?.getAttribute('data-appname') ||
    firstText(locate(APP_LINK).all(post))
  );
}

/** When the post was made, or null when its time cannot be read. */
export function postTime(post: Element, locate: Locate): Date | null {
  const seconds = Number(locate(POST_TIME).first(post)?.getAttribute('data-utime'));
  return seconds ? new Date(seconds * 1000) : null;
}

/** The address an external link leads to, or null when the link does not hold one. */
function linkTarget(link: HTMLAnchorElement): string | null {
  const encoded = /facebook\.com\/l\.php\?u=([^&]*)/.exec(link.getAttribute('href') ?? '')?.[1];
  if (!encoded) {
    return null;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/**
 * Reads the parts of a post for filters. `post` is the post's `content` element. The names are Social Fixer's, so
 * its filters work unchanged: `any` content is `all_content`, the author's
 * text is `content`, and so on.
 *
 * Not ported: `page`, which Social Fixer read from React's data on the post.
 * A content script cannot see that data, so `page` is always null.
 */
export function readPostFields(post: Element, locate: Locate): PostFields {
  const values = new Map<string, FieldValue>();
  const elements = new Map<TextField, Element[]>();

  const found = (name: TextField, [value, held]: Found): FieldValue => {
    elements.set(name, held);
    return value;
  };

  const read = (name: string): FieldValue => {
    switch (name) {
      case 'author':
        return found('author', findAuthor(post, locate));
      case 'action':
        return found('action', findAction(post, locate));
      case 'content':
        return found('content', findMessage(post, locate));
      case 'all_content':
        // A post with no text of its own may still have a message Facebook marked up.
        return postText(post, locate) || get('content');
      case 'group':
        return findGroup(post, locate);
      case 'page':
        return null;
      case 'app':
        return findApp(post, locate);
      case 'image':
        return distinct(postCaptions(post, locate));
      case 'link_url':
        return distinct(
          postElements<HTMLAnchorElement>(post, locate(EXTERNAL_LINK), locate).flatMap(
            (link) => linkTarget(link) ?? [],
          ),
        );
      case 'link_text':
        return distinct(
          postElements(post, locate(EXTERNAL_LINK), locate).map((link) => text(link)),
        );
      case 'hashtag':
        return distinct(
          postElements(post, locate(HASHTAG_LINK), locate)
            .map((link) => text(link))
            .filter((tag) => tag.startsWith('#'))
            .map((tag) => tag.slice(1)),
        );
      default:
        return `\${${name}}`;
    }
  };

  function get(name: string): FieldValue {
    if (!values.has(name)) {
      values.set(name, read(name));
    }
    return values.get(name) ?? null;
  }

  return {
    get,
    set: (name, value) => {
      values.set(name, value);
    },
    elements: (name) => {
      get(name);
      return elements.get(name) ?? [];
    },
  };
}
