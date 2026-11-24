import { describe, expect, it } from 'vitest';
import { siteStoragePrefix } from './site-storage';

describe('site-storage', () => {
  it('builds canonical site- and account-namespaced storage prefixes', () => {
    expect(siteStoragePrefix('facebook', '100000000000042')).toBe('v2/facebook/100000000000042');
    expect(siteStoragePrefix('instagram', '12345')).toBe('v2/instagram/12345');
  });
});
