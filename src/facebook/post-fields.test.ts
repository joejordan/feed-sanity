import { describe, expect, it } from 'vitest';
import { readPostFields } from './post-fields';
import { postHeader as header, fakeLocate as locate } from './testing';

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

  describe('suggested', () => {
    it('is null for a post from a friend or a followed page', () => {
      expect(fieldsOf(`${header('Ann Author')}<p>Hello</p>`).get('suggested')).toBeNull();
    });

    it('is null for an ad, which has no button in its heading', () => {
      const ad = `<div data-ad-rendering-role="profile_name"><h4><strong>Shop</strong></h4><span>Sponsored</span></div>`;
      expect(fieldsOf(ad).get('suggested')).toBeNull();
    });

    it("is the button's text for a page or a group to follow or join", () => {
      expect(fieldsOf(header('Garden Page', 'Follow')).get('suggested')).toBe('Follow');
      expect(fieldsOf(header('Garden Group', 'Join')).get('suggested')).toBe('Join');
    });

    it("is null for a verified page's badge alone, which is a button too", () => {
      expect(fieldsOf(header('Garden Page', '', true)).get('suggested')).toBeNull();
    });

    it('takes a button with a label, or with an icon, for a badge', () => {
      const badge = (inside: string) =>
        `<div data-ad-rendering-role="profile_name"><h4><span><a href="/x"><strong>Garden Page</strong></a></span><span>${inside}</span></h4></div>`;
      const labelled = '<div role="button" tabindex="0" aria-label="Verified account"></div>';
      const drawn = '<div role="button" tabindex="0"><svg viewBox="0 0 12 12"></svg></div>';
      expect(fieldsOf(badge(labelled)).get('suggested')).toBeNull();
      expect(fieldsOf(badge(drawn)).get('suggested')).toBeNull();
    });

    it('is the text of the Follow button when the verified badge comes before it', () => {
      expect(fieldsOf(header('Garden Page', 'Follow', true)).get('suggested')).toBe('Follow');
    });

    it('is still known when the button has no text', () => {
      const fields = fieldsOf(header('Garden Page', '<span></span>'));
      expect(fields.get('suggested')).toBe('suggested');
    });

    it("counts only the post's own header, not a shared post's", () => {
      const shared = fieldsOf(
        `${header('Ann Author')}<div class="attachment">${header('Garden Page', 'Follow')}</div>`,
      );
      expect(shared.get('suggested')).toBeNull();

      const sharedBySuggested = fieldsOf(
        `${header('Garden Page', 'Follow')}<div class="attachment">${header('Ann Author')}</div>`,
      );
      expect(sharedBySuggested.get('suggested')).toBe('Follow');
    });

    it('takes no button from the comments', () => {
      const fields = fieldsOf(
        `<p>Hello</p><form><div role="article">${header('Bob', 'Follow')}</div></form>`,
      );
      expect(fields.get('suggested')).toBeNull();
    });

    it('is found once a header that arrived late is there', () => {
      document.body.innerHTML = '<div role="article"><p>Hello</p></div>';
      const post = document.body.lastElementChild as Element;
      expect(readPostFields(post, locate).get('suggested')).toBeNull();

      post.insertAdjacentHTML('afterbegin', header('Garden Page', 'Follow'));

      expect(readPostFields(post, locate).get('suggested')).toBe('Follow');
    });
  });

  it('leaves sponsored to be set from React data', () => {
    const fields = fieldsOf('<p>Buy now</p>');
    expect(fields.get('sponsored')).toBeNull();

    fields.set('sponsored', 'sponsored');
    expect(fields.get('sponsored')).toBe('sponsored');
  });

  it('remembers a value that was set, and names unknown parts as Social Fixer did', () => {
    const fields = fieldsOf('<h4><b>Ann</b></h4>');

    fields.set('author', 'Someone');

    expect(fields.get('author')).toBe('Someone');
    expect(fields.get('nonsense')).toBe(['$', '{nonsense}'].join(''));
  });
});
