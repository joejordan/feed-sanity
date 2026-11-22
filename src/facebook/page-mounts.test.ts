import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHomeRailMount } from './page-mounts';

describe('page-mounts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('loads the Home bundle, mounts the rail component via ReactDOM.createRoot, and disposes on unmount', async () => {
    const main = document.createElement('div');
    main.setAttribute('role', 'main');
    const target = document.createElement('div');
    document.body.append(main, target);

    const disposeQuery = vi.fn();
    const unmountRoot = vi.fn();
    const renderedProps: Record<string, unknown>[] = [];
    const renderRoot = vi.fn((element: unknown) => {
      // Walk down the element tree and invoke `RailRunner` twice (simulating
      // a React 18/19 Suspense retry) to verify Relay query reuse & wiring.
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') {
          return;
        }
        const el = node as {
          type?: unknown;
          props?: Record<string, unknown>;
          children?: unknown[];
        };
        if (typeof el.type === 'function' && el.type.name === 'RailRunner') {
          const out1 = (el.type as () => { props?: Record<string, unknown> })();
          const out2 = (el.type as () => { props?: Record<string, unknown> })();
          if (out1.props) {
            renderedProps.push(out1.props);
          }
          if (out2.props) {
            renderedProps.push(out2.props);
          }
          return;
        }
        for (const child of el.children ?? []) {
          walk(child);
        }
      };
      walk(element);
    });
    const loadQuery = vi.fn(() => ({ dispose: disposeQuery }));
    let bundleLoaded = false;

    const loadBundle = vi.fn(() => {
      bundleLoaded = true;
      return Promise.resolve();
    });

    const LeftRailComponent = vi.fn(() => null);
    class FakeComponent {
      props: Record<string, unknown>;
      state: Record<string, unknown> = {};
      constructor(props: Record<string, unknown>) {
        this.props = props;
      }
    }
    const entrypoint = {
      root: { load: loadBundle },
      getPreloadProps: () => ({
        queries: {
          leftRailContainerQueryReference: {
            parameters: { id: 'q1' },
            variables: { scale: 1 },
          },
        },
      }),
    };
    const relay = { useRelayEnvironment: () => 'env', loadQuery };
    const loader = {
      requireLazy: (deps: readonly string[], cb: (...mods: unknown[]) => void) => {
        expect(deps).toEqual(['CometHomeRoot.entrypoint', 'CometRelay']);
        queueMicrotask(() => cb(entrypoint, relay));
      },
      require: (name: string) => {
        switch (name) {
          case 'CometClassicHomeLeftRailContainer.react':
            return bundleLoaded ? LeftRailComponent : undefined;
          case 'react':
            return {
              createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
                type,
                props,
                children,
              }),
              useMemo: <T>(fn: () => T) => fn(),
              useEffect: () => undefined,
              Component: FakeComponent,
              Suspense: 'Suspense',
            };
          case 'ReactDOM':
            return { createRoot: () => ({ render: renderRoot, unmount: unmountRoot }) };
          default:
            return;
        }
      },
    };

    const mount = createHomeRailMount(
      {
        componentModule: 'CometClassicHomeLeftRailContainer.react',
        queryKey: 'leftRailContainerQueryReference',
      },
      loader,
    );

    const unmount = await mount(target, {});
    expect(unmount).toBeTypeOf('function');

    await vi.waitFor(() => expect(renderRoot).toHaveBeenCalledTimes(1));
    expect(loadBundle).toHaveBeenCalledTimes(1);
    // Suspense retry reused the live queryRef instead of leaking a second loadQuery call.
    expect(loadQuery).toHaveBeenCalledTimes(1);
    expect(renderedProps).toHaveLength(2);
    expect(renderedProps[0]?.leftRailContainerQueryReference).toBe(
      renderedProps[1]?.leftRailContainerQueryReference,
    );

    unmount?.();
    expect(unmountRoot).toHaveBeenCalledTimes(1);
    expect(disposeQuery).toHaveBeenCalledTimes(1);
  });

  it('returns null cleanly when Facebook modules are missing', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const mount = createHomeRailMount(
      {
        componentModule: 'CometHomeRightRail.react',
        queryKey: 'rightSideHeaderCardsQueryReference',
        propName: 'rightSideHeaderCardsQueryReference',
      },
      {},
    );
    expect(mount(target, {})).toBeNull();
  });
});
