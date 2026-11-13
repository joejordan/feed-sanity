import { beforeEach, describe, expect, it, vi } from 'vitest';
import { probe, watchTree } from './dom';
import { sleep } from './timing';

describe('probe', () => {
  it('returns the root itself and its descendants that match', () => {
    document.body.innerHTML = '<div class="a" id="root"><p class="a"></p><p class="b"></p></div>';
    const root = document.querySelector('#root') as Element;

    expect(probe(root, '.a').map((element) => element.tagName)).toEqual(['DIV', 'P']);
    expect(probe(root, '.b')).toHaveLength(1);
    expect(probe(root, '.c')).toEqual([]);
  });
});

describe('watchTree', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('reports elements added and removed at any depth', async () => {
    const root = document.querySelector('#root') as Element;
    const added = vi.fn();
    const removed = vi.fn();
    watchTree(document.body, { added, removed });

    const child = document.createElement('section');
    root.append(child);
    await vi.waitFor(() => expect(added).toHaveBeenCalledExactlyOnceWith(child));

    child.remove();
    await vi.waitFor(() => expect(removed).toHaveBeenCalledExactlyOnceWith(child));
  });

  it('skips text and elements that hold no content', async () => {
    const added = vi.fn();
    watchTree(document.body, { added });

    document.body.append('text', document.createElement('script'), document.createElement('p'));

    await vi.waitFor(() => expect(added).toHaveBeenCalled());
    expect(added.mock.calls.map(([element]) => (element as Element).tagName)).toEqual(['P']);
  });

  it('stops when asked', async () => {
    const added = vi.fn();
    const stop = watchTree(document.body, { added });
    stop();

    document.body.append(document.createElement('p'));
    await sleep(20);

    expect(added).not.toHaveBeenCalled();
  });
});
