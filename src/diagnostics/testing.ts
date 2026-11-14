// Helpers for tests. Nothing in the extension imports this file.

import type { LocatorStats, StrategyStats } from '../core/locator';
import type { Diagnostics } from './collect';

export const NOW = Date.UTC(2026, 10, 14, 12);

export const strategy = (changes: Partial<StrategyStats> = {}): StrategyStats => ({
  selector: '[role=article]',
  seen: '2026-11-13',
  state: 'ready',
  lookups: 30,
  found: 30,
  lastFound: NOW - 4000,
  errors: 0,
  ...changes,
});

export const locator = (name: string, changes: Partial<LocatorStats> = {}): LocatorStats => ({
  name,
  mode: 'any',
  overridden: false,
  lookups: 30,
  found: 30,
  strategies: [strategy()],
  ...changes,
});

/** Diagnostics of a page where everything works. */
export const diagnostics = (changes: Partial<Diagnostics> = {}): Diagnostics => ({
  version: '1.2.3',
  build: 'Chrome extension',
  pageType: 'newsfeed',
  badge: { count: 2, failed: false },
  features: [
    { id: 'external_css', state: 'off', errors: 0, lastError: null },
    { id: 'post_filters', state: 'running', errors: 0, lastError: null },
  ],
  posts: {
    started: true,
    tracked: 16,
    withId: 13,
    withoutId: 2,
    identifying: 1,
    unrecognised: 0,
  },
  classNames: { started: true, known: 102, total: 109, missing: ['bb_bt2', 'font_bold'] },
  locators: [
    locator('post', {
      strategies: [
        strategy({ selector: '[role=article]:not(.S2F_pos_rel)', seen: '2023' }),
        strategy({ selector: '[aria-posinset]', note: 'News feed posts' }),
        strategy({ selector: 'div.S2F_reel', seen: '2023', state: 'waiting', found: 0 }),
      ],
    }),
    locator('post-reactions', {
      found: 0,
      strategies: [strategy({ selector: 'form', found: 0, lastFound: null })],
    }),
  ],
  at: NOW,
  ...changes,
});
