import type { LocatorStats, StrategyState } from '../core/locator';
import type { Badge } from '../core/platform';
import type { ClassNameStats } from '../facebook/atoms';
import type { PostStats } from '../facebook/posts';
import type { Diagnostics } from './collect';
import { NAME } from '../../project';
import { mayBeName } from '../facebook/page';

/** A locator looked up this many times without finding anything is worth a look. */
export const NEVER_FOUND_AFTER = 20;

export const STRATEGY_STATES: Record<StrategyState, string> = {
  ready: 'ready',
  waiting: 'waiting for a class',
  invalid: 'invalid',
};

/** The page type as a report gives it: `other` for a type that may be a name. */
export const reportedPageType = (type: string): string => (mayBeName(type) ? 'other' : type);

/**
 * An error message with web addresses, Facebook addresses written without
 * `https://`, `pfbid` post IDs and long numbers taken out. Errors come from
 * feature code, and a user ID or a post's address could end up in one.
 */
export const scrub = (message: string): string =>
  message
    .replaceAll(
      /\b(?:[a-z][a-z0-9+.-]*:)+\/\/\S+|\S*\b(?:facebook|messenger)\.com\S*/gi,
      '<address>',
    )
    .replaceAll(/\bpfbid\w+/g, '<id>')
    .replaceAll(/\d{6,}/g, '<number>');

/** True for a locator that has been looked up many times and never found anything. */
export const neverFound = (locator: LocatorStats): boolean =>
  locator.lookups >= NEVER_FOUND_AFTER && locator.found === 0;

/** How long ago `time` was, as `4 s ago`, or `never` for null. */
export function ago(time: number | null, now: number): string {
  if (time === null) {
    return 'never';
  }
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) {
    return `${seconds} s ago`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** What the toolbar badge shows, in words. */
export function badgeSummary({ count, failed }: Badge): string {
  if (failed) {
    return 'the failed mark (!)';
  }
  return count > 0 ? String(count) : 'nothing';
}

export const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** The post counts in one sentence. */
export function postSummary({ tracked, withId, withoutId, identifying }: PostStats): string {
  return `${plural(tracked, 'post', 'posts')} on the page: ${withId} with an ID, ${withoutId} without one, ${identifying} still being identified.`;
}

export const slotSummary = ({ unrecognised }: PostStats): string =>
  `Feed slots with content not taken for posts: ${unrecognised}.`;

/** How many class names are known, as `102 of 109 known`. */
export const classNamesSummary = ({ started, known, total }: ClassNameStats): string =>
  started ? `${known} of ${total} known` : 'not looked for yet';

export const NOT_STARTED =
  'Post detection has not started, because no feature that is on needs posts. Post filters start it once a keyword or a filter is set up.';

function locatorLines(locator: LocatorStats, now: number): string[] {
  const flags = [
    locator.mode,
    ...(locator.overridden ? ['overridden'] : []),
    ...(neverFound(locator) ? ['never found'] : []),
  ];
  return [
    `${locator.name} (${flags.join(', ')}): ${plural(locator.lookups, 'lookup', 'lookups')}, ${locator.found} found`,
    ...locator.strategies.map(
      (strategy) =>
        `  ${strategy.selector} | seen ${strategy.seen ?? 'yours'} | ${STRATEGY_STATES[strategy.state]} | ${strategy.lookups} lookups | ${strategy.found} found | last found ${ago(strategy.lastFound, now)}`,
    ),
  ];
}

/**
 * The diagnostics as text, for the user to paste into a bug report. It holds
 * nothing personal: no user ID, post text, names or page addresses. The page
 * type is left out when it may be a name, and error messages lose their
 * addresses and long numbers.
 */
export function diagnosticsReport(diagnostics: Diagnostics): string {
  const { version, build, pageType, badge, features, posts, classNames, locators, at } =
    diagnostics;
  const missing =
    classNames.started && classNames.missing.length > 0
      ? ` Missing: ${classNames.missing.join(', ')}.`
      : '';
  return [
    `${NAME} diagnostics`,
    `Version ${version}, ${build}`,
    `Page type: ${reportedPageType(pageType)}`,
    `Toolbar badge: ${badgeSummary(badge)}`,
    '',
    'Features',
    ...features.map(
      ({ id, state, errors, lastError }) =>
        `  ${id}: ${state}, ${plural(errors, 'error', 'errors')}${lastError === null ? '' : `. Last error: ${scrub(lastError)}`}`,
    ),
    '',
    'Posts',
    ...(posts.started
      ? [`  ${postSummary(posts)}`, `  ${slotSummary(posts)}`]
      : [`  ${NOT_STARTED}`]),
    '',
    `Class names: ${classNamesSummary(classNames)}.${missing}`,
    '',
    'Locators',
    ...locators.flatMap((locator) => locatorLines(locator, at)),
    '',
  ].join('\n');
}
