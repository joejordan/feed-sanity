import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenPostComposerAction } from './page-actions';
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
