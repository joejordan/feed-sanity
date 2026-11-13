import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FacebookPage } from '../../facebook/feature';
import type { Post } from '../../facebook/posts';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { extensionStore } from '../../platform/extension-store';
import hidePosts from '.';
import { keywordMatcher } from './matcher';

type PostListener = (post: Post) => void;

/** A page whose posts the test announces by hand. */
function fakePage() {
  const listeners = {
    add: [] as PostListener[],
    remove: [] as PostListener[],
    update: [] as PostListener[],
    reset: [] as (() => void)[],
  };
  const subscribe =
    <L>(list: L[]) =>
    (listener: L) => {
      list.push(listener);
      return () => list.splice(list.indexOf(listener), 1).length > 0;
    };
  const page: FacebookPage = {
    atoms: {
      translate: (text) => text,
      onChange: () => () => true,
      start: () => Promise.resolve(),
    },
    posts: {
      onAdd: subscribe(listeners.add),
      onRemove: subscribe(listeners.remove),
      onUpdate: subscribe(listeners.update),
      onReset: subscribe(listeners.reset),
    },
  };
  return { page, listeners };
}

let nextNumber = 1;

function makePost(html: string, permalink = false): Post {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.append(element);
  return { element, number: nextNumber++, id: null, permalink };
}

const noteOf = (post: Post) => post.element.querySelector<HTMLElement>('.sfx_filter_hidden_note');
const isHidden = (post: Post) => post.element.classList.contains('sfx_filter_hidden');
const isShown = (post: Post) => post.element.classList.contains('sfx_filter_hidden_show');

describe('hide_posts', () => {
  let options: Options;
  let listeners: ReturnType<typeof fakePage>['listeners'];

  const announce = (post: Post): Post => {
    for (const listener of listeners.add) {
      listener(post);
    }
    return post;
  };

  beforeEach(async () => {
    fakeBrowser.reset();
    history.replaceState({}, '', '/');
    document.body.innerHTML = '';
    options = new Options(extensionStore, 'u/options');
    const fake = fakePage();
    listeners = fake.listeners;
    expect(await startFeatures([hidePosts], options, fake.page)).toEqual([]);
    await options.set('hide_posts_text', 'crypto\n\n  giveaway  ');
  });

  it('hides a post that contains a keyword and says which one', () => {
    const spam = announce(makePost('<p>Huge Crypto opportunity</p>'));
    const fine = announce(makePost('<p>Photos from the weekend</p>'));

    expect(isHidden(spam)).toBe(true);
    expect(noteOf(spam)?.textContent).toContain('Post Hidden by keyword: Crypto');
    expect(isHidden(fine)).toBe(false);
    expect(noteOf(fine)).toBeNull();
  });

  it('shows and hides the post again when the note is clicked', () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    noteOf(post)?.click();
    expect(isShown(post)).toBe(true);

    noteOf(post)?.click();
    expect(isShown(post)).toBe(false);
    expect(isHidden(post)).toBe(true);
  });

  it('leaves no note when notes are turned off', async () => {
    await options.set('hide_posts_show_hidden_message', false);
    const post = announce(makePost('<p>A giveaway</p>'));

    expect(isHidden(post)).toBe(true);
    expect(noteOf(post)).toBeNull();
  });

  it('hides a revealed post again when notes are turned off', async () => {
    const post = announce(makePost('<p>A giveaway</p>'));
    noteOf(post)?.click();
    expect(isShown(post)).toBe(true);

    await options.set('hide_posts_show_hidden_message', false);

    expect(isShown(post)).toBe(false);
    expect(isHidden(post)).toBe(true);
    expect(noteOf(post)).toBeNull();
  });

  it('keeps the matching word out of the note when asked to', async () => {
    await options.set('hide_posts_show_match', false);
    const post = announce(makePost('<p>A giveaway</p>'));

    expect(noteOf(post)?.textContent).toContain('Post Hidden by keyword --');
  });

  it('applies changed settings to the posts already on the page', async () => {
    const post = announce(makePost('<p>A giveaway and some kittens</p>'));

    await options.set('hide_posts_text', 'kittens');
    expect(noteOf(post)?.textContent).toContain('keyword: kittens');
    expect(post.element.querySelectorAll('.sfx_filter_hidden_note')).toHaveLength(1);

    await options.set('hide_posts_text', '');
    expect(isHidden(post)).toBe(false);
    expect(noteOf(post)).toBeNull();
  });

  it('looks in photo descriptions only when that is on', async () => {
    const post = announce(makePost('<p>Look at this</p><img alt="A crypto chart">'));
    expect(isHidden(post)).toBe(true);

    await options.set('hide_posts_caption', false);
    expect(isHidden(post)).toBe(false);
  });

  it('ignores the comments on a post', () => {
    const post = announce(
      makePost('<p>Photos from the weekend</p><div role="article">Is this a giveaway?</div>'),
    );

    expect(isHidden(post)).toBe(false);
  });

  it('puts the note back after Facebook refills the post', () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    post.element.innerHTML = '<p>A giveaway</p>';
    for (const listener of listeners.update) {
      listener(post);
    }

    expect(noteOf(post)?.textContent).toContain('keyword: giveaway');
    expect(isHidden(post)).toBe(true);
  });

  it('leaves a hidden post as it is while Facebook has it emptied', () => {
    const post = announce(makePost('<p>A giveaway</p>'));
    noteOf(post)?.click();

    post.element.innerHTML = '<div style="height: 400px"></div>';
    for (const listener of listeners.update) {
      listener(post);
    }

    expect(isHidden(post)).toBe(true);
    expect(isShown(post)).toBe(true);
  });

  it('keeps judging a post by the page it arrived on after the address changes', () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    // A photo opened from the feed changes the address and leaves the feed in place.
    history.replaceState({}, '', '/photo/?fbid=1');
    for (const listener of listeners.update) {
      listener(post);
    }

    expect(isHidden(post)).toBe(true);
  });

  it('keeps a post the page is about visible, with the note above it', async () => {
    await options.set('hide_posts_show_hidden_message', false);
    const post = announce(makePost('<p>A giveaway</p>', true));

    expect(isHidden(post)).toBe(true);
    expect(isShown(post)).toBe(true);
    expect(noteOf(post)).not.toBeNull();
  });

  it.each([
    ['/some.user', 'filters_enabled_pages'],
    ['/groups/gardening/', 'filters_enabled_groups'],
  ] as const)('leaves posts on %s alone until %s is on', async (address, key) => {
    history.replaceState({}, '', address);
    const post = announce(makePost('<p>A giveaway</p>'));
    expect(isHidden(post)).toBe(false);

    await options.set(key, true);
    expect(isHidden(post)).toBe(true);
  });

  it('watches posts only while there is something to hide', async () => {
    expect(listeners.add).toHaveLength(1);

    await options.set('hide_posts_text', '');
    expect(listeners.add).toHaveLength(0);
    expect(listeners.update).toHaveLength(0);

    await options.set('hide_posts_text', 'kittens');
    expect(listeners.add).toHaveLength(1);
  });

  it('hides nothing when filtering is turned off', async () => {
    const post = announce(makePost('<p>A giveaway</p>'));

    await options.set('filters_enabled', false);

    expect(isHidden(post)).toBe(false);
  });

  it('forgets posts that leave the page', async () => {
    const post = announce(makePost('<p>A giveaway</p>'));
    for (const listener of listeners.remove) {
      listener(post);
    }
    post.element.className = '';

    await options.set('hide_posts_show_match', false);

    expect(isHidden(post)).toBe(false);
  });
});

describe('keywordMatcher', () => {
  const settings = { partial: true, caseSensitive: false };

  it('has nothing to match when there are no keywords', () => {
    expect(keywordMatcher(' \n \n', settings)).toBeNull();
  });

  it('finds whole words only when partial matching is off', () => {
    const matcher = keywordMatcher('the', { ...settings, partial: false });

    expect(matcher?.exec('Feed them well')).toBeNull();
    expect(matcher?.exec('Feed the cat')?.[1]).toBe('the');
    expect(keywordMatcher('the', settings)?.exec('Feed them well')?.[1]).toBe('the');
  });

  it('can tell capital letters from small ones', () => {
    const matcher = keywordMatcher('Apple', { ...settings, caseSensitive: true });

    expect(matcher?.exec('an apple a day')).toBeNull();
    expect(matcher?.exec('Apple announced')?.[1]).toBe('Apple');
  });

  it('treats punctuation in a keyword as plain text', () => {
    const matcher = keywordMatcher('$5 (free)\nc++', settings);

    expect(matcher?.exec('only $5 (free) today')?.[1]).toBe('$5 (free)');
    expect(matcher?.exec('learning C++ fast')?.[1]).toBe('C++');
    expect(matcher?.exec('555 free')).toBeNull();
  });
});
