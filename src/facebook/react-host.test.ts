import { describe, expect, it, vi } from 'vitest';
import {
  collectContextProviders,
  fiberOf,
  findContextValue,
  mountFacebookComponent,
} from './react-host';

describe('react-host', () => {
  it('finds fibers, context values, and deduplicated ancestor context providers', () => {
    const ctxA = { Provider: { _context: 'A' } };
    const ctxB = { Provider: { _context: 'B' } };
    const outerA = {
      tag: 10,
      type: ctxA.Provider,
      memoizedProps: { value: 'outer' },
      return: null,
    };
    const midB = {
      tag: 10,
      type: ctxB.Provider,
      memoizedProps: { value: 'b-val' },
      return: outerA,
    };
    const innerA = {
      tag: 10,
      type: ctxA.Provider,
      memoizedProps: { value: 'inner' },
      return: midB,
    };
    const leaf = { tag: 5, type: 'div', memoizedProps: {}, return: innerA };

    const el = document.createElement('div');
    Object.assign(el, { '__reactFiber$abc': leaf });

    expect(fiberOf(el)).toBe(leaf);
    expect(findContextValue(el, ctxA)).toBe('inner');
    expect(findContextValue(el, ctxB)).toBe('b-val');
    expect(collectContextProviders(el)).toEqual([
      { provider: ctxA.Provider, value: 'inner' },
      { provider: ctxB.Provider, value: 'b-val' },
    ]);
  });

  it('mounts a component with inherited providers and unmounts cleanly', () => {
    const renderRoot = vi.fn();
    const unmountRoot = vi.fn();
    const createRoot = vi.fn(() => ({ render: renderRoot, unmount: unmountRoot }));
    const createElement = vi.fn((type: unknown, props: unknown, ...children: unknown[]) => ({
      type,
      props,
      children,
    }));
    class FakeComponent {
      props: Record<string, unknown>;
      state: Record<string, unknown> = {};
      constructor(props: Record<string, unknown>) {
        this.props = props;
      }
    }
    const loader = {
      require: (name: string) => {
        if (name === 'react') {
          return { createElement, Component: FakeComponent, Suspense: 'Suspense' };
        }
        if (name === 'ReactDOM') {
          return { createRoot };
        }
      },
    };

    const provider = { _context: Symbol('Relay') };
    const anchor = document.createElement('main');
    Object.assign(anchor, {
      '__reactFiber$1': {
        tag: 10,
        type: provider,
        memoizedProps: { value: 'relay-env' },
        return: null,
      },
    });
    const target = document.createElement('div');

    const unmount = mountFacebookComponent(loader, target, anchor, () => 'child-node');
    expect(unmount).not.toBeNull();
    expect(createRoot).toHaveBeenCalledWith(target);
    expect(renderRoot).toHaveBeenCalledTimes(1);
    const tree = renderRoot.mock.calls[0]?.[0] as { type: unknown; props: { value: unknown } };
    expect(tree.type).toBe(provider);
    expect(tree.props.value).toBe('relay-env');

    unmount?.();
    unmount?.();
    expect(unmountRoot).toHaveBeenCalledTimes(1);
  });
});
