import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOUNCE_MS,
  destination,
  feedShown,
  isAlternateHomeFeed,
  loader,
  movedRecently,
  moveTo,
  noteMove,
} from './rules';

const url = (address: string) => new URL(address, 'https://www.facebook.com');

describe('destination', () => {
  it('takes the plain home address to the saved feed', () => {
    expect(destination(url('/'), 'friends')).toBe('/?filter=friends&sk=h_chr');
    expect(destination(url('/home.php'), 'all')).toBe('/?filter=all&sk=h_chr');
    expect(destination(url('/'), 'favorites')).toBe('/?filter=favorites&sk=h_chr');
  });

  it("leaves the plain home address alone while Facebook's own feed is saved", () => {
    expect(destination(url('/'), 'home')).toBeNull();
    // A saved value from elsewhere, not one of the feeds.
    expect(destination(url('/'), 'gone')).toBeNull();
  });

  it('leaves every other address alone', () => {
    for (const address of [
      '/?filter=friends&sk=h_chr',
      '/?filter=groups&sk=h_chr',
      '/?sk=h_nor',
      '/?notif_id=12&notif_t=comment',
      '/groups/feed/',
      '/ann.author',
      '/watch/?v=1',
    ]) {
      expect(destination(url(address), 'friends'), address).toBeNull();
    }
  });

  it('never leads to an address it would change again', () => {
    for (const feed of ['home', 'friends', 'favorites', 'groups', 'pages', 'all']) {
      const to = destination(url('/'), feed);
      if (to !== null) {
        expect(destination(url(to), feed), feed).toBeNull();
      }
    }
  });
});

describe('feedShown', () => {
  it('names the feed the address shows', () => {
    expect(feedShown(url('/'))?.id).toBe('home');
    expect(feedShown(url('/home.php'))?.id).toBe('home');
    expect(feedShown(url('/?filter=pages&sk=h_chr'))?.id).toBe('pages');
    expect(feedShown(url('/?filter=all&sk=h_chr&ref=x'))?.id).toBe('all');
  });

  it('names none for any other page', () => {
    expect(feedShown(url('/?sk=h_chr'))).toBeNull();
    expect(feedShown(url('/groups/'))).toBeNull();
  });
});

describe('isAlternateHomeFeed', () => {
  it('is true on Friends, Favorites, Groups, Pages, Most recent and ?sk=h_chr, and false on Home and other pages', () => {
    for (const address of [
      '/?filter=friends&sk=h_chr',
      '/?filter=favorites&sk=h_chr',
      '/?filter=groups&sk=h_chr',
      '/?filter=pages&sk=h_chr',
      '/?filter=all&sk=h_chr',
      '/?sk=h_chr',
    ]) {
      expect(isAlternateHomeFeed(url(address)), address).toBe(true);
    }
    for (const address of ['/', '/home.php', '/?sk=h_nor', '/groups/feed/', '/some.user']) {
      expect(isAlternateHomeFeed(url(address)), address).toBe(false);
    }
  });
});

describe('noteMove and movedRecently', () => {
  beforeEach(() => sessionStorage.clear());

  it(`counts a move for ${BOUNCE_MS / 1000} seconds`, () => {
    expect(movedRecently(5000)).toBe(false);

    noteMove(5000);

    expect(movedRecently(5000)).toBe(true);
    expect(movedRecently(5000 + BOUNCE_MS - 1)).toBe(true);
    expect(movedRecently(5000 + BOUNCE_MS)).toBe(false);
    // A clock that went back.
    expect(movedRecently(4000)).toBe(false);
  });
});

describe('moveTo', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it("goes through one of Facebook's own links to the address when the page has one", () => {
    document.body.innerHTML = '<a href="/?filter=friends&sk=h_chr">Friends</a>';
    const link = document.querySelector('a') as HTMLAnchorElement;
    const clicked = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', clicked);
    const assign = vi.spyOn(loader, 'assign').mockImplementation(() => undefined);

    moveTo('/?filter=friends&sk=h_chr');

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(movedRecently()).toBe(true);
  });

  it('loads the address when the page has no link to it', () => {
    const assign = vi.spyOn(loader, 'assign').mockImplementation(() => undefined);

    moveTo('/?filter=friends&sk=h_chr');

    expect(assign).toHaveBeenCalledWith('/?filter=friends&sk=h_chr');
  });

  it('replaces the address and loads it when asked to, link or no link', () => {
    document.body.innerHTML = '<a href="/?filter=friends&sk=h_chr">Friends</a>';
    const clicked = vi.fn();
    document.querySelector('a')?.addEventListener('click', clicked);
    const replace = vi.spyOn(loader, 'replace').mockImplementation(() => undefined);

    moveTo('/?filter=friends&sk=h_chr', { replace: true });

    expect(replace).toHaveBeenCalledWith('/?filter=friends&sk=h_chr');
    expect(clicked).not.toHaveBeenCalled();
  });
});
