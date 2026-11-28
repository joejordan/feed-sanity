import type { LocatorSpec } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { Scope } from '../../core/scope';
import { addStyle } from '../../core/dom';
import { hideElement, whileOnRoute } from '../../core/surface';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import {
  FEED_POSITION,
  OWN_ELEMENT,
  REELS_BAR,
  REELS_LINK,
  STORIES_BAR,
} from '../../facebook/selectors';

const STORIES_STYLE_ID = 'feed_sanity_hide_stories_bar';
const REELS_STYLE_ID = 'feed_sanity_hide_reels_bar';

const STORIES_PAGELET = 'Stories';
const STORIES_PAGELET_SELECTOR = `[data-pagelet="${STORIES_PAGELET}"]`;
const REELS_PAGELET_SELECTOR = '[data-pagelet*="Reels" i]';

const STORIES_ZERO_FLASH_CSS = `[role="main"] ${STORIES_PAGELET_SELECTOR} { display: none !important; }`;
const REELS_ZERO_FLASH_CSS = `[role="main"] ${REELS_PAGELET_SELECTOR}:not(${STORIES_PAGELET_SELECTOR}, ${STORIES_PAGELET_SELECTOR} *) { display: none !important; }`;

const REEL_ID_RE = /\/reel\/([^/?#]+)/i;
const REELS_HEADING_RE = /^reels(?:\s+and\s+short\s+videos)?$/i;
const REELS_ROUTE_RE = /^\/reels?(?:\/|$)|^\/(?:groups\/[^/]+|(?!groups\/)[^/]+)\/reels(?:\/|$)/i;
const REELS_LINK_SELECTOR = 'a[href*="/reel/"], a[href*="/reels/"]';
const AUTHORED_POST_SELECTOR =
  'a[href*="/posts/"], a[href*="/permalink/"], a[href*="permalink.php"], a[href*="story.php"], [data-ad-rendering-role="profile_name"], [data-ad-rendering-role="story_message"]';
const PROTECTED_CONTAINER_SELECTOR =
  '[role="main"], [role="feed"], [role="dialog"], [role="banner"], [role="navigation"], [aria-label="Create a post"]';
const MAX_WRAPPER_CLIMB = 2;

const OPTIONS = {
  hide_reels_bar: {
    section: 'Feed & Reading',
    group: 'Hide from Feeds',
    title: 'Hide Reels bar',
    description:
      'Always hide inline Reels and short-video bars across all Facebook feeds without affecting the Reels viewer or shared posts.',
    keywords: ['reels', 'short videos', 'carousel', 'shelf', 'bar', 'feed', 'hide', 'clutter'],
    default: false,
  },
  hide_stories_bar: {
    section: 'Feed & Reading',
    group: 'Hide from Feeds',
    title: 'Hide Stories bar',
    description:
      'Always hide the Stories tray across all Facebook feeds without affecting the Stories viewer.',
    keywords: ['stories', 'story', 'tray', 'carousel', 'shelf', 'bar', 'feed', 'hide', 'clutter'],
    default: false,
  },
} satisfies OptionSpecs;

function isInsideOwnOrDialog(el: Element): boolean {
  return Boolean(el.closest(`${OWN_ELEMENT}, [role="dialog"]`));
}

function isInMainFeedArea(el: Element): boolean {
  return Boolean(el.closest('[role="main"]')) && !isInsideOwnOrDialog(el);
}

function looksLikeAuthoredPost(el: Element): boolean {
  return el.querySelector(AUTHORED_POST_SELECTOR) !== null;
}

function isProtectedContainer(el: Element, allowStoriesPagelet: boolean): boolean {
  if (
    el.matches(PROTECTED_CONTAINER_SELECTOR) ||
    el.querySelector(PROTECTED_CONTAINER_SELECTOR) !== null
  ) {
    return true;
  }
  if (
    !allowStoriesPagelet &&
    (el.matches(STORIES_PAGELET_SELECTOR) || el.querySelector(STORIES_PAGELET_SELECTOR) !== null)
  ) {
    return true;
  }
  return el.querySelectorAll(`[${FEED_POSITION}]`).length > 1;
}

/** Finds the enclosing feed slot (`FeedUnit_*`, `[aria-posinset]`, or direct `[role="feed"]` child). */
function findFeedSlot(el: Element): Element | null {
  const unit = el.closest(`[data-pagelet^="FeedUnit_"], [${FEED_POSITION}]`);
  if (unit) {
    return unit;
  }
  const feed = el.closest('[role="feed"]');
  if (!feed || el === feed) {
    return null;
  }
  let cur: Element = el;
  while (cur.parentElement && cur.parentElement !== feed) {
    cur = cur.parentElement;
  }
  return cur.parentElement === feed ? cur : null;
}

/**
 * Climbs at most a couple of plain single-child layout wrappers above `el`,
 * stopping before pagelets, landmarks, or direct children of `[role="main"]`
 * (which may be a column wrapper still waiting for `[role="feed"]` to hydrate).
 */
function climbSingleChildWrappers(el: Element, allowStoriesPagelet: boolean): Element {
  if (el.hasAttribute('data-pagelet')) {
    return el;
  }
  let target = el;
  for (let depth = 0; depth < MAX_WRAPPER_CLIMB; depth++) {
    const parent = target.parentElement;
    if (
      !parent ||
      parent.childElementCount !== 1 ||
      parent.hasAttribute('data-pagelet') ||
      parent.hasAttribute('role') ||
      parent.parentElement?.getAttribute('role') === 'main' ||
      isProtectedContainer(parent, allowStoriesPagelet)
    ) {
      break;
    }
    target = parent;
  }
  return target;
}

/**
 * Resolves the safe shelf container to hide for a matched Stories/Reels tray so
 * empty margin wrappers collapse cleanly without ever hiding `[role="main"]`,
 * `[role="feed"]`, the post composer, or regular authored posts.
 */
function resolveShelfContainer(el: Element, kind: 'stories' | 'reels'): Element | null {
  if (!isInMainFeedArea(el)) {
    return null;
  }
  const allowStoriesPagelet = kind === 'stories';
  if (!allowStoriesPagelet && el.closest(STORIES_PAGELET_SELECTOR)) {
    return null;
  }
  if (allowStoriesPagelet) {
    const storiesPagelet = el.closest(STORIES_PAGELET_SELECTOR);
    if (storiesPagelet && !isProtectedContainer(storiesPagelet, true)) {
      return storiesPagelet;
    }
  }
  const isDedicatedReelsPagelet =
    !allowStoriesPagelet && Boolean(el.closest(REELS_PAGELET_SELECTOR));
  const slot = findFeedSlot(el);
  if (slot && !isProtectedContainer(slot, allowStoriesPagelet)) {
    // Non-pagelet aria-label matches inside a feed slot must not hide an authored post.
    if (!isDedicatedReelsPagelet && looksLikeAuthoredPost(slot)) {
      return null;
    }
    return slot;
  }
  if (isProtectedContainer(el, allowStoriesPagelet)) {
    return null;
  }
  const target = climbSingleChildWrappers(el, allowStoriesPagelet);
  if (!isDedicatedReelsPagelet && looksLikeAuthoredPost(target)) {
    return null;
  }
  return target;
}

/**
 * True when `unit` is an inline Facebook Reels carousel shelf rather than a
 * regular post that happens to link to a single shared Reel.
 */
export function isReelsBarUnit(unit: Element): boolean {
  if (unit.closest(`${OWN_ELEMENT}, [role="dialog"], ${STORIES_PAGELET_SELECTOR}`)) {
    return false;
  }
  if (isProtectedContainer(unit, false) || looksLikeAuthoredPost(unit)) {
    return false;
  }

  let firstReelId: string | undefined;
  const reelLinks = unit.querySelectorAll('a[href*="/reel/"]');
  for (const link of reelLinks) {
    const href = link.getAttribute('href') ?? '';
    const match = REEL_ID_RE.exec(href);
    const id = match?.[1];
    if (id) {
      if (firstReelId === undefined) {
        firstReelId = id;
      } else if (firstReelId !== id) {
        return true;
      }
    }
  }

  const hasAnyReelsLink = reelLinks.length > 0 || unit.querySelector('a[href*="/reels/"]') !== null;
  if (!hasAnyReelsLink) {
    return false;
  }
  for (const heading of unit.querySelectorAll('h2, h3, h4, [role="heading"]')) {
    const text = heading.textContent?.trim() ?? '';
    if (REELS_HEADING_RE.test(text)) {
      return true;
    }
  }
  return false;
}

function findInlineReelsCandidate(link: Element): Element | null {
  if (!isInMainFeedArea(link) || link.closest(STORIES_PAGELET_SELECTOR)) {
    return null;
  }
  const slot = findFeedSlot(link);
  if (slot) {
    return slot;
  }
  const region = link.closest('[role="region"]');
  if (!region || isProtectedContainer(region, false)) {
    return null;
  }
  return climbSingleChildWrappers(region, false);
}

function isReelsFeedRoute(url: Location): boolean {
  const ctx = pageContext(url);
  if (ctx.type === 'reel' || ctx.type === 'reels' || ctx.singlePost) {
    return false;
  }
  if (REELS_ROUTE_RE.test(url.pathname)) {
    return false;
  }
  return new URLSearchParams(url.search).get('sk') !== 'reels_tab';
}

interface HiddenEntry {
  readonly release: () => void;
  readonly sources: Set<Element>;
}

interface HiddenTracker {
  readonly has: (target: Element) => boolean;
  readonly linkSource: (source: Element, target: Element) => void;
  readonly hide: (source: Element, target: Element) => void;
  readonly releaseFor: (source: Element) => void;
}

function createHiddenTracker(scope: Scope): HiddenTracker {
  const hidden = new Map<Element, HiddenEntry>();
  const sourceTargets = new WeakMap<Element, Element>();
  scope.add(() => {
    hidden.clear();
  });

  const link = (source: Element, target: Element, entry: HiddenEntry): void => {
    const previous = sourceTargets.get(source);
    if (previous && previous !== target) {
      hidden.get(previous)?.sources.delete(source);
    }
    sourceTargets.set(source, target);
    entry.sources.add(source);
  };

  const releaseTarget = (target: Element, entry: HiddenEntry): void => {
    for (const source of entry.sources) {
      if (sourceTargets.get(source) === target) {
        sourceTargets.delete(source);
      }
    }
    entry.sources.clear();
    entry.release();
    hidden.delete(target);
  };

  return {
    has: (target) => hidden.has(target),
    linkSource(source, target) {
      const entry = hidden.get(target);
      if (entry) {
        link(source, target, entry);
      }
    },
    hide(source, target) {
      let entry = hidden.get(target);
      if (!entry) {
        entry = { release: hideElement(scope, target), sources: new Set() };
        hidden.set(target, entry);
      }
      link(source, target, entry);
    },
    releaseFor(source) {
      const target = sourceTargets.get(source);
      if (!target) {
        return;
      }
      sourceTargets.delete(source);
      const entry = hidden.get(target);
      if (!entry) {
        return;
      }
      entry.sources.delete(source);
      if (!target.isConnected || entry.sources.size === 0) {
        releaseTarget(target, entry);
      }
    },
  };
}

interface ShelfRule {
  readonly key: keyof typeof OPTIONS;
  readonly styleId: string;
  readonly zeroFlashCss: string;
  readonly matchesRoute: (url: Location) => boolean;
  readonly watchers: readonly {
    readonly spec: LocatorSpec;
    readonly resolve: (el: Element, tracker: HiddenTracker) => Element | null;
    readonly onHidden?: (target: Element, tracker: HiddenTracker) => void;
  }[];
}

/**
 * Independent, always-on Facebook feed shelf hiding (`Hide Reels bar` and
 * `Hide Stories bar`). Applies across every Facebook feed (Home, alternate
 * Feeds, Groups, Profiles) regardless of `Post filtering` scope, while leaving
 * the dedicated `/stories/` and `/reel(s)/` viewers, Reels tabs, and single
 * shared-reel posts untouched.
 */
export default defineFeature({
  id: 'hide_feed_shelves',
  options: OPTIONS,
  setup({ page, options, scope }) {
    const watchShelfRule = (rule: ShelfRule): void => {
      let ruleScope: Scope | undefined;
      options.watch(rule.key, (enabled) => {
        if (enabled && !ruleScope) {
          const next = scope.child();
          ruleScope = next;
          whileOnRoute(next, rule.matchesRoute, (routeScope) => {
            routeScope.add(addStyle(rule.styleId, rule.zeroFlashCss));
            const tracker = createHiddenTracker(routeScope);
            for (const watcher of rule.watchers) {
              routeScope.add(
                page.watch(page.locate(watcher.spec), {
                  added: (el) => {
                    const target = watcher.resolve(el, tracker);
                    if (target) {
                      tracker.hide(el, target);
                      watcher.onHidden?.(target, tracker);
                    }
                  },
                  removed: (el) => tracker.releaseFor(el),
                }),
              );
            }
          });
        } else if (!enabled && ruleScope) {
          ruleScope.dispose();
          ruleScope = undefined;
        }
      });
    };

    watchShelfRule({
      key: 'hide_stories_bar',
      styleId: STORIES_STYLE_ID,
      zeroFlashCss: STORIES_ZERO_FLASH_CSS,
      matchesRoute: (url) => pageContext(url).type !== 'stories',
      watchers: [{ spec: STORIES_BAR, resolve: (el) => resolveShelfContainer(el, 'stories') }],
    });

    watchShelfRule({
      key: 'hide_reels_bar',
      styleId: REELS_STYLE_ID,
      zeroFlashCss: REELS_ZERO_FLASH_CSS,
      matchesRoute: isReelsFeedRoute,
      watchers: [
        { spec: REELS_BAR, resolve: (el) => resolveShelfContainer(el, 'reels') },
        {
          spec: REELS_LINK,
          resolve: (link, tracker) => {
            const candidate = findInlineReelsCandidate(link);
            if (!candidate) {
              return null;
            }
            if (tracker.has(candidate)) {
              tracker.linkSource(link, candidate);
              return null;
            }
            return isReelsBarUnit(candidate) ? candidate : null;
          },
          onHidden: (target, tracker) => {
            // Link any earlier reel anchors that arrived before this shelf crossed the threshold.
            for (const link of target.querySelectorAll(REELS_LINK_SELECTOR)) {
              tracker.linkSource(link, target);
            }
          },
        },
      ],
    });
  },
});
