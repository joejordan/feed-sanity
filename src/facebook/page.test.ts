import { describe, expect, it } from 'vitest';
import { pageContext } from './page';

const context = (address: string) => pageContext(new URL(address, 'https://www.facebook.com'));

describe('pageContext', () => {
  it.each([
    ['/', 'newsfeed', null],
    ['/home.php', 'newsfeed', null],
    ['/marketplace', 'marketplace', null],
    ['/marketplace/you/', 'marketplace', 'you'],
    ['/marketplace/category/electronics', 'marketplace', 'electronics'],
    ['/messages/t/12345', 'messages', '12345'],
    ['/messages/new', 'messages', null],
    ['/some.user', 'profile', 'some.user'],
    ['/some.user/posts/123456789', 'profile', 'some.user'],
    ['/pg/somepage/posts/', 'profile', 'somepage'],
    ['/groups/gardening/', 'groups', 'gardening'],
    ['/events/123456789/', 'events', '123456789'],
  ])('reads %s as %s / %s', (address, type, id) => {
    expect(context(address)).toMatchObject({ type, id });
  });

  it('reads a messenger.com conversation', () => {
    expect(pageContext(new URL('https://www.messenger.com/t/12345'))).toMatchObject({
      type: 'messages',
      id: '12345',
    });
  });

  it.each([
    '/some.user/posts/123456789',
    '/some.user/posts/pfbid02abc',
    '/permalink.php?story_fbid=123456789&id=987654321',
    '/media/set/?set=a.123&notif_id=456',
    '/groups/gardening?view=permalink&id=123456789',
    '/groups/gardening/?multi_permalinks=123456789',
    '/groups/gardening/posts/123456789',
    '/groups/gardening/permalink/123456789',
  ])('treats %s as a permalink', (address) => {
    expect(context(address).permalink).toBe(true);
  });

  it.each([
    '/',
    '/some.user',
    '/groups/gardening/',
    '/some.user/posts/',
    '/watch/?v=123456789',
    '/photo/?fbid=123456789&set=a.987654321',
    '/reel/123456789',
  ])('does not treat %s as a permalink', (address) => {
    expect(context(address)).toMatchObject({ permalink: false, singlePost: false });
  });

  it.each([
    '/some.user/posts/123456789',
    '/some.user/posts/pfbid02abc',
    '/permalink.php?story_fbid=123456789&id=987654321',
    '/groups/gardening?view=permalink&id=123456789',
    '/groups/gardening/posts/123456789',
    '/groups/gardening/permalink/123456789',
  ])('treats %s as a single post', (address) => {
    expect(context(address).singlePost).toBe(true);
  });

  it.each([
    '/events/123456789012/?notif_id=1699999999999999',
    '/media/set/?set=a.123&notif_id=456',
    '/groups/gardening/?multi_permalinks=123456789',
    '/groups/gardening/?multi_permalinks=111111111,222222222',
  ])('treats %s as a permalink that may show several posts', (address) => {
    expect(context(address)).toMatchObject({ permalink: true, singlePost: false });
  });
});
