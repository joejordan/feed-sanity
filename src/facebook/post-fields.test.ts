import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { postTime, readPostFields, SPONSORED, TEXT_PARTS } from './post-fields';
import { fakeLocate, makePost, postHeader } from './testing';

const message = (text: string) =>
  `<div data-ad-rendering-role="story_message"><div dir="auto">${text}</div></div>`;

const COMMENTS = `
  <form>
    <div role="article" aria-label="Comment by Juno Park">
      <span dir="auto">Comment text #notmine</span>
      <a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fcomment.example%2F">comment link</a>
      <img alt="A comment sticker" src="data:,">
    </div>
  </form>`;

const fields = (html: string) => readPostFields(makePost(html).content, fakeLocate);

describe('readPostFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    history.replaceState({}, '', '/');
  });

  it("reads the post's text, body, header and author", () => {
    const post = fields(`
      <div data-ad-rendering-role="profile_name">
        <h4><span><a href="/avery.quill" role="link"><strong>Avery Quill</strong></a></span>
        <span> is with Bram Okafor</span></h4>
        <span><span> · </span><span>3 h</span></span>
      </div>
      ${message('Our garden harvested forty pumpkins.')}
      ${message('A second piece.')}
      ${COMMENTS}`);

    expect(post.get('author')).toBe('Avery Quill');
    expect(post.get('header')).toBe('Avery Quill is with Bram Okafor');
    expect(post.get('body')).toBe('Our garden harvested forty pumpkins.\nA second piece.');
    expect(post.get('text')).toBe(
      'Avery Quill is with Bram Okafor · 3 h Our garden harvested forty pumpkins. A second piece.',
    );
  });

  it('gives empty and null values for a post without those parts', () => {
    const post = fields('<div><span>Just text</span></div>');

    expect(post.get('body')).toBe('');
    expect(post.get('header')).toBeNull();
    expect(post.get('author')).toBeNull();
    expect(post.get('group')).toBeNull();
    expect(post.get('hashtags')).toBeNull();
    expect(post.get('link_urls')).toBeNull();
    expect(post.get('image_text')).toBeNull();
    expect(post.get('suggested')).toBeNull();
    expect(post.get('text_with_images')).toBe('Just text');
  });

  it('reads the author from an h3 on the Feeds pages', () => {
    const post = fields(
      '<div data-ad-rendering-role="profile_name"><h3><a href="/cleo"><strong>Cleo Marsh</strong></a></h3></div>',
    );

    expect(post.get('author')).toBe('Cleo Marsh');
  });

  it("uses the post's own header, not a shared post's", () => {
    const post = fields(`
      ${postHeader('Avery Quill')}
      ${message('Look at this')}
      <div role="article">${postHeader('Fennel Farm', 'Follow')}${message('Carrots')}</div>`);

    expect(post.get('author')).toBe('Avery Quill');
    expect(post.get('suggested')).toBeNull();
    expect(post.get('body')).toBe('Look at this\nCarrots');
  });

  it('reads the Follow or Join button as suggested, but not the verified badge', () => {
    expect(fields(postHeader('Fennel Farm', 'Follow', true)).get('suggested')).toBe('Follow');
    expect(fields(postHeader('Knitting Circle', 'Join')).get('suggested')).toBe('Join');
    expect(fields(postHeader('Bram Okafor', '', true)).get('suggested')).toBeNull();
    expect(
      fields(
        '<div data-ad-rendering-role="profile_name"><h4><a href="/x">X</a><span><span><span><div role="button" tabindex="0"></div></span></span></span></h4></div>',
      ).get('suggested'),
    ).toBe('suggested');
  });

  it('leaves the buttons out of the header', () => {
    const post = fields(postHeader('Fennel Farm', 'Follow', true));

    expect(post.get('header')).toBe('Fennel Farm');
  });

  it('reads hashtags, outbound links and image descriptions, outside the comments', () => {
    const post = fields(`
      ${postHeader('Avery Quill')}
      <div data-ad-rendering-role="story_message"><div dir="auto">
        Harvest <a href="/hashtag/pumpkins">#pumpkins</a> <a href="/hashtag/autumn">#autumn</a>
        <a href="/hashtag/pumpkins">#pumpkins</a>
        <a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fgarden.example%2Fpage%3Fa%3D1%26fbclid%3Dxyz&amp;h=AT0">garden.example</a>
        <a href="https://shop.example/seeds">Seeds</a>
        <a href="/l.php?u=https%3A%2F%2Fbulbs.example%2F">Bulbs</a>
        <a href="/avery.quill">Avery</a>
      </div></div>
      <img alt="A pile of pumpkins" src="data:,"><img alt="" src="data:,"><img alt="A pile of pumpkins" src="data:,">
      ${COMMENTS}`);

    expect(post.get('hashtags')).toEqual(['pumpkins', 'autumn']);
    expect(post.get('link_urls')).toEqual([
      'https://garden.example/page?a=1',
      'https://shop.example/seeds',
      'https://bulbs.example/',
    ]);
    expect(post.get('link_texts')).toEqual(['garden.example', 'Seeds', 'Bulbs']);
    expect(post.get('image_text')).toEqual(['A pile of pumpkins']);
    expect(post.get('text_with_images')).toBe(`${post.get('text')} A pile of pumpkins`);
  });

  it("reads the group from the post's own header", () => {
    const post = fields(`
      <div data-ad-rendering-role="profile_name"><h4>
        <span><a href="/avery.quill"><strong>Avery Quill</strong></a></span>
        <span> ▸ </span><span><a href="/groups/knitting.circle/">Knitting Circle</a></span>
      </h4></div>
      ${message('A scarf')}`);

    expect(post.get('group')).toBe('Knitting Circle');
  });

  it("reads the group from the page on a group's own page", () => {
    history.replaceState({}, '', '/groups/knitting.circle/');
    const heading = document.createElement('div');
    heading.setAttribute('role', 'main');
    heading.innerHTML = '<h1>Knitting Circle</h1>';
    document.body.append(heading);

    expect(fields(postHeader('Avery Quill')).get('group')).toBe('Knitting Circle');
    history.replaceState({}, '', '/groups/discover.knitting/');
    expect(fields(postHeader('Avery Quill')).get('group')).toBe('Knitting Circle');
    history.replaceState({}, '', '/groups/discover/');
    expect(fields(postHeader('Avery Quill')).get('group')).toBeNull();
  });

  it('caches each part until it is set, and leaves sponsored to post filters', () => {
    const { content } = makePost(`${postHeader('Avery Quill')}${message('Hello')}`);
    const post = readPostFields(content, fakeLocate);

    expect(post.get('body')).toBe('Hello');
    content.querySelector('[dir=auto]')?.replaceChildren('Changed');
    expect(post.get('body')).toBe('Hello');
    expect(readPostFields(content, fakeLocate).get('body')).toBe('Changed');

    expect(post.get('sponsored')).toBeNull();
    post.set('sponsored', SPONSORED);
    expect(post.get('sponsored')).toBe('sponsored');
    post.set('body', 'Replaced');
    expect(post.get('body')).toBe('Replaced');
    expect(post.get('no_such_part')).toBeNull();
  });

  it('gives the elements that make up each text part', () => {
    const { content } = makePost(`${postHeader('Avery Quill')}${message('Hello')}`);
    const post = readPostFields(content, fakeLocate);

    expect(post.textParts).toEqual(TEXT_PARTS);
    expect(post.elements('author').map((el) => el.textContent)).toEqual(['Avery Quill']);
    expect(post.elements('header')).toEqual([
      content.querySelector('[data-ad-rendering-role=profile_name]'),
    ]);
    expect(post.elements('body')).toEqual([
      content.querySelector('[data-ad-rendering-role=story_message]'),
    ]);
  });
});

describe('postTime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('reads a machine-readable time, and is null without one', () => {
    expect(postTime(makePost('<a href="/x">3 h</a>').content, fakeLocate)).toBeNull();
    expect(
      postTime(makePost('<time datetime="2026-11-13T10:00:00Z">3 h</time>').content, fakeLocate),
    ).toEqual(new Date('2026-11-13T10:00:00Z'));
  });
});
