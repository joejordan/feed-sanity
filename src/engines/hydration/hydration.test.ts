import { describe, expect, it } from 'vitest';
import { findInHydration, scanHydrationScripts } from '.';

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
});
