import { describe, expect, it } from 'vitest';
import type { Filter } from '../../core/filter-types';
import { FACEBOOK_FILTER_SCHEMA } from '../../features/post-filters/schema';
import { GMAIL_FILTER_SCHEMA } from '../../sites/gmail/filter-schema';
import { INSTAGRAM_FILTER_SCHEMA } from '../../sites/instagram/filter-schema';
import { X_FILTER_SCHEMA } from '../../sites/x/filter-schema';
import { HIGHLIGHT_CSS } from './schema';
import {
  commitPendingText,
  createQuickHideFilter,
  detectSmartTarget,
  extractSimpleChips,
  isSimpleCompatible,
  newSimpleFilter,
  withSimpleChips,
} from './simple-model';
import { displayFilterTitle, summarizeFilter } from './summary';

describe('simple-model', () => {
  it('accepts simple single- and multi-chip filters and rejects every advanced feature losslessly', () => {
    const simple = withSimpleChips(newSimpleFilter(FACEBOOK_FILTER_SCHEMA), 'any', [
      'crypto',
      'giveaway',
    ]);
    expect(isSimpleCompatible(simple, FACEBOOK_FILTER_SCHEMA).ok).toBe(true);
    expect(simple.match).toBe('ANY');
    expect(simple.rules).toHaveLength(2);
    expect(simple.actions).toEqual([{ action: 'hide', show_note: true }]);

    // Rejects ALL (AND) with >1 rules
    expect(isSimpleCompatible({ ...simple, match: 'ALL' }, FACEBOOK_FILTER_SCHEMA).ok).toBe(false);

    // Rejects regex matcher (or legacy omitted matcher)
    const legacyRegex: Filter = {
      ...simple,
      rules: [{ target: 'any', operator: 'contains', condition: { text: 'foo|bar' } }],
    };
    expect(isSimpleCompatible(legacyRegex, FACEBOOK_FILTER_SCHEMA).ok).toBe(false);

    // Rejects negated rule (both modern `not: true` and legacy `not_contains` prefix)
    const negated: Filter = {
      ...simple,
      rules: [
        {
          target: 'any',
          operator: 'contains',
          not: true,
          matcher: 'str',
          match_partial_words: true,
          condition: { text: 'crypto', modifier: 'i' },
        },
      ],
    };
    expect(isSimpleCompatible(negated, FACEBOOK_FILTER_SCHEMA).ok).toBe(false);
    expect(
      isSimpleCompatible(
        {
          ...simple,
          rules: [
            {
              target: 'any',
              operator: 'not_contains',
              matcher: 'str',
              match_partial_words: true,
              condition: { text: 'crypto', modifier: 'i' },
            },
          ],
        },
        FACEBOOK_FILTER_SCHEMA,
      ).ok,
    ).toBe(false);

    // Rejects case-sensitive and whole-word-only
    const caseSensitive: Filter = {
      ...simple,
      rules: [
        {
          target: 'any',
          operator: 'contains',
          matcher: 'str',
          match_partial_words: true,
          condition: { text: 'NFT', modifier: 'I' },
        },
      ],
    };
    expect(isSimpleCompatible(caseSensitive, FACEBOOK_FILTER_SCHEMA).ok).toBe(false);

    // Rejects custom CSS, empty CSS, & selectors; accepts built-in Highlight presets
    const presetHighlight: Filter = {
      ...simple,
      actions: [{ action: 'css', content: HIGHLIGHT_CSS.gold }],
    };
    expect(isSimpleCompatible(presetHighlight, FACEBOOK_FILTER_SCHEMA).ok).toBe(true);
    expect(
      isSimpleCompatible(
        { ...simple, actions: [{ action: 'css', content: 'border: 1px solid red;' }] },
        FACEBOOK_FILTER_SCHEMA,
      ).ok,
    ).toBe(false);
    expect(
      isSimpleCompatible({ ...simple, actions: [{ action: 'css' }] }, FACEBOOK_FILTER_SCHEMA).ok,
    ).toBe(false);
    expect(isSimpleCompatible({ ...simple, actions: [] }, FACEBOOK_FILTER_SCHEMA)).toEqual({
      ok: false,
      reason: 'Has no actions',
    });

    // Accepts unhide with stop_on_match: true, rejects hide with stop_on_match: true
    expect(
      isSimpleCompatible(
        { ...simple, stop_on_match: true, actions: [{ action: 'unhide' }] },
        FACEBOOK_FILTER_SCHEMA,
      ).ok,
    ).toBe(true);
    expect(isSimpleCompatible({ ...simple, stop_on_match: true }, FACEBOOK_FILTER_SCHEMA).ok).toBe(
      false,
    );
  });

  it('commits comma-separated pending text deduplicating case-insensitively', () => {
    const base = withSimpleChips(newSimpleFilter(X_FILTER_SCHEMA), 'any', ['crypto']);
    const updated = commitPendingText(base, 'CRYPTO, giveaway, C++', 'any');
    expect(extractSimpleChips(updated)).toEqual(['crypto', 'giveaway', 'C++']);
  });

  it('creates smart Quick Hide filters across Facebook, X, Instagram, and Gmail', () => {
    const fbTag = createQuickHideFilter('#spoilers', FACEBOOK_FILTER_SCHEMA);
    expect(fbTag?.rules?.[0]).toMatchObject({
      target: 'hashtag',
      matcher: 'str',
      condition: { text: 'spoilers', modifier: 'i' },
    });
    expect(fbTag?.actions).toEqual([{ action: 'hide', show_note: true }]);

    const xTag = createQuickHideFilter('#airdrop', X_FILTER_SCHEMA);
    expect(xTag?.rules?.[0]).toMatchObject({
      target: 'hashtag',
      condition: { text: '#airdrop' },
    });

    // Instagram strips `@` from author handles; X retains `@`.
    const igAuthor = createQuickHideFilter('@barista_daily', INSTAGRAM_FILTER_SCHEMA);
    expect(igAuthor?.rules?.[0]).toMatchObject({
      target: 'author',
      condition: { text: 'barista_daily' },
    });
    const xAuthor = createQuickHideFilter('@alexdev', X_FILTER_SCHEMA);
    expect(xAuthor?.rules?.[0]).toMatchObject({
      target: 'author',
      condition: { text: '@alexdev' },
    });

    // URL routes to link_url where available; empty / bare prefix returns null.
    expect(
      createQuickHideFilter('https://tiktok.com', FACEBOOK_FILTER_SCHEMA)?.rules?.[0],
    ).toMatchObject({
      target: 'link_url',
      condition: { text: 'https://tiktok.com' },
    });
    expect(createQuickHideFilter(' , , ', FACEBOOK_FILTER_SCHEMA)).toBeNull();
    expect(createQuickHideFilter('#', FACEBOOK_FILTER_SCHEMA)).toBeNull();
    expect(createQuickHideFilter('@', INSTAGRAM_FILTER_SCHEMA)).toBeNull();

    const gmailMulti = createQuickHideFilter('sale, promo', GMAIL_FILTER_SCHEMA);
    expect(extractSimpleChips(gmailMulti!)).toEqual(['sale', 'promo']);
    expect(gmailMulti?.rules?.[0]?.target).toBe('any');
  });

  it('detects smart target nudges only when currently matching any', () => {
    expect(detectSmartTarget('#election', 'any', FACEBOOK_FILTER_SCHEMA)).toEqual({
      targetId: 'hashtag',
      label: 'Hashtag',
    });
    expect(detectSmartTarget('@promo', 'any', X_FILTER_SCHEMA)).toEqual({
      targetId: 'author',
      label: '@Handle',
    });
    expect(detectSmartTarget('https://tiktok.com', 'any', FACEBOOK_FILTER_SCHEMA)).toEqual({
      targetId: 'link_url',
      label: 'Link',
    });
    expect(detectSmartTarget('#election', 'author', FACEBOOK_FILTER_SCHEMA)).toBeNull();
  });

  it('collapses shared-target OR chip filters cleanly in displayFilterTitle and summarizeFilter', () => {
    const multi = withSimpleChips(newSimpleFilter(FACEBOOK_FILTER_SCHEMA), 'any', [
      'crypto',
      'giveaway',
      'nft',
    ]);
    expect(displayFilterTitle(multi, FACEBOOK_FILTER_SCHEMA)).toBe('Hide "crypto, giveaway +1"');
    expect(summarizeFilter(multi, FACEBOOK_FILTER_SCHEMA).line).toBe(
      'Hide post (with note) when Any post content contains "crypto" or "giveaway" or "nft"',
    );
  });
});
