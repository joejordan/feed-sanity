import { describe, expect, it } from 'vitest';
import { addStyle, probe } from './dom';

describe('addStyle', () => {
  it('adds the style sheet to the page once', () => {
    addStyle('test_style', '.a { color: red; }');
    addStyle('test_style', '.a { color: blue; }');

    const styles = document.head.querySelectorAll('style#test_style');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe('.a { color: red; }');
  });

  it('removes the style sheet it added, and only that one', () => {
    const remove = addStyle('removed_style', '.a { color: red; }');
    const removeDuplicate = addStyle('removed_style', '.a { color: blue; }');

    removeDuplicate();
    expect(document.querySelector('style#removed_style')).not.toBeNull();

    remove();
    expect(document.querySelector('style#removed_style')).toBeNull();
  });
});

describe('probe', () => {
  it('returns the root itself and its descendants that match', () => {
    document.body.innerHTML = '<div class="a" id="root"><p class="a"></p><p class="b"></p></div>';
    const root = document.querySelector('#root') as Element;

    expect(probe(root, '.a').map((element) => element.tagName)).toEqual(['DIV', 'P']);
    expect(probe(root, '.b')).toHaveLength(1);
    expect(probe(root, '.c')).toEqual([]);
  });
});
