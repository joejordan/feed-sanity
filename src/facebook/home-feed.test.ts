import { beforeEach, describe, expect, it } from 'vitest';
import { feedAddress, isPlainHome, linkTo, shows } from './home-feed';

const url = (address: string) => new URL(address, 'https://www.facebook.com');

describe('isPlainHome', () => {
  it('is true for the home paths with nothing in the query', () => {
    for (const address of ['/', '/home.php', '/?', '/#top']) {
      expect(isPlainHome(url(address)), address).toBe(true);
    }
  });

  it('is false for any other address, and for the home path with a query', () => {
    for (const address of [
      '/?filter=friends&sk=h_chr',
      '/?sk=h_nor',
      '/?sk=h_chr',
      '/?notif_id=1&ref=notif',
      '/home.php?ref=bookmarks',
      '/groups/',
      '/friends/',
      '/ann.author',
    ]) {
      expect(isPlainHome(url(address)), address).toBe(false);
    }
  });
});

describe('shows', () => {
  it("matches an address with every part of the feed's query", () => {
    expect(shows(url('/?filter=friends&sk=h_chr'), feedAddress('friends'))).toBe(true);
    expect(shows(url('/?sk=h_chr&filter=friends&ref=x'), feedAddress('friends'))).toBe(true);
    expect(shows(url('/home.php?filter=friends&sk=h_chr'), feedAddress('friends'))).toBe(true);
    expect(shows(url('/?filter=groups&sk=h_chr'), feedAddress('friends'))).toBe(false);
    expect(shows(url('/?filter=friends'), feedAddress('friends'))).toBe(false);
    expect(shows(url('/groups/?filter=friends&sk=h_chr'), feedAddress('friends'))).toBe(false);
  });

  it('matches the plain home address only with an empty query', () => {
    expect(shows(url('/'), '/')).toBe(true);
    expect(shows(url('/home.php'), '/')).toBe(true);
    expect(shows(url('/?sk=h_nor'), '/')).toBe(false);
  });
});

describe('linkTo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it("finds one of Facebook's links to the address", () => {
    document.body.innerHTML = `
      <a href="https://example.com/?filter=friends&sk=h_chr">Elsewhere</a>
      <a href="/?filter=friends&sk=h_chr" target="_blank">New tab</a>
      <div data-feed-sanity><a href="/?filter=friends&sk=h_chr">Ours</a></div>
      <a href="/?filter=groups&sk=h_chr">Groups</a>
      <a href="/?filter=friends&sk=h_chr">Friends</a>`;

    expect(linkTo(feedAddress('friends'))?.textContent).toBe('Friends');
    expect(linkTo(feedAddress('pages'))).toBeNull();
  });

  it('finds a link to the plain home address, and no link with a query in its place', () => {
    document.body.innerHTML = '<a href="/?ref=logo">Logo</a><a href="/">Home</a>';

    expect(linkTo('/')?.textContent).toBe('Home');
  });
});
