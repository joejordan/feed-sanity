import type { PageBridge } from '../core/bridge';
import type { Locate } from '../core/locator';
import { isRecord } from '../core/storage';
import { SET_HOME_FEED } from './page-actions';
import { HOME_LEFT_RAIL, HOME_RIGHT_RAIL } from './page-mounts';
import { FEEDS_LEFT_RAIL, OWN, TOP_BAR_BANNER } from './selectors';

export interface SetHomeFeedResult {
  readonly applied: boolean;
  readonly refreshed: boolean;
}

/** Checks the untrusted answer from the `set-home-feed` page-world action. */
export function checkSetHomeFeed(answer: unknown): SetHomeFeedResult {
  if (!isRecord(answer)) {
    return { applied: false, refreshed: false };
  }
  return {
    applied: answer.applied === true,
    refreshed: answer.refreshed === true,
  };
}

/** Configures Facebook's Home feed variables in place and optionally triggers a Relay refetch. */
export async function setHomeFeed(
  bridge: Pick<PageBridge, 'run'>,
  feedStyle: number | null,
  refresh = false,
  signal?: AbortSignal,
): Promise<SetHomeFeedResult> {
  const answer = await bridge.run(SET_HOME_FEED, { feedStyle, refresh }, signal);
  return checkSetHomeFeed(answer);
}

/** Mounts Facebook's native Home left rail inside `target`. */
export function mountHomeLeftRail(
  bridge: Pick<PageBridge, 'mount'>,
  target: Element,
  signal?: AbortSignal,
): Promise<(() => void) | null> {
  return bridge.mount(target, HOME_LEFT_RAIL, {}, signal);
}

/** Mounts Facebook's native Home right rail inside `target`. */
export function mountHomeRightRail(
  bridge: Pick<PageBridge, 'mount'>,
  target: Element,
  signal?: AbortSignal,
): Promise<(() => void) | null> {
  return bridge.mount(target, HOME_RIGHT_RAIL, {}, signal);
}

/** Finds Facebook's fixed Feeds left-rail navigation sibling next to `[role=main]`. */
export function findFeedsLeftRail(main: Element, locate: Locate): Element | null {
  const parent = main.parentElement;
  if (!parent) {
    return null;
  }
  const nav = locate(FEEDS_LEFT_RAIL);
  const banner = locate(TOP_BAR_BANNER);
  for (const sibling of parent.children) {
    if (
      sibling !== main &&
      !sibling.hasAttribute(OWN) &&
      nav.matches(sibling) &&
      banner.closest(sibling) === null
    ) {
      return sibling;
    }
  }
  return null;
}
