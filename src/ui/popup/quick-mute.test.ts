import { describe, expect, it } from 'vitest';
import { runFilters } from '../../core/filter-engine';
import { isRunnable } from '../../core/filter-types';
import { createQuickMuteFilter } from './starter-modes';

describe('createQuickMuteFilter', () => {
  it('builds a runnable case-insensitive contains filter on text with a hide note', () => {
    const filter = createQuickMuteFilter('  Spoilers ', 'x');
    expect(filter).toMatchObject({
      name: 'Mute “Spoilers”',
      enabled: true,
      join: 'any',
      conditions: [{ kind: 'text', part: 'text', test: 'contains', values: ['Spoilers'] }],
      actions: [{ kind: 'hide', note: true, noteText: 'Muted “{match}”' }],
    });
    expect(filter && isRunnable(filter)).toBe(true);
    const outcome = runFilters(filter ? [filter] : [], {
      fields: { get: (name) => (name === 'text' ? 'big SPOILERS ahead' : null) },
    });
    expect(outcome.hiding?.label).toBe('Muted “SPOILERS”');
  });

  it('returns null for blank terms and unsupported sites', () => {
    expect(createQuickMuteFilter(' , ', 'x')).toBeNull();
    expect(createQuickMuteFilter('cats', 'myspace')).toBeNull();
  });

  it('routes smart terms to the shared part names', () => {
    const partOf = (term: string, site: string) => {
      const condition = createQuickMuteFilter(term, site)?.conditions[0];
      return condition?.kind === 'text' ? [condition.part, condition.values] : null;
    };
    expect(partOf('#news', 'x')).toEqual(['hashtags', ['news']]);
    expect(partOf('@spammer', 'instagram')).toEqual(['author', ['spammer']]);
    expect(partOf('@spammer', 'x')).toEqual(['author', ['@spammer']]);
    expect(partOf('@boss', 'gmail')).toEqual(['sender', ['@boss']]);
    expect(partOf('example.com/page', 'facebook')).toEqual(['link_urls', ['example.com/page']]);
    expect(partOf('https://www.youtube.com/watch?v=1', 'reddit')).toEqual([
      'domain',
      ['youtube.com'],
    ]);
    expect(partOf('r/memes', 'reddit')).toEqual(['subreddit', ['r/memes']]);
    expect(partOf('cats, Dogs, cats', 'x')).toEqual(['text', ['cats', 'Dogs']]);
  });
});
