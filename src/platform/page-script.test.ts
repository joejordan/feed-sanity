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
});
