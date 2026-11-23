import { describe, expect, it } from 'vitest';
import {
  addStyle,
  closestAcrossShadows,
  containsAcrossShadows,
  probe,
  queryDeepAll,
  queryDeepFirst,
} from './dom';

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

describe('shadow-piercing DOM helpers', () => {
  it('skips elements and descendants inside skipAttr subtrees in queryDeepAll and queryDeepFirst', () => {
    const host = document.createElement('div');
    const own = document.createElement('div');
    own.setAttribute('data-own', '1');
    const ownBtn = document.createElement('button');
    ownBtn.id = 'own-btn';
    own.append(ownBtn);

    const realBtn = document.createElement('button');
    realBtn.id = 'real-btn';

    const shadowHost = document.createElement('section');
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const shadowBtn = document.createElement('button');
    shadowBtn.id = 'shadow-btn';
    shadow.append(shadowBtn);

    host.append(own, realBtn, shadowHost);
    document.body.append(host);

    // First matching button in `host` is inside `own`; queryDeepFirst must skip it and return `#real-btn`.
    expect(queryDeepFirst(host, 'button', 'data-own')?.id).toBe('real-btn');
    expect(queryDeepAll(host, 'button', 'data-own').map((el) => el.id)).toEqual([
      'real-btn',
      'shadow-btn',
    ]);
    expect(containsAcrossShadows(host, shadowBtn)).toBe(true);
    expect(closestAcrossShadows(shadowBtn, 'div')).toBe(host);
    host.remove();
  });
});
