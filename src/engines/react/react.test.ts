import { describe, expect, it } from 'vitest';
import { componentName, findContextValue, walkFiberBfs, walkFiberUp } from '.';

describe('engines/react', () => {
  it('skips Context.Consumer fibers when resolving findContextValue', () => {
    const Ctx = { Provider: Symbol('Provider') };
    const consumer = { _context: Ctx };
    const el = document.createElement('div');
    Object.assign(el, {
      '__reactFiber$eng': {
        tag: 5,
        type: 'div',
        memoizedProps: {},
        return: {
          tag: 9, // Context.Consumer
          type: consumer,
          memoizedProps: { children: () => null },
          return: {
            tag: 10, // Context.Provider
            type: Ctx.Provider,
            memoizedProps: { value: 'real-value' },
            return: null,
          },
        },
      },
    });

    expect(findContextValue(el, Ctx)).toBe('real-value');
  });

  it('walks fibers up and breadth-first with componentName unwrapping memo/forwardRef', () => {
    const MemoComp = { type: Object.assign(() => null, { displayName: 'TweetCard' }) };
    const ForwardComp = { render: Object.assign(() => null, { displayName: 'PromotedBadge' }) };
    const el = document.createElement('article');
    Object.assign(el, {
      '__reactFiber$eng': {
        type: 'article',
        child: {
          type: 'div',
          child: { type: ForwardComp, sibling: null, child: null },
          sibling: null,
        },
        return: {
          type: MemoComp,
          memoizedProps: { promotedContent: { id: 'ad-1' } },
          return: null,
        },
      },
    });

    expect(componentName(MemoComp)).toBe('TweetCard');
    expect(componentName(ForwardComp)).toBe('PromotedBadge');
    expect(
      walkFiberUp(el, (fiber) =>
        componentName(fiber.type) === 'TweetCard' ? fiber.memoizedProps : undefined,
      ),
    ).toEqual({ promotedContent: { id: 'ad-1' } });
    expect(
      walkFiberBfs(el, (fiber) =>
        componentName(fiber.type) === 'PromotedBadge' ? true : undefined,
      ),
    ).toBe(true);
  });
});
