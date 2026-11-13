import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onUrlChange } from './navigation';
import { sleep } from './timing';

describe('onUrlChange', () => {
  beforeEach(() => {
    history.replaceState({}, '', '/');
  });

  it('reports an address change once the document changes', async () => {
    const listener = vi.fn();
    const stop = onUrlChange(listener);

    document.body.append(document.createElement('p'));
    await sleep(20);
    expect(listener).not.toHaveBeenCalled();

    history.pushState({}, '', '/groups/gardening/');
    document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    stop();
  });

  it('reports a move through the history', () => {
    const listener = vi.fn();
    const stop = onUrlChange(listener);

    history.replaceState({}, '', '/marketplace/');
    dispatchEvent(new Event('popstate'));

    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs before an observer created later', async () => {
    const order: string[] = [];
    const stop = onUrlChange(() => order.push('address'));
    const later = new MutationObserver(() => order.push('content'));
    later.observe(document.body, { childList: true });

    history.pushState({}, '', '/some.user');
    document.body.append(document.createElement('p'));

    await vi.waitFor(() => expect(order).toEqual(['address', 'content']));
    later.disconnect();
    stop();
  });

  it('stops when asked and ignores changes made while nobody listened', async () => {
    const listener = vi.fn();
    onUrlChange(listener)();
    history.pushState({}, '', '/some.user');

    const stop = onUrlChange(listener);
    document.body.append(document.createElement('p'));
    await sleep(20);

    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
