import { beforeEach, describe, expect, it } from 'vitest';
import type { Post } from '../../facebook/posts';
import type { Outcome } from './engine';
import { readPostFields } from '../../facebook/post-fields';
import { fakeAtoms as atoms, makePost } from '../../facebook/testing';
import { applyOutcome } from './effects';
import { untouched } from './engine';
import { ALL_POSTS, Tabs } from './tabs';

const apply = (post: Post, changes: Partial<Outcome>, previous?: ReturnType<typeof applyOutcome>) =>
  applyOutcome(
    post,
    { ...untouched(), ...changes },
    readPostFields(post.element, atoms),
    atoms,
    previous,
  );

describe('applyOutcome', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds classes and styles, and takes them back on the next outcome', () => {
    const post = makePost('<h4 class="own" style="color: red"><b>Ann</b></h4>');
    const heading = post.element.querySelector('h4') as HTMLElement;

    const applied = apply(post, {
      classes: [{ name: 'spam loud' }, { name: 'own extra', selector: 'h4' }],
      styles: [
        { property: 'color', value: 'blue', selector: 'h4' },
        { property: 'opacity', value: '0.5' },
        { property: 'margin-top', value: '4px !important' },
      ],
    });

    expect(post.element.style.getPropertyValue('margin-top')).toBe('4px');
    expect(post.element.style.getPropertyPriority('margin-top')).toBe('important');

    expect(post.element.className).toBe('spam loud');
    expect(heading.className).toBe('own extra');
    expect(heading.style.color).toBe('blue');
    expect(post.element.style.opacity).toBe('0.5');

    apply(post, {}, applied);

    expect(post.element.className).toBe('');
    // The class the element had before stays.
    expect(heading.className).toBe('own');
    expect(heading.style.color).toBe('red');
    expect(post.element.style.opacity).toBe('');
  });

  it('ignores a selector that is not valid', () => {
    const post = makePost('<p>Text</p>');

    expect(() => apply(post, { classes: [{ name: 'x', selector: 'p:(' }] })).not.toThrow();
  });

  it('hides with the note it is given, and unhides', () => {
    const post = makePost('<p>Text</p>');
    const hiding = { reveal: 'Show', rehide: 'Hide', showNote: true, css: 'color: red' };

    apply(post, { hiding });
    const note = post.element.querySelector<HTMLElement>('.sfx_filter_hidden_note');

    expect(post.element.classList.contains('sfx_filter_hidden')).toBe(true);
    expect(note?.textContent).toBe('ShowHide');
    expect(note?.style.color).toBe('red');

    // The same outcome again keeps the note, and a new text replaces it.
    apply(post, { hiding });
    expect(post.element.querySelector('.sfx_filter_hidden_note')).toBe(note);
    apply(post, { hiding: { ...hiding, reveal: 'Show it' } });
    expect(post.element.querySelectorAll('.sfx_filter_hidden_note')).toHaveLength(1);
    expect(post.element.querySelector('.sfx_filter_hidden_note')).not.toBe(note);

    apply(post, {});
    expect(post.element.classList.contains('sfx_filter_hidden')).toBe(false);
    expect(post.element.querySelector('.sfx_filter_hidden_note')).toBeNull();
  });

  it('rewrites the text of the author, header and message once', () => {
    const post = makePost(
      `<h4><b>Ann Cat</b></h4>
       <div data-ad-rendering-role="story_message">My cat and <i>another cat</i></div>
       <p>cat outside the message</p>`,
    );
    const replacements = [{ find: /cat/gi, replace: 'big cat' }];

    apply(post, { replacements });
    apply(post, { replacements });

    expect(post.element.querySelector('b')?.textContent).toBe('Ann big cat');
    expect(post.element.querySelector('[data-ad-rendering-role]')?.textContent).toBe(
      'My big cat and another big cat',
    );
    expect(post.element.querySelector('p')?.textContent).toBe('cat outside the message');
  });

  it('makes every replacement in the same piece of text', () => {
    const post = makePost('<div data-ad-rendering-role="story_message">My cat and my dog</div>');

    apply(post, {
      replacements: [
        { find: /cat/gi, replace: 'kitten' },
        { find: /dog/gi, replace: 'puppy' },
      ],
    });

    expect(post.element.textContent).toBe('My kitten and my puppy');
  });
});

describe('Tabs', () => {
  const classes = (post: Post) => [...post.element.classList].sort();
  const style = () => document.querySelector('#sfx_filter_tabselect')?.textContent ?? null;
  let tabs: Tabs;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.querySelector('#sfx_filter_tabselect')?.remove();
    tabs = new Tabs();
  });

  it('puts every post in All Posts and in the tabs it is given', () => {
    const feed = makePost('a');
    const news = makePost('b');

    tabs.assign(feed.element, ['Filtered Feed'], false);
    tabs.assign(news.element, ['News'], false);

    expect(classes(feed)).toEqual(['sfx_filter_tab_0', 'sfx_filter_tab_1']);
    expect(classes(news)).toEqual(['sfx_filter_tab_0', 'sfx_filter_tab_2']);
    expect(tabs.hasCustomTabs).toBe(true);
    expect(tabs.list().map(({ name, total }) => [name, total])).toEqual([
      [ALL_POSTS, 2],
      ['Filtered Feed', 1],
      ['News', 1],
    ]);
  });

  it('moves a post when it is assigned again', () => {
    const post = makePost('a');

    tabs.assign(post.element, ['News'], false);
    tabs.assign(post.element, ['Filtered Feed'], false);

    expect(classes(post)).toEqual(['sfx_filter_tab_0', 'sfx_filter_tab_1']);
  });

  it('hides the posts outside the selected tab, and never those in the popup', () => {
    tabs.assign(makePost('a').element, ['News'], false);
    // Only sorted posts are hidden, so a post still waiting for its ID stays visible.
    expect(style()).toBe(
      '.sfx_filter_tab_0:not(.sfx_filter_tab_1):not(.sfx_popup_post) { display: none; }',
    );

    tabs.select('News');

    expect(style()).toContain(':not(.sfx_filter_tab_2)');
    expect(tabs.list().find((tab) => tab.selected)?.name).toBe('News');
  });

  it('counts the posts a filter has hidden', () => {
    const post = makePost('a');

    tabs.assign(post.element, ['Filtered Feed'], true);
    expect(tabs.list()[1]).toMatchObject({ total: 1, hidden: 1 });

    tabs.assign(post.element, ['Filtered Feed'], false);
    expect(tabs.list()[1]).toMatchObject({ total: 1, hidden: 0 });
  });

  it('forgets posts that leave, and starts over on a new page', () => {
    const post = makePost('a');
    tabs.assign(post.element, ['News'], false);
    tabs.select('News');

    tabs.remove(post.element);
    expect(tabs.list()[2]).toMatchObject({ name: 'News', total: 0 });

    tabs.reset();
    expect(tabs.hasCustomTabs).toBe(false);
    expect(style()).toContain(':not(.sfx_filter_tab_1)');
  });

  it('shows everything again when it is cleared', () => {
    const post = makePost('a');
    post.element.classList.add('kept');
    tabs.assign(post.element, ['News'], false);

    tabs.clear();

    expect(classes(post)).toEqual(['kept']);
    expect(style()).toBeNull();
  });

  it('says nothing when a post is assigned what it already has', () => {
    const post = makePost('a');
    tabs.assign(post.element, ['News'], false);
    const { version } = tabs;

    tabs.assign(post.element, ['News'], false);

    expect(tabs.version).toBe(version);
  });

  it('tells listeners about changes, and can make a tab before any post is in it', () => {
    let changes = 0;
    tabs.onChange(() => changes++);

    tabs.add('Later');
    tabs.add('Later');

    expect(changes).toBe(1);
    expect(tabs.list().map((tab) => tab.name)).toContain('Later');
  });
});
