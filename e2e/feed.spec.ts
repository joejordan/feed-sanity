import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { Filter } from '../src/core/filter-types';
import { OPTIONS_TITLE } from '../project';
import { FEED_FILTERING, MARK, NO_POST_ID, POST_CHECKED } from '../src/facebook/selectors';
import {
  CUSTOM_STYLESHEET_LINK_ID,
  CUSTOM_STYLESHEET_URL_KEY,
} from '../src/features/custom-stylesheet/model';
import {
  FILTER_NOTE_CLASS,
  FILTERED_ATTR,
  FILTERED_HIDDEN,
  FILTERED_SHOWN,
} from '../src/features/post-filters/markers';
import { NOTE_HIDE, NOTE_SHOW, NOTE_TOGGLE_CLASS } from '../src/features/post-filters/notes';
import { READ_ATTR, READ_NOTE_CLASS } from '../src/features/read-posts/markers';
import { expect, FILTERS_KEY, OPTIONS_KEY, ORIGIN, READ_HISTORY_KEY, test } from './extension';

const FEED = `${ORIGIN}/`;

/** The feed slot of the post by `author`. */
const slot = (page: Page, author: string) =>
  page.locator('[aria-posinset]').filter({ has: page.locator('h4', { hasText: author }) });

const noteOf = (page: Page, author: string) => slot(page, author).locator(`.${FILTER_NOTE_CLASS}`);

const messageOf = (page: Page, author: string) =>
  slot(page, author).locator('[data-ad-rendering-role=story_message]');

/** Waits until the post by `author` is hidden behind exactly one note, and returns the note. */
async function expectHidden(page: Page, author: string) {
  await expect(slot(page, author)).toHaveAttribute(FILTERED_ATTR, FILTERED_HIDDEN);
  // Strict: fails if the post has more than one note.
  await expect(noteOf(page, author)).toBeVisible();
  await expect(noteOf(page, author).locator(`.${NOTE_TOGGLE_CLASS}`)).toHaveText(NOTE_SHOW);
  await expect(messageOf(page, author)).toBeHidden();
  return noteOf(page, author);
}

/** Checks that the post by `author` was found and left alone. */
async function expectShown(page: Page, author: string) {
  // The filters run as soon as a post is found, well before its ID is known,
  // so by then they have had their chance to hide it.
  await expect(slot(page, author)).toHaveAttribute(MARK.postId);
  await expect(slot(page, author)).not.toHaveAttribute(FILTERED_ATTR);
  await expect(noteOf(page, author)).toHaveCount(0);
  await expect(messageOf(page, author)).toBeVisible();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: OPTIONS_TITLE });

test('starts on a Facebook page and applies a saved option there', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { [CUSTOM_STYLESHEET_URL_KEY]: `${ORIGIN}/external.css` } });

  await page.goto(FEED);

  const link = page.locator(`link#${CUSTOM_STYLESHEET_LINK_ID}`);
  await expect(link).toHaveAttribute('href', `${ORIGIN}/external.css`);
  const marker = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--e2e-external-css').trim(),
    );
  await expect.poll(marker).toBe('loaded');

  // Clearing the option takes the stylesheet away without a reload.
  await store({ [OPTIONS_KEY]: { [CUSTOM_STYLESHEET_URL_KEY]: '' } });
  await expect(link).toHaveCount(0);
  await expect.poll(marker).toBe('');
});

test('finds every post in the feed and reads its ID from the time link', async ({
  page,
  store,
}) => {
  // A keyword that matches nothing, so no post is hidden.
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'zebra' } });

  await page.goto(FEED);

  await expect(slot(page, 'Avery Quill')).toHaveAttribute(MARK.postId, '100000000000001');
  await expect(slot(page, 'Bram Okafor')).toHaveAttribute(MARK.postId, '100000000000002');
  await expect(slot(page, 'Cleo Marsh')).toHaveAttribute(MARK.postId, '100000000000003');
  await expect(slot(page, 'Ines Harrow')).toHaveAttribute(MARK.postId, '100000000000005');
  // Arrives after the others have been marked.
  await expect(slot(page, 'Dara Venn')).toHaveAttribute(MARK.postId, '100000000000006');
  // The sponsored post has no time link, so it has no ID.
  await expect(slot(page, 'Sourdough School')).toHaveAttribute(MARK.postId, NO_POST_ID);
  // Comments are articles too, and are not posts.
  await expect(page.locator(`form [${MARK.post}]`)).toHaveCount(0);
  await expect(page.locator(`[${MARK.post}]`)).toHaveCount(6);
  await expect(page.locator(`[${FILTERED_ATTR}]`)).toHaveCount(0);
});

test('hides posts that match a saved keyword behind a note that shows them', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });

  await page.goto(FEED);

  const note = await expectHidden(page, 'Cleo Marsh');
  await expect(note).toHaveText(`Hidden: mentions “crypto”${NOTE_SHOW}`);
  // A comment under this post says "crypto". Comments are not the post's own text.
  await expectShown(page, 'Avery Quill');
  await expectShown(page, 'Bram Okafor');
  await expectShown(page, 'Sourdough School');

  await note.click();
  await expect(slot(page, 'Cleo Marsh')).toHaveAttribute(FILTERED_ATTR, FILTERED_SHOWN);
  await expect(messageOf(page, 'Cleo Marsh')).toBeVisible();
  await expect(note).toHaveAttribute('aria-expanded', 'true');
  await expect(note.locator(`.${NOTE_TOGGLE_CLASS}`)).toHaveText(NOTE_HIDE);

  await note.click();
  await expect(slot(page, 'Cleo Marsh')).toHaveAttribute(FILTERED_ATTR, FILTERED_HIDDEN);
  await expect(messageOf(page, 'Cleo Marsh')).toBeHidden();

  // Clearing the keywords gives every post back, without a reload.
  await store({ [OPTIONS_KEY]: { hidden_keywords: '' } });
  await expectShown(page, 'Cleo Marsh');
  await expect(page.locator(`[${FILTERED_ATTR}]`)).toHaveCount(0);
  await expect(page.locator(`.${FILTER_NOTE_CLASS}`)).toHaveCount(0);
});

test('hides keyword posts without a trace with notes turned off', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto', post_filters_notes: false } });

  await page.goto(FEED);

  await expect(slot(page, 'Cleo Marsh')).toHaveAttribute(FILTERED_ATTR, FILTERED_HIDDEN);
  await expect(slot(page, 'Cleo Marsh')).toBeHidden();
  await expectShown(page, 'Bram Okafor');
  await expect(page.locator(`.${FILTER_NOTE_CLASS}`)).toHaveCount(0);

  // Turning notes back on puts the note where the post was.
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto', post_filters_notes: true } });
  await expectHidden(page, 'Cleo Marsh');
});

/** A saved filter that hides Bram Okafor's posts, in the saved filter format. */
const NO_SALES = {
  id: 'f-e2e-no-sales',
  name: 'No sales',
  enabled: true,
  join: 'all',
  stopAfter: false,
  conditions: [{ kind: 'text', part: 'author', test: 'contains', values: ['Bram Okafor'] }],
  actions: [{ kind: 'hide', note: true }],
} satisfies Filter;

test('hides posts with a filter saved under the filters key', async ({ page, store }) => {
  await store({ [FILTERS_KEY]: [NO_SALES] });

  await page.goto(FEED);

  const note = await expectHidden(page, 'Bram Okafor');
  await expect(note).toHaveText(`Post hidden by your “No sales” filter${NOTE_SHOW}`);
  await expectShown(page, 'Cleo Marsh');
});

test('follows a keyword changed in storage while the page is open', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Cleo Marsh');
  // Gone if the page loads again.
  await page.evaluate(() => {
    document.documentElement.dataset.sameLoad = 'true';
  });

  await store({ [OPTIONS_KEY]: { hidden_keywords: 'typewriter' } });

  await expectHidden(page, 'Bram Okafor');
  await expectShown(page, 'Cleo Marsh');
  await expect(page.locator('html')).toHaveAttribute('data-same-load', 'true');
});

test('filters a post added after load and puts the note back in a refilled post', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });

  await page.goto(FEED);

  await expectHidden(page, 'Dara Venn');
  // The page empties this slot once its note appears, which removes the note,
  // and fills it again with the same post.
  await expect(slot(page, 'Ines Harrow')).toHaveAttribute('data-refilled', 'true');
  await expectHidden(page, 'Ines Harrow');
  // It was emptied before its ID was looked up, and is identified once refilled.
  await expect(slot(page, 'Ines Harrow')).toHaveAttribute(MARK.postId, '100000000000005');
});

// The button itself is not clicked. See `pressToolbarButton` in extension.ts.
test('opens the options dialog from the toolbar button', async ({ page, pressToolbarButton }) => {
  await page.goto(FEED);
  await expect(dialog(page)).toHaveCount(0);

  await pressToolbarButton();

  await expect(dialog(page)).toBeVisible();
  // Drawn in a shadow root of its own.
  const host = page.locator('feed-sanity-ui#feed_sanity_options');
  expect(await host.evaluate((element) => element.shadowRoot?.mode)).toBe('open');

  // Opens on Filtering first with quick shields, and lists Feed & Reading options cleanly.
  await expect(dialog(page).getByRole('checkbox', { name: 'Hide suggested posts' })).toBeVisible();
  await expect(dialog(page).getByRole('checkbox', { name: 'Hide ads' })).toBeVisible();
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Check new posts before they appear' }),
  ).toBeVisible();

  await dialog(page).getByRole('button', { name: 'Feed & Reading', exact: true }).click();
  await expect(dialog(page).getByRole('combobox', { name: 'Feed on the Home page' })).toBeVisible();
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Feed menu on the Home button' }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Post box on other feeds' }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('checkbox', {
      name: 'Home sidebars and responsive layout on other feeds',
    }),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('checkbox', { name: 'Stop automatic feed refresh' }),
  ).toBeVisible();
});

test('saves a setting changed in the options dialog to extension storage', async ({
  page,
  pressToolbarButton,
  stored,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();

  await dialog(page)
    .getByRole('button', { name: /Bulk Keyword Blocklist/i })
    .click();
  await dialog(page).getByRole('textbox', { name: 'Hide posts that mention' }).fill('typewriter');
  await dialog(page).getByRole('button', { name: 'Apply' }).click();
  await dialog(page).getByRole('button', { name: 'Close' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ hidden_keywords: 'typewriter' }));
  await expectHidden(page, 'Bram Okafor');
});

test('keeps the toolbar badge free of hidden-post numbers as keywords change', async ({
  page,
  store,
  badgeText,
}) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });
  await page.goto(FEED);

  // Cleo Marsh, Ines Harrow and Dara Venn, who arrives late. Wait past the 100 ms
  // badge debounce so we verify the settled toolbar badge stays empty.
  await expectHidden(page, 'Dara Venn');
  await page.waitForTimeout(250);
  await expect(badgeText()).resolves.toBe('');

  await store({ [OPTIONS_KEY]: { hidden_keywords: 'typewriter' } });
  await expectHidden(page, 'Bram Okafor');
  await page.waitForTimeout(250);
  await expect(badgeText()).resolves.toBe('');

  await store({ [OPTIONS_KEY]: { hidden_keywords: '' } });
  await expectShown(page, 'Bram Okafor');
  await page.waitForTimeout(250);
  await expect(badgeText()).resolves.toBe('');
});

test('shows the running features and the post counts under Diagnostics', async ({
  page,
  store,
  pressToolbarButton,
}) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Dara Venn');
  await pressToolbarButton();

  await dialog(page).getByRole('button', { name: 'Diagnostics', exact: true }).click();

  const postFilters = dialog(page).getByRole('row', { name: /post_filters/ });
  await expect(postFilters.getByRole('cell', { name: 'running', exact: true })).toBeVisible();
  // The sponsored post has no time link, so it has no ID.
  await expect(
    dialog(page).getByText(
      '6 posts on the page: 5 with an ID, 1 without one, 0 still being identified.',
    ),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('Feed slots with content not taken for posts: 0.'),
  ).toBeVisible();
  await dialog(page)
    .getByRole('button', { name: /Locator inspector & custom selectors/ })
    .click();
  await expect(
    dialog(page).getByRole('rowheader', { name: /^feed-slot any, \d+ lookups/ }),
  ).toBeVisible();
});

test('says under Diagnostics when post detection has not started', async ({
  page,
  store,
  pressToolbarButton,
}) => {
  // Both suggested-post hiding and read posts are on by default and start post detection.
  await store({ [OPTIONS_KEY]: { hide_suggested_posts: false, read_posts: false } });
  await page.goto(FEED);
  await pressToolbarButton();

  await dialog(page).getByRole('button', { name: 'Diagnostics', exact: true }).click();

  await expect(dialog(page).getByText(/^Post detection has not started/)).toBeVisible();
});

test('finds the posts on a page reached without a reload', async ({ page, store, badgeText }) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Cleo Marsh');

  await page.getByRole('link', { name: 'Most recent' }).click();

  await expect(page).toHaveURL(`${ORIGIN}/?sk=h_chr`);
  await expect(slot(page, 'Cleo Marsh')).toHaveCount(0);
  await expectHidden(page, 'Elio Brandt');
  await expectShown(page, 'Fern Adair');
  await expect(slot(page, 'Fern Adair')).toHaveAttribute(MARK.postId, '100000000000008');
  await expect.poll(badgeText).toBe('');
});

/** The feed with the posts Facebook suggests. */
const SUGGESTED_FEED = `${ORIGIN}/?e2e=suggested`;

test('hides suggested posts by default and says why', async ({ page, badgeText }) => {
  await page.goto(SUGGESTED_FEED);

  const followNote = await expectHidden(page, 'Fennel Farm');
  await expect(followNote).toHaveText(`Hidden because Facebook suggested it${NOTE_SHOW}`);
  await expectHidden(page, 'Knitting Circle');
  await expectShown(page, 'Avery Quill');
  await expectShown(page, 'Bram Okafor');
  // Ads have no button by the name, and are left alone unless they are hidden too.
  await expectShown(page, 'Sourdough School');
  await expect.poll(badgeText).toBe('');

  await followNote.click();
  await expect(messageOf(page, 'Fennel Farm')).toBeVisible();
});

test('leaves suggested posts alone with their option off', async ({ page, store, badgeText }) => {
  await store({ [OPTIONS_KEY]: { hide_suggested_posts: false, hidden_keywords: 'zebra' } });

  await page.goto(SUGGESTED_FEED);

  await expectShown(page, 'Fennel Farm');
  await expectShown(page, 'Knitting Circle');
  await expect.poll(badgeText).toBe('');
});

test("hides ads with that option on, from React's data read through the page-world bridge", async ({
  page,
  store,
  badgeText,
}) => {
  await store({ [OPTIONS_KEY]: { hide_sponsored_posts: true } });

  await page.goto(SUGGESTED_FEED);

  // The page-world bridge answers that the post is an ad, from its React data.
  const note = await expectHidden(page, 'Sourdough School');
  await expect(note).toHaveText(`Hidden because it is an ad${NOTE_SHOW}`);
  await expectShown(page, 'Avery Quill');
  await expectHidden(page, 'Fennel Farm');
  await expect.poll(badgeText).toBe('');

  await store({ [OPTIONS_KEY]: { hide_sponsored_posts: false } });
  await expectShown(page, 'Sourdough School');
  await expect.poll(badgeText).toBe('');
});

test('leaves ads alone by default', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'zebra' } });

  await page.goto(FEED);

  await expectShown(page, 'Sourdough School');
});

test('hides newly inserted ads and suggested posts immediately before first paint without waiting for ID lookup', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { hide_sponsored_posts: true, hide_suggested_posts: true } });

  await page.goto(SUGGESTED_FEED);
  await expectHidden(page, 'Sourdough School');
  await expect(page.locator('html')).toHaveAttribute(FEED_FILTERING, '');

  // Insert a fresh sponsored post (with no time link) and a fresh suggested post,
  // and check on the very first animation frame that neither flashes visible.
  const result = await page.evaluate(
    ({ filtered, postId, checked }) =>
      new Promise<{
        adHiddenOnFirstFrame: boolean;
        adHasIdYet: boolean;
        sugHiddenOnFirstFrame: boolean;
        normalCheckedOnFirstFrame: boolean;
      }>((resolve) => {
        const feed = document.querySelector('#feed') as HTMLElement;
        const makeSlot = (pos: string, html: string, sponsored: boolean) => {
          const el = document.createElement('div');
          el.setAttribute('aria-posinset', pos);
          el.setAttribute('aria-setsize', '-1');
          el.setAttribute('role', 'article');
          el.innerHTML = html;
          const feedUnit = {
            __typename: 'Story',
            id: `e2e-${pos}`,
            sponsored_data: sponsored ? { ad_id: '6000000000009' } : null,
          };
          let fiber: Record<string, unknown> = { memoizedProps: { feedUnit }, return: null };
          for (let step = 0; step < 14; step++) {
            fiber = { memoizedProps: { className: `level-${step}` }, return: fiber };
          }
          Object.assign(el, { '__reactFiber$e2e': fiber });
          feed.append(el);
          return el;
        };

        const ad = makeSlot(
          '91',
          '<div><div data-ad-rendering-role="profile_name"><h4><a href="/ad.co"><strong>Instant Ad</strong></a></h4></div><div data-ad-rendering-role="story_message">Buy fast</div></div>',
          true,
        );
        const sug = makeSlot(
          '92',
          '<div><div data-ad-rendering-role="profile_name"><h4><span><a href="/sug.co"><strong>Instant Sug</strong></a></span><span><span><span><div role="button" tabindex="0">Follow</div></span></span></span></h4></div><div data-ad-rendering-role="story_message">Follow us</div></div>',
          false,
        );
        const normal = makeSlot(
          '93',
          '<div><div data-ad-rendering-role="profile_name"><h4><a href="/friend.co"><strong>Instant Friend</strong></a></h4></div><div data-ad-rendering-role="story_message">Hello world</div></div>',
          false,
        );

        requestAnimationFrame(() => {
          resolve({
            adHiddenOnFirstFrame: ad.hasAttribute(filtered),
            adHasIdYet: ad.hasAttribute(postId),
            sugHiddenOnFirstFrame: sug.hasAttribute(filtered),
            normalCheckedOnFirstFrame: normal.hasAttribute(checked),
          });
        });
      }),
    { filtered: FILTERED_ATTR, postId: MARK.postId, checked: POST_CHECKED },
  );

  expect(result).toEqual({
    adHiddenOnFirstFrame: true,
    adHasIdYet: false,
    sugHiddenOnFirstFrame: true,
    normalCheckedOnFirstFrame: true,
  });
});

test('marks posts as read, persists across reloads, and clears read history from Data', async ({
  page,
  stored,
  pressToolbarButton,
}) => {
  await page.goto(FEED);

  const avery = slot(page, 'Avery Quill');
  const markBtn = avery.getByRole('button', { name: 'Mark as read' });
  await expect(markBtn).toBeVisible();
  await markBtn.click();

  await expect(avery).toHaveAttribute(READ_ATTR, 'hidden');
  await expect(avery.locator(`.${READ_NOTE_CLASS}`)).toContainText('Read post by Avery Quill');
  await expect(messageOf(page, 'Avery Quill')).toBeHidden();
  await expect
    .poll(async () => Object.keys((await stored(READ_HISTORY_KEY)) ?? {}))
    .toEqual(['100000000000001']);

  // Persists after reload.
  await page.reload();
  await expect(avery).toHaveAttribute(READ_ATTR, 'hidden');

  // Clear read history from the Backup & Reset section in Options and verify live unhide.
  await pressToolbarButton();
  await dialog(page).getByRole('button', { name: 'Backup & Reset', exact: true }).click();
  await expect(
    dialog(page).getByText('1 post is remembered as read on this account.'),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Clear read history' }).click();
  await expect(dialog(page).getByText('Read history cleared.')).toBeVisible();
  await expect(avery).not.toHaveAttribute(READ_ATTR);
  await expect(messageOf(page, 'Avery Quill')).toBeVisible();
});

test('restores a backup live, skips an unknown option and saves the result again', async ({
  page,
  stored,
  pressToolbarButton,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();
  await dialog(page).getByRole('button', { name: 'Backup & Reset', exact: true }).click();

  const backup = {
    site: 'facebook',
    options: { hidden_keywords: 'crypto', hide_suggested_posts: false, e2e_invented_option: 1 },
    filters: [NO_SALES],
  };
  await dialog(page)
    .getByRole('textbox', { name: 'Settings JSON to import' })
    .fill(JSON.stringify(backup));
  await dialog(page).getByRole('button', { name: 'Import JSON' }).click();

  await expect(
    dialog(page).getByText('Imported 2 options, 1 filter (1 unrecognised option skipped).'),
  ).toBeVisible();
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ hidden_keywords: 'crypto', hide_suggested_posts: false }));
  expect(await stored(OPTIONS_KEY)).not.toHaveProperty('e2e_invented_option');
  await expect
    .poll(() => stored(FILTERS_KEY))
    .toEqual([expect.objectContaining({ id: NO_SALES.id, name: NO_SALES.name })]);
  // Both apply on the open page, without a reload.
  await expectHidden(page, 'Cleo Marsh');
  await expectHidden(page, 'Bram Okafor');

  // Saving a backup again gives back what was restored, and not the unknown option.
  const download = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Download JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^feed-sanity-facebook-settings-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const saved = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(saved).toMatchObject({
    site: 'facebook',
    options: { hidden_keywords: 'crypto', hide_suggested_posts: false },
    filters: [{ id: NO_SALES.id, name: NO_SALES.name, conditions: NO_SALES.conditions }],
  });
  expect(saved.options).not.toHaveProperty('e2e_invented_option');
});

test('gives a hidden post in the comments popup its note, revealed at first', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { hidden_keywords: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Cleo Marsh');

  // Facebook opens a post's comments in a dialog: the post is an unlabelled
  // article, and each comment an article labelled "Comment by ...".
  await page.evaluate(() => {
    const element = (tag: string, attributes: Record<string, string> = {}, text = '') => {
      const created = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) {
        created.setAttribute(name, value);
      }
      created.textContent = text;
      return created;
    };
    const dialog = element('div', { role: 'dialog', id: 'e2e-popup' });
    const post = element('div', {
      role: 'article',
      'aria-labelledby': 'pl',
      'aria-describedby': 'pd',
    });
    const header = element('div', { 'data-ad-rendering-role': 'profile_name' });
    const heading = element('h4', { id: 'pl' });
    const author = element('a', { href: '/wren.pollard', role: 'link' });
    author.append(element('strong', {}, 'Wren Pollard'));
    heading.append(author);
    header.append(heading);
    const time = element('span', { id: 'pd' });
    time.append(
      element(
        'a',
        {
          role: 'link',
          'aria-labelledby': 'pl',
          'aria-describedby': 'pd',
          href: '/wren.pollard/posts/100000000000009/',
        },
        '1 h',
      ),
    );
    const message = element('div', { 'data-ad-rendering-role': 'story_message' });
    message.append(element('div', { dir: 'auto' }, 'Ask me anything about crypto wallets.'));
    const comments = element('form');
    comments.append(
      element('div', { role: 'article', 'aria-label': 'Comment by Juno Park' }, 'Nice one'),
    );
    post.append(header, time, message, comments);
    dialog.append(post);
    document.body.append(dialog);
  });

  const popup = page.locator('#e2e-popup');
  await expect(popup).toHaveAttribute(MARK.popupPost);
  // The post the popup is about starts revealed, with its note at the top.
  await expect(popup).toHaveAttribute(FILTERED_ATTR, FILTERED_SHOWN);
  const note = popup.locator(`.${FILTER_NOTE_CLASS}`);
  await expect(note).toHaveText(`Hidden: mentions “crypto”${NOTE_HIDE}`);
  const message = popup.locator('[data-ad-rendering-role=story_message]');
  await expect(message).toBeVisible();

  await note.click();
  await expect(popup).toHaveAttribute(FILTERED_ATTR, FILTERED_HIDDEN);
  await expect(message).toBeHidden();
});

test('treats all sites equally in Sites and toggles Facebook off and back on live', async ({
  page,
  pressToolbarButton,
  badgeText,
}) => {
  await page.goto(SUGGESTED_FEED);
  await expectHidden(page, 'Fennel Farm');
  await expect.poll(badgeText).toBe('');

  await pressToolbarButton();
  await dialog(page)
    .getByRole('button', { name: /^Sites/ })
    .click();
  await expect(dialog(page).getByText('Built-in')).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Disable Facebook' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Disable X (Twitter)' })).toBeVisible();
  // Experimental sites stay hidden and disabled by default until revealed via the toggle,
  // and expanding them keeps a stable scrollbar gutter with zero horizontal layout shift.
  await expect(dialog(page).getByRole('button', { name: /Instagram/ })).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: /Gmail/ })).toHaveCount(0);
  const fbDisableBefore = await dialog(page)
    .getByRole('button', { name: 'Disable Facebook' })
    .boundingBox();
  await dialog(page).getByRole('checkbox', { name: 'Show experimental sites' }).click();
  await expect(dialog(page).getByText(/things will be broken/i)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Enable Instagram' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Enable Reddit' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Enable Gmail' })).toBeVisible();
  const fbDisableAfter = await dialog(page)
    .getByRole('button', { name: 'Disable Facebook' })
    .boundingBox();
  expect(fbDisableBefore).not.toBeNull();
  expect(fbDisableAfter).not.toBeNull();
  expect(Math.abs((fbDisableAfter?.x ?? 0) - (fbDisableBefore?.x ?? 0))).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs((fbDisableAfter?.width ?? 0) - (fbDisableBefore?.width ?? 0)),
  ).toBeLessThanOrEqual(0.5);

  // Disabling Facebook turns off its features immediately, takes every mark off the posts and
  // keeps the badge clear.
  await dialog(page).getByRole('button', { name: 'Disable Facebook' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Enable Facebook' })).toBeVisible();
  await expect(messageOf(page, 'Fennel Farm')).toBeVisible();
  await expect(noteOf(page, 'Fennel Farm')).toHaveCount(0);
  await expect(page.locator(`[${MARK.post}], [${FILTERED_ATTR}]`)).toHaveCount(0);
  await expect.poll(badgeText).toBe('');

  // Re-enabling on the same page load restores filtering without a reload.
  await dialog(page).getByRole('button', { name: 'Enable Facebook' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Disable Facebook' })).toBeVisible();
  await expectHidden(page, 'Fennel Farm');
  await expect.poll(badgeText).toBe('');

  // Disabling persists across a full reload with zero feature DOM mutations.
  await dialog(page).getByRole('button', { name: 'Disable Facebook' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Enable Facebook' })).toBeVisible();
  await page.reload();
  await expect(messageOf(page, 'Fennel Farm')).toBeVisible();
  await expect(page.locator(`[${MARK.post}]`)).toHaveCount(0);
  await expect.poll(badgeText).toBe('');

  // The toolbar button still opens Options while disabled so Facebook can be re-enabled live.
  await pressToolbarButton();
  await dialog(page)
    .getByRole('button', { name: /^Sites/ })
    .click();
  await dialog(page).getByRole('button', { name: 'Enable Facebook' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Disable Facebook' })).toBeVisible();
  await expectHidden(page, 'Fennel Farm');
  await expect.poll(badgeText).toBe('');
});
