import { describe, expect, it } from 'vitest';
import { readPostFields } from './post-fields';
import { fakeLocate as locate } from './testing';

function fieldsOf(html: string, before = '') {
  document.body.innerHTML = `${before}<div role="article">${html}</div>`;
  return readPostFields(document.body.lastElementChild as Element, locate);
}

describe('readPostFields', () => {
  it('finds the author in the heading, and the header line around it', () => {
    const fields = fieldsOf(
      `<div data-ad-rendering-role="profile_name">
         <h4><a><strong>Ann Author</strong></a> shared a memory</h4> · <span>2h</span>
       </div>`,
    );

    expect(fields.get('author')).toBe('Ann Author');
    expect(fields.get('action')).toBe('Ann Author shared a memory');
    expect(fields.elements('author')[0]?.tagName).toBe('STRONG');
  });

  it('falls back to the first profile link for the author', () => {
    const fields = fieldsOf(
      `<a class="S2F_disp_inl" href="https://www.facebook.com/hashtag/x">#x</a>
       <a class="S2F_disp_inl" href="https://www.facebook.com/ann">Ann Author</a>
       <img alt="">
       <a class="S2F_disp_inl" href="https://www.facebook.com/bob">Bob</a>`,
    );

    expect(fields.get('author')).toBe('Ann Author');
  });

  it('reads the message apart from the rest of the post', () => {
    const fields = fieldsOf(
      `<h4><b>Ann</b></h4>
       <div data-ad-rendering-role="story_message"><span>Look at</span> <span>this</span></div>
       <div role="article"><div data-ad-rendering-role="story_message">a comment</div></div>`,
    );

    expect(fields.get('content')).toBe('Look at this');
    expect(fields.get('all_content')).toBe('Ann Look at this');
  });

  it('lists links out of Facebook, hashtags and photo descriptions once each', () => {
    const fields = fieldsOf(
      `<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa&h=1">Example</a>
       <a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa&h=2">Example</a>
       <a href="/hashtag/cats">#cats</a><a href="/hashtag/dogs">dogs</a>
       <img alt="A cat"><img alt="A cat"><img alt="">`,
    );

    expect(fields.get('link_url')).toEqual(['https://example.com/a']);
    expect(fields.get('link_text')).toEqual(['Example']);
    expect(fields.get('hashtag')).toEqual(['cats']);
    expect(fields.get('image')).toEqual(['A cat']);
  });

  it('gives null for parts the post does not have', () => {
    const fields = fieldsOf('<p>Just text</p>');

    for (const name of ['author', 'group', 'page', 'app', 'image', 'link_url', 'hashtag']) {
      expect(fields.get(name)).toBeNull();
    }
    expect(fields.get('content')).toBe('');
  });

  it('finds the group in the page heading, then in the post', () => {
    const inPage = fieldsOf(
      '<p>Text</p>',
      '<div role="main"><h1><a class="S2F_font_700" href="/groups/1/">Page Group</a></h1></div>',
    );
    expect(inPage.get('group')).toBe('Page Group');

    const inPost = fieldsOf(
      `<div class="S2F_bb_1pxdiv"><a class="S2F_col_tx1" aria-label="Shared Group" href="/groups/2/">x</a></div>
       <a class="S2F_col_tx1" aria-label="Post Group" href="/groups/3/">x</a>`,
    );
    expect(inPost.get('group')).toBe('Post Group');
  });

  it('remembers a value that was set, and names unknown parts as Social Fixer did', () => {
    const fields = fieldsOf('<h4><b>Ann</b></h4>');

    fields.set('author', 'Someone');

    expect(fields.get('author')).toBe('Someone');
    expect(fields.get('nonsense')).toBe(['$', '{nonsense}'].join(''));
  });
});
