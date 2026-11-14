import { describe, expect, it, vi } from 'vitest';
import { userscriptPlatform } from './userscript';

describe('userscriptPlatform', () => {
  it('calls itself the userscript', () => {
    expect(userscriptPlatform.build).toBe('userscript');
  });

  it('has no badge to set, and does not complain about it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => userscriptPlatform.setBadge({ count: 3, failed: true })).not.toThrow();

    expect(error).not.toHaveBeenCalled();
  });
});
