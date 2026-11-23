import { describe, expect, it, vi } from 'vitest';
import { findInHydration, scanHydrationScripts, watchHydrationScripts } from '.';

describe('engines/hydration', () => {
  it('parses inline JSON scripts, strips for (;;); prefixes, and skips malformed or oversized blocks', () => {
    const doc = document.implementation.createHTMLDocument('hydration');

    const good = doc.createElement('script');
    good.type = 'application/json';
    good.id = '__NEXT_DATA__';
    good.textContent = JSON.stringify({ props: { pageProps: { user: 'alice' } } });

    const meta = doc.createElement('script');
    meta.type = 'application/json';
    meta.id = 'relay-1';
    meta.textContent = 'for (;;);{"require":[["FeedQuery",{"ad_id":"99"}]]}';

    const broken = doc.createElement('script');
    broken.type = 'application/json';
    broken.textContent = '{not valid json';

    const huge = doc.createElement('script');
    huge.type = 'application/json';
    huge.id = 'huge';
    huge.textContent = JSON.stringify({ data: 'x'.repeat(200) });

    doc.body.append(good, meta, broken, huge);

    const all = scanHydrationScripts(doc, { maxCharsPerScript: 150 });
    expect(all.map((p) => p.id)).toEqual(['__NEXT_DATA__', 'relay-1']);
    expect(all[1]?.data).toEqual({ require: [['FeedQuery', { ad_id: '99' }]] });

    const hinted = scanHydrationScripts(doc, { textHint: 'FeedQuery' });
    expect(hinted).toHaveLength(1);
    expect(hinted[0]?.id).toBe('relay-1');

    const byId = scanHydrationScripts(doc, { idPattern: /^__NEXT/ });
    expect(byId).toHaveLength(1);
    expect(byId[0]?.id).toBe('__NEXT_DATA__');

    const user = findInHydration(doc, ({ data }) => {
      const obj = data as { props?: { pageProps?: { user?: string } } };
      return obj.props?.pageProps?.user;
    });
    expect(user).toBe('alice');
  });

  it('watchHydrationScripts rescans on DOMContentLoaded without re-parsing previously seen scripts', () => {
    const doc = document.implementation.createHTMLDocument('watch');
    Object.defineProperty(doc, 'readyState', { value: 'loading', configurable: true });
    const first = doc.createElement('script');
    first.type = 'application/json';
    first.id = 'first';
    first.textContent = JSON.stringify({ id: 'a' });
    doc.head.append(first);

    const parseSpy = vi.spyOn(JSON, 'parse');
    const batches: string[][] = [];
    const stop = watchHydrationScripts(doc, {}, (payloads) => {
      batches.push(payloads.map((p) => p.id));
    });

    expect(batches).toEqual([['first']]);
    expect(parseSpy).toHaveBeenCalledTimes(1);

    const second = doc.createElement('script');
    second.type = 'application/json';
    second.id = 'second';
    second.textContent = JSON.stringify({ id: 'b' });
    doc.body.append(second);
    doc.dispatchEvent(new Event('DOMContentLoaded'));

    expect(batches).toEqual([['first'], ['second']]);
    // `first` was skipped via WeakSet before JSON.parse on DOMContentLoaded.
    expect(parseSpy).toHaveBeenCalledTimes(2);
    stop();
    parseSpy.mockRestore();

    // Handles undefined document safely.
    expect(() => watchHydrationScripts(undefined, {}, () => undefined)()).not.toThrow();
  });
});
