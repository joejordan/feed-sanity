import { afterEach, describe, expect, it } from 'vitest';
import { PageBridge } from '../../core/bridge';
import { startRedditPageWorld } from './page-world';

describe('reddit page-world engine', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose();
    }
    document.body.replaceChildren();
  });

  it('leaves Element.prototype.attachShadow untouched when started passively and activates/deactivates via reddit-active', async () => {
    const origAttach = Element.prototype.attachShadow;
    const handle = startRedditPageWorld({ Element }, document, { startActive: false });
    disposers.push(handle.dispose);

    // Passive start must not patch attachShadow while experimental Reddit is disabled.
    expect(Element.prototype.attachShadow).toBe(origAttach);

    const bridge = new PageBridge(async () => undefined);
    disposers.push(() => bridge.dispose());

    await bridge.set('reddit-active', true);
    expect(Element.prototype.attachShadow).not.toBe(origAttach);

    const attachedTargets: EventTarget[] = [];
    const onShadow = (event: Event) => {
      if (event.target) {
        attachedTargets.push(event.target);
      }
    };
    document.addEventListener('feed-sanity:shadow-attached', onShadow);
    try {
      const host = document.createElement('div');
      document.body.append(host);
      host.attachShadow({ mode: 'open' });
      expect(attachedTargets).toEqual([host]);
    } finally {
      document.removeEventListener('feed-sanity:shadow-attached', onShadow);
    }

    await bridge.set('reddit-active', false);
    expect(Element.prototype.attachShadow).toBe(origAttach);
  });
});
