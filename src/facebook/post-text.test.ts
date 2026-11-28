import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstOf, Locators } from '../core/locator';
import { createLogger } from '../core/log';
import { hasPostText, postElements, postText } from './post-text';
import { fakeLocate, makePost, postHeader } from './testing';

/** A feed post as the end-to-end feed page draws one, with a comment that is not the post's text. */
const POST = `
  <div>
    ${postHeader('Avery Quill')}
    <div data-ad-rendering-role="story_message"><div dir="auto">Forty   pumpkins
      this weekend.</div></div>
    <img alt="A pile of pumpkins" src="data:,">
    <form>
      <div role="article" aria-label="Comment by Juno Park"><span dir="auto">Is this crypto?</span></div>
      <div role="textbox" contenteditable="true" aria-label="Write a comment"></div>
    </form>
    <div data-feed-sanity=""><span>Feed Sanity note</span></div>
    <span hidden>Hidden text</span>
  </div>`;

describe('postText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("joins the post's own text with single spaces, without comments or this project's elements", () => {
    const { content } = makePost(POST);

    expect(postText(content, fakeLocate)).toBe('Avery Quill Forty pumpkins this weekend.');
  });

  it('is empty for a post with no text', () => {
    const { content } = makePost('<div><img alt="x" src="data:,"></div>');

    expect(postText(content, fakeLocate)).toBe('');
  });
});

describe('hasPostText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is true once any text of its own is there', () => {
    expect(hasPostText(makePost(POST).content, fakeLocate)).toBe(true);
  });

  it('is false with only whitespace, comments or own elements', () => {
    const { content } = makePost(
      '<div>  </div><form><span>A comment</span></form><div data-feed-sanity=""><span>A note</span></div>',
    );

    expect(hasPostText(content, fakeLocate)).toBe(false);
  });
});

describe('postElements', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds matches outside the comments and own elements', () => {
    const { content } = makePost(POST);

    expect(postElements(content, 'span', fakeLocate).map((span) => span.textContent)).toEqual([
      'Avery Quill',
      'Hidden text',
    ]);
    expect(postElements(content, 'img', fakeLocate)).toHaveLength(1);
    expect(postElements(content, '[role=textbox]', fakeLocate)).toEqual([]);
  });

  it('does not count content itself, or what is around it, as excluded', () => {
    // In the comments popup the post is an article itself.
    const { content } = makePost(
      '<form><div role="article" id="popup-post"><a href="/x">Link</a></div></form>',
    );
    const article = content.querySelector<HTMLElement>('#popup-post');
    if (!article) {
      throw new Error('no article');
    }

    expect(postElements(article, 'a', fakeLocate)).toHaveLength(1);
    expect(postElements(content, 'a', fakeLocate)).toHaveLength(0);
  });

  it('falls through to the next strategy of a firstOf locator when every match is excluded', () => {
    const locate = new Locators(
      { resolve: (selector) => selector, onChange: () => () => undefined },
      [],
      createLogger('test'),
    ).locate;
    const target = firstOf('test-target', [
      { selector: 'b', seen: '2026' },
      { selector: 'i', seen: '2026' },
    ]);
    const { content } = makePost('<form><b>In a comment</b></form><i>Own</i>');

    expect(postElements(content, locate(target), locate).map((el) => el.textContent)).toEqual([
      'Own',
    ]);
  });

  it('finds nothing for a selector that does not parse, and does not throw', () => {
    const { content } = makePost(POST);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(postElements(content, 'div:not(', fakeLocate)).toEqual([]);
    expect(postElements(content, '[[', fakeLocate)).toEqual([]);
  });
});
