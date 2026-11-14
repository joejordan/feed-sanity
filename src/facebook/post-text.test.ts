import { describe, expect, it } from 'vitest';
import { postCaptions, postText } from './post-text';

function post(html: string, attributes = ''): Element {
  document.body.innerHTML = `<div ${attributes}>${html}</div>`;
  return document.body.firstElementChild as Element;
}

describe('postText', () => {
  it('reads a post in the comments popup from the post inside the popup', () => {
    const dialog = post(
      `<h2>Ann's post</h2>
       <div role="article">
         <p>The message</p>
         <div role="article" aria-label="Comment by Bob">A comment <img alt="In a comment"></div>
         <img alt="In the post">
       </div>`,
      'role="dialog" aria-labelledby="x"',
    );
    const content = dialog.querySelector('[role=article]') as Element;

    expect(postText(content)).toBe('The message');
    expect(postCaptions(content)).toEqual(['In the post']);
  });

  it('joins the pieces of text with single spaces', () => {
    const element = post(
      '<h4><a>Ann Author</a></h4><div><span>Hello</span><b>world</b>\n  !</div>',
    );

    expect(postText(element)).toBe('Ann Author Hello world !');
  });

  it('leaves out comments, the comment area and what this project added', () => {
    const element = post(
      `<p>The message</p>
       <div role="article">A comment</div>
       <form>Write a comment</form>
       <button data-feed-sanity="x">Post Hidden by keyword</button>`,
      'role="article"',
    );

    expect(postText(element)).toBe('The message');
  });
});

describe('postCaptions', () => {
  it('lists the descriptions of the photos in the post, not in its comments', () => {
    const element = post(
      `<img alt="A sunset"><img alt=" "><img>
       <div role="article"><img alt="A reply photo"></div>`,
      'role="article"',
    );

    expect(postCaptions(element)).toEqual(['A sunset']);
  });
});
