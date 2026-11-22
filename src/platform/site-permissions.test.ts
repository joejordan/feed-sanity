import { describe, expect, it, vi } from 'vitest';
import { matchesOriginPattern, optionalSiteForUrl } from '../sites/manifest';
import { OPEN_OPTIONS, SITE_PERMISSIONS_GET, sitePermissionRevokeMessage } from './messages';
import {
  enableSiteForTab,
  revokeSitePermission,
  sitePermissionsListener,
  syncOptionalSiteScripts,
} from './site-permissions';

describe('site permissions and runtime script registration', () => {
  it('matches origin patterns and respects excludeMatches in optionalSiteForUrl', () => {
    expect(
      matchesOriginPattern('https://www.instagram.com/reels/', 'https://www.instagram.com/*'),
    ).toBe(true);
    expect(matchesOriginPattern('https://www.facebook.com/', 'https://www.instagram.com/*')).toBe(
      false,
    );
    expect(matchesOriginPattern('http://www.instagram.com/', 'https://www.instagram.com/*')).toBe(
      false,
    );
    expect(optionalSiteForUrl('https://www.instagram.com/?variant=following')?.id).toBe(
      'instagram',
    );
    expect(optionalSiteForUrl('https://www.facebook.com/')).toBeUndefined();
    // Excluded authentication and API paths must never trigger toolbar injection.
    expect(optionalSiteForUrl('https://www.instagram.com/accounts/login/')).toBeUndefined();
    expect(optionalSiteForUrl('https://www.instagram.com/api/v1/feed/timeline/')).toBeUndefined();
    expect(optionalSiteForUrl('https://www.instagram.com/graphql/query')).toBeUndefined();
  });

  it('registers full MV3 script specs and serializes overlapping syncs across permission flips', async () => {
    let granted = true;
    let releaseFirstContains!: () => void;
    let containsCalls = 0;
    const registered = new Map<string, Record<string, unknown>>();
    const host = {
      permissions: {
        contains: vi.fn(async () => {
          containsCalls++;
          if (containsCalls === 1) {
            await new Promise<void>((resolve) => {
              releaseFirstContains = resolve;
            });
          }
          return granted;
        }),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => {
          granted = false;
          return true;
        }),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () =>
          [...registered.keys()].map((id) => ({ id })),
        ),
        registerContentScripts: vi.fn(async (scripts: Array<{ id: string }>) => {
          for (const script of scripts) {
            registered.set(script.id, script);
          }
        }),
        unregisterContentScripts: vi.fn(async (filter?: { ids?: string[] }) => {
          for (const id of filter?.ids ?? []) {
            registered.delete(id);
          }
        }),
        executeScript: vi.fn(async () => []),
      },
    };

    // Start two overlapping syncs while permission flips to false mid-flight.
    const first = syncOptionalSiteScripts(host);
    await vi.waitFor(() => expect(releaseFirstContains).toBeTypeOf('function'));
    granted = false;
    const second = syncOptionalSiteScripts(host);
    releaseFirstContains();
    await Promise.all([first, second]);

    // The serialized rerun sees `granted === false` and leaves zero scripts registered.
    expect(registered.size).toBe(0);

    // Granting again registers both scripts with full match/exclude/world metadata.
    granted = true;
    await syncOptionalSiteScripts(host);
    expect([...registered.keys()].sort()).toEqual([
      'feed-sanity-instagram-content',
      'feed-sanity-instagram-page-world',
    ]);
    expect(registered.get('feed-sanity-instagram-page-world')).toMatchObject({
      matches: ['https://www.instagram.com/*'],
      excludeMatches: [
        'https://www.instagram.com/accounts/login*',
        'https://www.instagram.com/api/*',
        'https://www.instagram.com/graphql/*',
      ],
      js: ['instagram-page-world.js'],
      runAt: 'document_start',
      world: 'MAIN',
    });
    expect(registered.get('feed-sanity-instagram-content')).toMatchObject({
      js: ['instagram.js'],
      runAt: 'document_start',
      world: 'ISOLATED',
    });
  });

  it('requests permission, avoids double injection when already running, and handles denial', async () => {
    const instagram = optionalSiteForUrl('https://www.instagram.com/')!;
    let granted = false;
    let tabReady = false;
    const executed: Array<{ files: string[]; world?: string }> = [];
    const sentMessages: unknown[] = [];

    const host = {
      permissions: {
        contains: vi.fn(async () => granted),
        request: vi.fn(async () => {
          granted = true;
          return true;
        }),
        remove: vi.fn(async () => true),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
        executeScript: vi.fn(async (inj: { files: string[]; world?: string }) => {
          executed.push({ files: inj.files, ...(inj.world ? { world: inj.world } : {}) });
          tabReady = true;
          return [];
        }),
      },
      tabs: {
        sendMessage: vi.fn(async (_tabId: number, msg: unknown) => {
          if (!tabReady) {
            throw new Error('Receiving end does not exist');
          }
          sentMessages.push(msg);
        }),
      },
    };

    // First click on an uninjected tab injects MAIN + ISOLATED scripts and opens Options.
    expect(await enableSiteForTab(host, instagram, 42)).toBe(true);
    expect(executed).toEqual([
      { files: ['instagram-page-world.js'], world: 'MAIN' },
      { files: ['instagram.js'], world: 'ISOLATED' },
    ]);
    expect(sentMessages).toEqual([OPEN_OPTIONS]);

    // Second click when already running opens Options directly without re-injecting.
    expect(await enableSiteForTab(host, instagram, 42)).toBe(true);
    expect(executed).toHaveLength(2);
    expect(sentMessages).toEqual([OPEN_OPTIONS, OPEN_OPTIONS]);

    // Denied permission returns false and skips registration/injection.
    const deniedHost = {
      permissions: {
        contains: vi.fn(async () => false),
        request: vi.fn(async () => false),
        remove: vi.fn(async () => false),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
        executeScript: vi.fn(async () => []),
      },
    };
    expect(await enableSiteForTab(deniedHost, instagram, 7)).toBe(false);
    expect(deniedHost.scripting.registerContentScripts).not.toHaveBeenCalled();
    expect(deniedHost.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('supports MV2 contentScripts fallback and ignores revoking required or unknown sites', async () => {
    let granted = true;
    const unregister = vi.fn(async () => undefined);
    const register = vi.fn(async () => ({ unregister }));
    const host = {
      permissions: {
        contains: vi.fn(async () => granted),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => {
          granted = false;
          return true;
        }),
      },
      contentScripts: { register },
    };

    await syncOptionalSiteScripts(host);
    await syncOptionalSiteScripts(host);
    expect(register).toHaveBeenCalledTimes(1);

    // Required and unknown sites cannot be revoked.
    expect(await revokeSitePermission(host, 'facebook')).toBe(false);
    expect(await revokeSitePermission(host, 'nonexistent')).toBe(false);
    expect(host.permissions.remove).not.toHaveBeenCalled();

    expect(await revokeSitePermission(host, 'instagram')).toBe(true);
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('answers runtime messages using Chrome MV3 sendResponse + return true contract', async () => {
    let granted = true;
    const host = {
      permissions: {
        contains: vi.fn(async () => granted),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => {
          granted = false;
          return true;
        }),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
        executeScript: vi.fn(async () => []),
      },
    };
    const listener = sitePermissionsListener(host);

    const getRes = await new Promise<Array<{ id: string; enabled: boolean }>>((resolve) => {
      const keepOpen = listener(SITE_PERMISSIONS_GET, {}, (res) =>
        resolve(res as Array<{ id: string; enabled: boolean }>),
      );
      expect(keepOpen).toBe(true);
    });
    expect(getRes.find((s) => s.id === 'facebook')?.enabled).toBe(true);
    expect(getRes.find((s) => s.id === 'instagram')?.enabled).toBe(true);

    const revokeRes = await new Promise<Array<{ id: string; enabled: boolean }>>((resolve) => {
      const keepOpen = listener(sitePermissionRevokeMessage('instagram'), {}, (res) =>
        resolve(res as Array<{ id: string; enabled: boolean }>),
      );
      expect(keepOpen).toBe(true);
    });
    expect(revokeRes.find((s) => s.id === 'instagram')?.enabled).toBe(false);
    expect(listener('unrelated', {}, vi.fn())).toBeUndefined();
  });
});
