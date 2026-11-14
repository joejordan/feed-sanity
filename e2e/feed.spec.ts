import type { Page } from '@playwright/test';
import { OPTIONS_TITLE } from '../project';
import { expect, FILTERS_KEY, OPTIONS_KEY, ORIGIN, test } from './extension';

const FEED = `${ORIGIN}/`;

/** The feed slot of the post by `author`. */
const slot = (page: Page, author: string) =>
  page.locator('[aria-posinset]').filter({ has: page.locator('h4', { hasText: author }) });

const noteOf = (page: Page, author: string) =>
  slot(page, author).locator('.sfx_filter_hidden_note');

const messageOf = (page: Page, author: string) =>
  slot(page, author).locator('[data-ad-rendering-role=story_message]');

/** Waits until the post by `author` is hidden behind exactly one note, and returns the note. */
async function expectHidden(page: Page, author: string) {
  await expect(slot(page, author)).toHaveClass(/\bsfx_filter_hidden\b/);
  // Strict: fails if the post has more than one note.
  await expect(noteOf(page, author)).toBeVisible();
  await expect(messageOf(page, author)).toBeHidden();
  return noteOf(page, author);
}

/** Checks that the post by `author` was found and left alone. */
async function expectShown(page: Page, author: string) {
  // The filters run as soon as the post's ID is known, so by then they have
  // had their chance to hide it.
  await expect(slot(page, author)).toHaveAttribute('sfx_id');
  await expect(slot(page, author)).not.toHaveClass(/\bsfx_filter_hidden\b/);
  await expect(noteOf(page, author)).toHaveCount(0);
  await expect(messageOf(page, author)).toBeVisible();
}

const dialog = (page: Page) => page.getByRole('dialog', { name: OPTIONS_TITLE });

test('starts on a Facebook page and applies a saved option there', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { external_css_url: `${ORIGIN}/external.css` } });

  await page.goto(FEED);

  await expect(page.locator('link#feed_sanity_external_css')).toHaveAttribute(
    'href',
    `${ORIGIN}/external.css`,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--e2e-external-css').trim(),
      ),
    )
    .toBe('loaded');
});

test('finds every post in the feed and reads its ID from the time link', async ({
  page,
  store,
}) => {
  // Post detection only starts once there is a filter to run.
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'zebra' } });

  await page.goto(FEED);

  await expect(slot(page, 'Avery Quill')).toHaveAttribute('sfx_id', '100000000000001');
  await expect(slot(page, 'Bram Okafor')).toHaveAttribute('sfx_id', '100000000000002');
  await expect(slot(page, 'Cleo Marsh')).toHaveAttribute('sfx_id', '100000000000003');
  await expect(slot(page, 'Ines Harrow')).toHaveAttribute('sfx_id', '100000000000005');
  // Arrives after the others have been marked.
  await expect(slot(page, 'Dara Venn')).toHaveAttribute('sfx_id', '100000000000006');
  // The sponsored post has no time link. The lookup gives up after about a second.
  await expect(slot(page, 'Sourdough School')).toHaveAttribute('sfx_id', 'no-ID');
  // Comments are articles too, and are not posts.
  await expect(page.locator('form [sfx_post]')).toHaveCount(0);
  await expect(page.locator('[sfx_post]')).toHaveCount(6);
  await expect(page.locator('.sfx_filter_hidden')).toHaveCount(0);
});

test('hides posts that match a saved keyword behind a note that shows them', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'crypto' } });

  await page.goto(FEED);

  const note = await expectHidden(page, 'Cleo Marsh');
  await expect(note).toHaveText(/Post Hidden by keyword: crypto -- Click to reveal post/);
  // A comment under this post says "crypto". Comments are not the post's own text.
  await expectShown(page, 'Avery Quill');
  await expectShown(page, 'Bram Okafor');
  await expectShown(page, 'Sourdough School');

  await note.click();
  await expect(slot(page, 'Cleo Marsh')).toHaveClass(/\bsfx_filter_hidden_show\b/);
  await expect(messageOf(page, 'Cleo Marsh')).toBeVisible();
  await expect(note).toHaveText(/Click to rehide post/);

  await note.click();
  await expect(messageOf(page, 'Cleo Marsh')).toBeHidden();
});

test('hides posts with a filter saved under the filters key', async ({ page, store }) => {
  await store({
    [FILTERS_KEY]: [
      {
        title: 'No sales',
        enabled: true,
        match: 'ALL',
        rules: [
          {
            target: 'author',
            operator: 'contains',
            matcher: 'str',
            condition: { text: 'Bram Okafor' },
          },
        ],
        actions: [{ action: 'hide', show_note: true }],
      },
    ],
  });

  await page.goto(FEED);

  const note = await expectHidden(page, 'Bram Okafor');
  await expect(note).toHaveText(/Post hidden by filter "No sales"/);
  await expectShown(page, 'Cleo Marsh');
});

test('follows a keyword changed in storage while the page is open', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Cleo Marsh');
  // Gone if the page loads again.
  await page.evaluate(() => {
    document.documentElement.dataset.sameLoad = 'true';
  });

  await store({ [OPTIONS_KEY]: { hide_posts_text: 'typewriter' } });

  await expectHidden(page, 'Bram Okafor');
  await expectShown(page, 'Cleo Marsh');
  await expect(page.locator('html')).toHaveAttribute('data-same-load', 'true');
});

test('filters a post added after load and puts the note back in a refilled post', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'crypto' } });

  await page.goto(FEED);

  await expectHidden(page, 'Dara Venn');
  // The page empties this slot once its note appears, which removes the note,
  // and fills it again with the same post.
  await expect(slot(page, 'Ines Harrow')).toHaveAttribute('data-refilled', 'true');
  await expectHidden(page, 'Ines Harrow');
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
});

test('saves a setting changed in the options dialog to extension storage', async ({
  page,
  pressToolbarButton,
  stored,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();

  await dialog(page).getByRole('button', { name: 'Hide Posts', exact: true }).click();
  await dialog(page).getByRole('textbox', { name: 'Keywords' }).fill('typewriter');
  await dialog(page).getByRole('button', { name: 'Save' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ hide_posts_text: 'typewriter' }));
  await expectHidden(page, 'Bram Okafor');
});

test('counts the hidden posts on the toolbar badge and follows the keyword', async ({
  page,
  store,
  badgeText,
}) => {
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'crypto' } });
  await page.goto(FEED);

  // Cleo Marsh, Ines Harrow and Dara Venn, who arrives late.
  await expectHidden(page, 'Dara Venn');
  await expect.poll(badgeText).toBe('3');

  await store({ [OPTIONS_KEY]: { hide_posts_text: 'typewriter' } });
  await expectHidden(page, 'Bram Okafor');
  await expect.poll(badgeText).toBe('1');

  await store({ [OPTIONS_KEY]: { hide_posts_text: '' } });
  await expectShown(page, 'Bram Okafor');
  await expect.poll(badgeText).toBe('');
});

test('shows the running features and the post counts under Diagnostics', async ({
  page,
  store,
  pressToolbarButton,
}) => {
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Dara Venn');
  await pressToolbarButton();

  await dialog(page).getByRole('button', { name: 'Diagnostics', exact: true }).click();

  const postFilters = dialog(page).getByRole('row', { name: /post_filters/ });
  await expect(postFilters.getByRole('cell', { name: 'running', exact: true })).toBeVisible();
  // The sponsored post has no ID. Its lookup gives up after about a second.
  await expect(
    dialog(page).getByText(
      '6 posts on the page: 5 with an ID, 1 without one, 0 still being identified.',
    ),
  ).toBeVisible();
  await expect(
    dialog(page).getByText('Feed slots with content not taken for posts: 0.'),
  ).toBeVisible();
  await expect(
    dialog(page).getByRole('rowheader', { name: /^post any, \d+ lookups/ }),
  ).toBeVisible();
});

test('says under Diagnostics when post detection has not started', async ({
  page,
  pressToolbarButton,
}) => {
  await page.goto(FEED);
  await pressToolbarButton();

  await dialog(page).getByRole('button', { name: 'Diagnostics', exact: true }).click();

  await expect(dialog(page).getByText(/^Post detection has not started/)).toBeVisible();
});

test('finds the posts on a page reached without a reload', async ({ page, store, badgeText }) => {
  await store({ [OPTIONS_KEY]: { hide_posts_text: 'crypto' } });
  await page.goto(FEED);
  await expectHidden(page, 'Cleo Marsh');

  await page.getByRole('link', { name: 'Most recent' }).click();

  await expect(page).toHaveURL(`${ORIGIN}/?sk=h_chr`);
  await expect(slot(page, 'Cleo Marsh')).toHaveCount(0);
  await expectHidden(page, 'Elio Brandt');
  await expectShown(page, 'Fern Adair');
  await expect(slot(page, 'Fern Adair')).toHaveAttribute('sfx_id', '100000000000008');
  // The posts hidden on the first page went with it.
  await expect.poll(badgeText).toBe('1');
});
