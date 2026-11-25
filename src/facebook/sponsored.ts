import type { PageBridge } from '../core/bridge';
import { isRecord } from '../core/storage';
import { POST_SPONSORED, RIGHT_RAIL_SPONSORED } from './react-readers';

/**
 * Checks what the page-world reader sent back: true or false for a post
 * whose feed unit was found, and null for anything else, which is how the
 * reader says it found none. The page can send the same events, so nothing
 * else in the answer is used.
 */
export function checkSponsored(answer: unknown): boolean | null {
  return isRecord(answer) && typeof answer.sponsored === 'boolean' ? answer.sponsored : null;
}

/**
 * Asks the page-world side whether the feed post `element` is an ad.
 * Resolves null when it found no feed unit for it, and rejects with the
 * bridge's `BridgeError` when it could not be asked.
 */
export async function postSponsored(
  bridge: Pick<PageBridge, 'ask'>,
  element: Element,
  signal?: AbortSignal,
): Promise<boolean | null> {
  return checkSponsored(await bridge.ask(element, POST_SPONSORED, signal));
}

/** Whether a Right Rail unit element is a Sponsored ad unit, checked from React fibers. */
export async function rightRailSponsored(
  bridge: Pick<PageBridge, 'ask'>,
  element: Element,
  signal?: AbortSignal,
): Promise<boolean | null> {
  return checkSponsored(await bridge.ask(element, RIGHT_RAIL_SPONSORED, signal));
}

/**
 * Descends single-child wrapper nodes inside Facebook's `[data-pagelet=RightRail]`
 * to the first multi-child card list container (Sponsored, Birthdays, Contacts, etc.).
 * Returns `null` while only outer placeholder wrappers are present so the entire
 * rail wrapper is never mistaken for a single Sponsored unit or heading.
 */
function rightRailListContainer(rail: Element): Element | null {
  let container: Element = rail;
  for (let depth = 0; depth < 6 && container.childElementCount === 1; depth++) {
    const only = container.firstElementChild;
    if (!only) {
      break;
    }
    container = only;
  }
  return container.childElementCount >= 2 ? container : null;
}

/** Finds the individual card elements inside Facebook's `[data-pagelet=RightRail]`. */
export function rightRailUnits(rail: Element): Element[] {
  const container = rightRailListContainer(rail);
  return container ? [...container.children] : [];
}

const MAX_HEADING_CLIMB = 5;
const INTERACTIVE_OR_ROW_SELECTOR = 'a, button, [role="button"], [role="listitem"]';

/**
 * Finds standalone "Sponsored" heading blocks inside Facebook's Right Rail
 * (such as the section header left floating above hidden right-rail ad units).
 * Never climbs into or above the multi-child card-list container, never climbs
 * through multi-child wrappers (which may hold empty Suspense placeholders),
 * and skips labels inside interactive elements or contact/list rows.
 */
export function rightRailSponsoredHeadings(rail: Element, skip?: WeakSet<Element>): Element[] {
  const container = rightRailListContainer(rail);
  if (!container) {
    return [];
  }
  const results = new Set<Element>();
  for (const el of container.querySelectorAll('h2, h3, h4, span')) {
    if (
      el.childElementCount > 0 ||
      skip?.has(el) ||
      el.closest(INTERACTIVE_OR_ROW_SELECTOR) !== null
    ) {
      continue;
    }
    const raw = el.textContent;
    if (!raw || raw.length < 9 || raw.trim().toLowerCase() !== 'sponsored') {
      continue;
    }
    let target: Element = el;
    let alreadySkipped = false;
    for (let step = 0; step < MAX_HEADING_CLIMB; step++) {
      const parent = target.parentElement;
      if (
        !parent ||
        parent === container ||
        parent === rail ||
        parent.childElementCount > 1 ||
        parent.textContent?.trim().toLowerCase() !== 'sponsored' ||
        parent.querySelector('img, video, a') !== null
      ) {
        break;
      }
      target = parent;
      if (skip?.has(target)) {
        alreadySkipped = true;
        break;
      }
    }
    if (!alreadySkipped) {
      results.add(target);
    }
  }
  return [...results];
}
