import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSiteEnabledHint, writeSiteEnabledHint } from './site-hint';

describe('core/site-hint', () => {
  afterEach(() => {
    try {
      globalThis.localStorage.clear();
    } catch {
      // ignore
    }
    vi.restoreAllMocks();
  });

  it('returns fallback when unset, persists enabled state, and updates live', () => {
    expect(readSiteEnabledHint('reddit', false)).toBe(false);
    expect(readSiteEnabledHint('facebook', true)).toBe(true);

    writeSiteEnabledHint('reddit', true);
    expect(readSiteEnabledHint('reddit', false)).toBe(true);

    writeSiteEnabledHint('reddit', false);
    expect(readSiteEnabledHint('reddit', true)).toBe(false);
  });

  it('falls back safely when localStorage throws', () => {
    const getSpy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readSiteEnabledHint('instagram', false)).toBe(false);
    expect(() => writeSiteEnabledHint('instagram', true)).not.toThrow();
    expect(getSpy).toHaveBeenCalled();

    getSpy.mockReturnValue(null);
    const setSpy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => writeSiteEnabledHint('instagram', true)).not.toThrow();
    expect(setSpy).toHaveBeenCalled();
  });
});
