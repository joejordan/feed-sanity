import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInPage } from './page-script';

/** The script element `runInPage` adds, caught as it goes into the page. */
function catchScript(): () => HTMLScriptElement | undefined {
  let script: HTMLScriptElement | undefined;
  const append = Element.prototype.append;
  vi.spyOn(Element.prototype, 'append').mockImplementation(function (this: Element, ...nodes) {
    for (const node of nodes) {
      if (node instanceof HTMLScriptElement) {
        script = node;
        // Not added for real: happy-dom would try to load it.
        return;
      }
    }
    append.apply(this, nodes);
  });
  return () => script;
}

describe('runInPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds the code as a script from a blob: address, and removes both once it has run', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const created = vi.spyOn(URL, 'createObjectURL');
    const script = catchScript();

    const ran = runInPage('void 0;');
    const added = script();
    expect(added?.src).toMatch(/^blob:/);
    expect(await (created.mock.calls[0]?.[0] as Blob).text()).toBe('void 0;');
    added?.dispatchEvent(new Event('load'));

    await ran;
    expect(revoke).toHaveBeenCalledWith(added?.src);
  });

  it('rejects when the page refuses the script', async () => {
    const script = catchScript();

    const ran = runInPage('void 0;');
    script()?.dispatchEvent(new Event('error'));

    await expect(ran).rejects.toThrow('the page refused a script from a blob: address');
  });

  it('routes script URLs through Trusted Types, reuses the policy, and rejects foreign URLs', async () => {
    let registeredRule: ((input: string) => string) | undefined;
    const createScriptURL = vi.fn((u: string) => registeredRule?.(u) ?? u);
    const createPolicy = vi.fn(
      (_name: string, rules: { createScriptURL: (input: string) => string }) => {
        registeredRule = rules.createScriptURL;
        return { createScriptURL };
      },
    );
    Object.defineProperty(globalThis, 'trustedTypes', {
      value: { createPolicy },
      configurable: true,
    });
    try {
      const script = catchScript();
      const first = runInPage('void 1;');
      script()?.dispatchEvent(new Event('load'));
      await first;

      const second = runInPage('void 2;');
      script()?.dispatchEvent(new Event('load'));
      await second;

      expect(createPolicy).toHaveBeenCalledTimes(1);
      expect(createPolicy).toHaveBeenCalledWith('feed-sanity', expect.any(Object));
      expect(createScriptURL).toHaveBeenCalledTimes(2);
      // Outside an active runInPage call, arbitrary or unminted URLs are rejected.
      expect(() => registeredRule?.('https://evil.example/x.js')).toThrow(TypeError);
      expect(() => registeredRule?.('blob:https://example.com/unminted')).toThrow(TypeError);
    } finally {
      Reflect.deleteProperty(globalThis, 'trustedTypes');
    }
  });

  it('revokes the blob URL and rejects cleanly when policy creation and src assignment fail', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const createPolicy = vi.fn(() => {
      throw new TypeError('policy disallowed by CSP');
    });
    Object.defineProperty(globalThis, 'trustedTypes', {
      value: { createPolicy },
      configurable: true,
    });
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'script') {
        Object.defineProperty(el, 'src', {
          set() {
            throw new TypeError('TrustedScriptURL required');
          },
        });
      }
      return el;
    }) as typeof document.createElement);
    try {
      await expect(runInPage('void 0;')).rejects.toThrow(
        'the page refused a script from a blob: address',
      );
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(globalThis, 'trustedTypes');
    }
  });
});
