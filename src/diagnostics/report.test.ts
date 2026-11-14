import { describe, expect, it } from 'vitest';
import { ago, diagnosticsReport, reportedPageType, scrub } from './report';
import { diagnostics, locator, NOW, strategy } from './testing';

describe('diagnosticsReport', () => {
  it('holds the build, the page type, the features, the posts, the class names and the locators', () => {
    const report = diagnosticsReport(diagnostics());

    expect(report).toContain('Version 1.2.3, Chrome extension');
    expect(report).toContain('Page type: newsfeed');
    expect(report).toContain('Toolbar badge: 2');
    expect(report).toContain('  post_filters: running, 0 errors');
    expect(report).toContain(
      '16 posts on the page: 13 with an ID, 2 without one, 1 still being identified.',
    );
    expect(report).toContain('Feed slots with content not taken for posts: 0.');
    expect(report).toContain('Class names: 102 of 109 known. Missing: bb_bt2, font_bold.');
    expect(report).toContain('post (any): 30 lookups, 30 found');
    expect(report).toContain(
      '  div.S2F_reel | seen 2023 | waiting for a class | 30 lookups | 0 found | last found 4 s ago',
    );
    expect(report).toContain('post-reactions (any, never found): 30 lookups, 0 found');
    expect(report).toContain(
      '  form | seen 2026-11-13 | ready | 30 lookups | 0 found | last found never',
    );
  });

  it('says plainly that post detection has not started', () => {
    const report = diagnosticsReport(
      diagnostics({
        posts: {
          started: false,
          tracked: 0,
          withId: 0,
          withoutId: 0,
          identifying: 0,
          unrecognised: 0,
        },
      }),
    );

    expect(report).toContain('Post detection has not started');
    expect(report).not.toContain('0 posts on the page');
  });

  it('shows a failed feature with its last error, and an overridden locator', () => {
    const report = diagnosticsReport(
      diagnostics({
        badge: { count: 0, failed: true },
        features: [
          { id: 'post_filters', state: 'failed', errors: 10, lastError: 'no such element' },
        ],
        locators: [locator('post', { overridden: true, strategies: [strategy({ seen: null })] })],
      }),
    );

    expect(report).toContain('Toolbar badge: the failed mark (!)');
    expect(report).toContain('  post_filters: failed, 10 errors. Last error: no such element');
    expect(report).toContain('post (any, overridden)');
    expect(report).toContain('[role=article] | seen yours |');
  });

  it('holds nothing personal', () => {
    // A page whose type is a person's name, and an error that quotes an address and a user ID.
    const report = diagnosticsReport(
      diagnostics({
        pageType: 'jane.doe.42',
        features: [
          {
            id: 'post_filters',
            state: 'running',
            errors: 1,
            lastError:
              'could not read https://www.facebook.com/jane.doe.42/posts/123456789 for 100012345678901',
          },
        ],
      }),
    );

    expect(report).toContain('Page type: other');
    expect(report).toContain('Last error: could not read <address> for <number>');
    expect(report).not.toMatch(/jane|doe|facebook\.com|\d{6,}/i);
  });
});

describe('reportedPageType', () => {
  it('keeps the page types that cannot be a name', () => {
    expect(reportedPageType('groups')).toBe('groups');
    expect(reportedPageType('marketplace')).toBe('marketplace');
    expect(reportedPageType('zuck')).toBe('other');
  });
});

describe('scrub', () => {
  it('takes out web addresses and long numbers and leaves the rest', () => {
    expect(scrub("'div:not(' is not a valid selector")).toBe("'div:not(' is not a valid selector");
    expect(scrub('see blob:https://x.test/abc and 1234567')).toBe('see <address> and <number>');
    expect(scrub('no post at www.facebook.com/jane.doe')).toBe('no post at <address>');
    expect(scrub('no ID for pfbid02AbCdE9xYz')).toBe('no ID for <id>');
  });
});

describe('ago', () => {
  it('gives seconds, minutes or hours', () => {
    expect(ago(null, NOW)).toBe('never');
    expect(ago(NOW - 12_000, NOW)).toBe('12 s ago');
    expect(ago(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe('3 h ago');
  });
});
