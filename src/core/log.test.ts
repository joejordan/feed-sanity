import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, isContextInvalidatedError } from './log';

describe('core/log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes extension context invalidation errors and downgrades them from console.error to console.debug', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const log = createLogger('home_feed');

    const invalidated = new Error('Extension context invalidated.');
    expect(isContextInvalidatedError(invalidated)).toBe(true);
    expect(isContextInvalidatedError('Error: Extension context invalidated')).toBe(true);
    expect(isContextInvalidatedError(new Error('Quota exceeded'))).toBe(false);

    log.error('could not save the feed', invalidated);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      '[feed-sanity:home_feed]',
      'could not save the feed',
      invalidated,
    );

    const realError = new Error('Quota exceeded');
    log.error('could not save the feed', realError);
    expect(errorSpy).toHaveBeenCalledWith(
      '[feed-sanity:home_feed]',
      'could not save the feed',
      realError,
    );
  });
});
