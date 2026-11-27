import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenPostComposerAction, createSetHomeFeedAction } from './page-actions';
import { checkComposerInfo, checkOpenComposer } from './post-composer';

describe('createOpenPostComposerAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div role="main"><div role="feed"></div></div>';
  });

  it('pushes a launcher into CometDialogContext and invokes useFeedComposerCometDialog for each mode', () => {
    const dialogContext = { Provider: Symbol('CometDialogContext.Provider') };
    const show = vi.fn();
    const useFeedComposer = vi.fn(() => [show, vi.fn(), vi.fn(), vi.fn(), vi.fn()]);
    const pushDialog = vi.fn((Component: (props: Record<string, unknown>) => unknown) => {
      Component({ onClose: vi.fn() });
    });

    const main = document.querySelector('[role=main]') as HTMLElement;
    Object.assign(main, {
      '__reactFiber$test': {
        type: 'div',
        memoizedProps: {},
        return: {
          type: dialogContext.Provider,
          memoizedProps: { value: pushDialog },
          return: null,
        },
      },
    });

    const loader = {
      require: (name: string) => {
        switch (name) {
          case 'react':
            return { useEffect: (effect: () => void) => effect() };
          case 'CometDialogContext':
            return dialogContext;
          case 'CurrentUserInitialData':
            return { USER_ID: '100012345678901', SHORT_NAME: 'Alex' };
          case 'useFeedComposerCometDialog':
            return { default: useFeedComposer };
          default:
            return;
        }
      },
    };

    const action = createOpenPostComposerAction(loader);

    expect(action({ mode: 'post' })).toEqual({ opened: true });
    expect(useFeedComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        composerEntryPointName: 'inline_composer',
        composerSourceSurface: 'newsfeed',
        composerType: 'feed',
        profileID: '100012345678901',
      }),
    );
    expect(show).toHaveBeenLastCalledWith({});

    expect(action({ mode: 'media' })).toEqual({ opened: true });
    expect(show).toHaveBeenLastCalledWith({ additionalMediaAttachmentItems: [] });

    expect(action({ mode: 'feeling' })).toEqual({ opened: true });
    expect(show).toHaveBeenLastCalledWith({ pushedPageOnLoad: 'feeling' });
  });

  it('returns opened: false cleanly when Facebook modules or context are unavailable', () => {
    const action = createOpenPostComposerAction({});
    expect(action({ mode: 'post' })).toEqual({ opened: false });
  });
});

describe('post-composer validators', () => {
  it('checks composer-info answers and rejects malformed data', () => {
    expect(checkComposerInfo({ shortName: 'Alex', userId: '12345' })).toEqual({
      shortName: 'Alex',
      userId: '12345',
    });
    expect(checkComposerInfo({ shortName: 'Alex', userId: null })).toEqual({
      shortName: 'Alex',
      userId: null,
    });
    expect(checkComposerInfo({ shortName: '', userId: '' })).toBeNull();
    expect(checkComposerInfo('Alex')).toBeNull();
  });

  it('checks open-post-composer answers', () => {
    expect(checkOpenComposer({ opened: true })).toBe(true);
    expect(checkOpenComposer({ opened: false })).toBe(false);
    expect(checkOpenComposer(null)).toBe(false);
  });
});

describe('createSetHomeFeedAction', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/');
    document.body.innerHTML = '<div role="main"><div role="feed"></div></div>';
  });

  it('overrides getCometFeedVariablesForSk on plain Home and triggers refreshHandler', () => {
    const varsMod = {
      getCometFeedVariablesForSk: vi.fn((feedStyle: unknown, sk: unknown) => ({ feedStyle, sk })),
    };
    const refreshCtx = { Provider: Symbol('CometHomeRefreshContext.Provider') };
    const refreshHandler = vi.fn();
    const feed = document.querySelector('[role=feed]') as HTMLElement;
    Object.assign(feed, {
      '__reactFiber$1': {
        type: refreshCtx.Provider,
        memoizedProps: { value: { refreshHandler } },
        return: null,
      },
    });
    const loader = {
      require: (name: string) => {
        if (name === 'CometHomeRootEntryPointVariables') {
          return varsMod;
        }
        if (name === 'CometHomeRefreshContext') {
          return refreshCtx;
        }
      },
    };

    const action = createSetHomeFeedAction(loader);
    expect(action({ feedStyle: 17, refresh: true })).toEqual({ applied: true, refreshed: true });
    expect(refreshHandler).toHaveBeenCalledWith('MANUAL');
    expect(varsMod.getCometFeedVariablesForSk(5, 'h_nor')).toEqual({
      feedStyle: 17,
      sk: 'h_chr',
    });

    // Explicit Home queries like `/?sk=h_nor` or `/?notif_id=1` are not plain Home and stay untouched.
    history.replaceState({}, '', '/?sk=h_nor');
    expect(varsMod.getCometFeedVariablesForSk(5, 'h_nor')).toEqual({
      feedStyle: 5,
      sk: 'h_nor',
    });
    history.replaceState({}, '', '/?notif_id=123');
    expect(varsMod.getCometFeedVariablesForSk(5, 'h_nor')).toEqual({
      feedStyle: 5,
      sk: 'h_nor',
    });
    history.replaceState({}, '', '/');

    // Clearing restores default Home variables untouched.
    expect(action({ feedStyle: null, refresh: false })).toEqual({
      applied: true,
      refreshed: false,
    });
    expect(varsMod.getCometFeedVariablesForSk(5, 'h_nor')).toEqual({
      feedStyle: 5,
      sk: 'h_nor',
    });
  });

  it('observes CometHomeRootEntryPointVariables passively via __debug.modulesMap without forcing require', () => {
    const varsExports = {
      getCometFeedVariablesForSk: vi.fn((feedStyle: unknown, sk: unknown) => ({ feedStyle, sk })),
    };
    const entry: Record<string, unknown> = {
      factoryFinished: false,
      exports: undefined,
      factory() {
        entry.exports = varsExports;
        entry.factoryFinished = true;
      },
    };
    const modulesMap: Record<string, unknown> = {
      CometHomeRootEntryPointVariables: entry,
    };
    const forcedRequire = vi.fn();
    const loader = {
      require: (name: string) => {
        if (name === '__debug') {
          return { modulesMap };
        }
        forcedRequire(name);
      },
    };

    const action = createSetHomeFeedAction(loader);
    // Does not force-require the uninitialized module while it is still pending.
    expect(action({ feedStyle: 17, refresh: false })).toEqual({ applied: false, refreshed: false });
    expect(forcedRequire).not.toHaveBeenCalled();

    // Once Facebook initializes the module, the wrapper installs passively.
    (entry.factory as () => void)();
    expect(varsExports.getCometFeedVariablesForSk(5, 'h_nor')).toEqual({
      feedStyle: 17,
      sk: 'h_chr',
    });

    // Disposing restores the original method cleanly.
    const original = varsExports.getCometFeedVariablesForSk;
    action.dispose();
    expect(varsExports.getCometFeedVariablesForSk).not.toBe(original);
    expect(varsExports.getCometFeedVariablesForSk(5, 'h_nor')).toEqual({
      feedStyle: 5,
      sk: 'h_nor',
    });
  });
});
