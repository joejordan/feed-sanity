import type { Page } from '@playwright/test';
import { STUDIO_VIBES } from '../src/core/theme-effects/model';
import { vibeToThemeDocument } from '../src/core/theming/config';
import { expect, OPTIONS_KEY, ORIGIN, THEME_KEY, test } from './extension';

const HOME = `${ORIGIN}/`;
const FRIENDS = `${ORIGIN}/?filter=friends&sk=h_chr`;
const GROUPS = `${ORIGIN}/?filter=groups&sk=h_chr`;

/** Every address the tab's page loaded, in order. */
function loads(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      seen.push(frame.url());
    }
  });
  page.on('load', () => seen.push('load'));
  return seen;
}

/** Marks the page, so a test can tell it was not loaded again. */
const markLoad = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.dataset.sameLoad = 'true';
  });

const sameLoad = (page: Page) =>
  expect(page.locator('html')).toHaveAttribute('data-same-load', 'true');

const caret = (page: Page) => page.getByRole('button', { name: 'Choose feed' });
const menu = (page: Page) => page.getByRole('menu', { name: 'Feeds' });
const feedEntry = (page: Page, name: string) => menu(page).getByRole('menuitemradio', { name });
const homeLink = (page: Page) => page.getByRole('link', { name: 'Home', exact: true });

// The tests share one tab, whose session storage keeps the time of the last
// move to another feed. A move just before would stop the next one, as a
// loop guard, so each test starts with none. The extension does not run on
// /saved/.
test.beforeEach(async ({ page }) => {
  await page.goto(`${ORIGIN}/saved/`);
  await page.evaluate(() => sessionStorage.clear());
});

test('shows the saved feed in place of the plain home address on a full load, once', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { home_feed: 'friends' } });
  const seen = loads(page);

  await page.goto(HOME, { waitUntil: 'commit' });

  await expect(page).toHaveURL(FRIENDS);
  await expect(caret(page)).toHaveClass(/\bchosen\b/);
  // Long enough for a second move to have started, if there were one.
  await page.waitForTimeout(1000);
  expect(seen.filter((entry) => entry !== 'load')).toEqual([HOME, FRIENDS]);
});

test('leaves the home address alone when its query asks for something', async ({ page, store }) => {
  await store({ [OPTIONS_KEY]: { home_feed: 'friends' } });

  await page.goto(`${ORIGIN}/?sk=h_nor`);
  await expect(caret(page)).toBeVisible();
  await page.waitForTimeout(500);

  await expect(page).toHaveURL(`${ORIGIN}/?sk=h_nor`);
});

test("takes a press of Home to the saved feed through Facebook's own link, without a reload", async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { home_feed: 'friends' } });
  await page.goto(GROUPS);
  await markLoad(page);

  await homeLink(page).click();

  await expect(page).toHaveURL(FRIENDS);
  await sameLoad(page);
});

test('switches feeds from the menu on the Home button and saves the choice', async ({
  page,
  stored,
}) => {
  await page.goto(GROUPS);
  await markLoad(page);
  await expect(caret(page)).not.toHaveClass(/\bchosen\b/);

  // A press on the caret opens the menu, and does not follow the Home link.
  await caret(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(caret(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(GROUPS);
  await expect(feedEntry(page, 'Home')).toHaveAttribute('aria-checked', 'true');
  await expect(feedEntry(page, 'Groups')).toHaveAttribute('aria-current', 'page');

  await feedEntry(page, 'Friends').click();

  await expect(page).toHaveURL(FRIENDS);
  await expect(menu(page)).toHaveCount(0);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ home_feed: 'friends' }));
  await expect(caret(page)).toHaveClass(/\bchosen\b/);

  // Home now lands on Friends.
  await page.getByRole('link', { name: 'Most recent' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/?sk=h_chr`);
  await homeLink(page).click();
  await expect(page).toHaveURL(FRIENDS);

  // Picking Home goes back to Facebook's own feed and saves it.
  await caret(page).click();
  await expect(feedEntry(page, 'Friends')).toHaveAttribute('aria-checked', 'true');
  await feedEntry(page, 'Home').click();
  await expect(page).toHaveURL(HOME);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ home_feed: 'home' }));
  await expect(caret(page)).not.toHaveClass(/\bchosen\b/);

  // A press on the house icon follows the Home link as before.
  await page.getByRole('link', { name: 'Most recent' }).click();
  await homeLink(page).click();
  await expect(page).toHaveURL(HOME);
  await sameLoad(page);
});

test('works the menu from the keyboard', async ({ page, stored }) => {
  await page.goto(GROUPS);

  await caret(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(feedEntry(page, 'Home')).toBeFocused();
  await page.keyboard.press('End');
  await expect(feedEntry(page, 'Most recent')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(caret(page)).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(feedEntry(page, 'Home')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(feedEntry(page, 'Friends')).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(FRIENDS);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ home_feed: 'friends' }));
});

test('follows a choice saved while the page is open, and an arrival by Back', async ({
  page,
  store,
}) => {
  await page.goto(HOME);
  await expect(caret(page)).toBeVisible();
  await page.getByRole('link', { name: 'Most recent' }).click();
  await expect(page).toHaveURL(`${ORIGIN}/?sk=h_chr`);

  await store({ [OPTIONS_KEY]: { home_feed: 'pages' } });
  await expect(caret(page)).toHaveClass(/\bchosen\b/);
  const seen = loads(page);
  await page.goBack();

  // Facebook would already be drawing its own feed, so the address is
  // replaced and the feed loaded in its place.
  await expect(page).toHaveURL(`${ORIGIN}/?filter=pages&sk=h_chr`);
  await page.waitForTimeout(1000);
  expect(seen.filter((entry) => entry !== 'load').at(-1)).toBe(`${ORIGIN}/?filter=pages&sk=h_chr`);
});

test('keeps the caret off the top bar with its switch off, and the choice still applies', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { home_feed: 'groups', home_feed_menu: false } });

  await page.goto(HOME, { waitUntil: 'commit' });

  await expect(page).toHaveURL(GROUPS);
  await expect(page.locator('#feeds')).toBeVisible();
  await expect(caret(page)).toHaveCount(0);
});

test('keeps the feed menu reachable on narrow windows and falls back to the right top bar when middle tabs vanish', async ({
  page,
  stored,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(GROUPS);

  // Wide: one button, the inline caret on Home.
  await expect(caret(page)).toHaveCount(1);
  await expect(caret(page)).toBeVisible();
  await expect(caret(page)).toHaveClass(/\bcaret\b/);

  // Mid-narrow (750 px -> Home cell ~57 px): compact inline caret stays visible.
  await page.setViewportSize({ width: 750, height: 720 });
  await expect(caret(page)).toHaveCount(1);
  await expect(caret(page)).toBeVisible();
  await expect(caret(page)).toHaveClass(/\bcaret\b/);

  // Narrow (600 px -> <= 700 px): Facebook hides all middle tabs; fallback button appears on the right.
  await page.setViewportSize({ width: 600, height: 720 });
  await expect(homeLink(page)).toBeHidden();
  const toolbarButton = page.locator('#top-bar-actions-wrap').getByRole('button', {
    name: 'Choose feed',
  });
  await expect(toolbarButton).toBeVisible();
  await expect(toolbarButton).toHaveClass(/\btoolbar-btn\b/);

  await toolbarButton.click();
  await expect(menu(page)).toBeVisible();
  await feedEntry(page, 'Friends').click();

  await expect(page).toHaveURL(FRIENDS);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ home_feed: 'friends' }));
  await expect(toolbarButton).toHaveClass(/\bchosen\b/);

  // Widening back hides the fallback button and shows the inline caret again.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(toolbarButton).toHaveCount(0);
  await expect(caret(page)).toHaveCount(1);
  await expect(caret(page)).toBeVisible();
  await expect(caret(page)).toHaveClass(/\bchosen\b/);
});

test('shows the inline post composer on alternate Home feeds and opens the native Create post dialog', async ({
  page,
  store,
}) => {
  // Plain Home feed already has Facebook's own composer, so Feed Sanity does not add one.
  await page.goto(HOME);
  await expect(page.locator('#feed_sanity_home_composer')).toHaveCount(0);

  // Switching to Friends mounts the composer above [role=feed] with the user's short name.
  await page.goto(FRIENDS);
  const composerHost = page.locator('#feed_sanity_home_composer');
  await expect(composerHost).toBeVisible();
  const prompt = composerHost.getByRole('button', { name: "What's on your mind, Alex?" });
  await expect(prompt).toBeVisible();

  // Clicking the prompt launches Facebook's native Create post dialog through the page-world action.
  await prompt.click();
  await expect(page.getByRole('dialog', { name: 'Create post' })).toBeVisible();

  // Turning the option off removes the composer without a reload.
  await store({ [OPTIONS_KEY]: { home_feed_composer: false } });
  await expect(composerHost).toHaveCount(0);
});

test('marks the Home tab active on alternate feeds and shows "Home | <Feed>" tooltip', async ({
  page,
  store,
}) => {
  await store({ [OPTIONS_KEY]: { home_feed: 'friends' } });
  await page.goto(FRIENDS);
  // Real Facebook removes aria-current="page" from Home on alternate feeds.
  await page.evaluate(() => document.querySelector('#home')?.removeAttribute('aria-current'));

  const home = homeLink(page);
  await expect(home).toHaveAttribute('data-feed-sanity-home-active', '');

  // Hovering the Home link shows our custom "Home | Friends" tooltip.
  await home.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Home | Friends');
});

test('replaces the fixed Feeds sidebar with responsive Home rails on narrow viewports', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await page.goto(FRIENDS);

  // Provide Facebook's page-world Home rail modules and add a realistic Feeds
  // shell with a fixed 360 px navigation sibling and min-width: 900px.
  await page.evaluate(() => {
    const win = globalThis as unknown as Record<string, unknown>;
    const LeftRail = () => 'Home Left Rail';
    const RightRail = () => 'Birthdays';
    class FakeComponent {
      props: Record<string, unknown>;
      state = { failed: false };
      constructor(props: Record<string, unknown>) {
        this.props = props;
      }
    }
    const modules: Record<string, unknown> = {
      'CometHomeRoot.entrypoint': {
        root: { load: () => Promise.resolve() },
        getPreloadProps: () => ({
          queries: {
            leftRailContainerQueryReference: { parameters: { id: 'lr' }, variables: {} },
            rightSideHeaderCardsQueryReference: { parameters: { id: 'rr' }, variables: {} },
          },
        }),
      },
      CometRelay: {
        useRelayEnvironment: () => ({}),
        loadQuery: () => ({ dispose: () => undefined }),
      },
      'CometClassicHomeLeftRailContainer.react': LeftRail,
      'CometHomeRightRail.react': RightRail,
      react: {
        createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
          type,
          props,
          children,
        }),
        useMemo: <T>(fn: () => T) => fn(),
        useEffect: () => undefined,
        Component: FakeComponent,
        Suspense: 'Suspense',
      },
      ReactDOM: {
        createRoot: (target: HTMLElement) => ({
          render: () => {
            target.textContent =
              target.id === 'feed_sanity_home_left_rail' ? 'Shortcuts' : 'Birthdays';
          },
          unmount: () => {
            target.textContent = '';
          },
        }),
      },
    };
    win.require = (name: string) => modules[name];

    const main = document.querySelector('[role=main]');
    if (!main || !main.parentElement) {
      return;
    }
    const shell = document.createElement('div');
    shell.id = 'e2e-feeds-shell';
    shell.style.display = 'flex';
    shell.style.minWidth = '900px';
    const fixedNav = document.createElement('div');
    fixedNav.id = 'e2e-fixed-feeds-nav';
    fixedNav.setAttribute('role', 'navigation');
    fixedNav.style.width = '360px';
    fixedNav.textContent = 'Feeds';
    main.parentElement.insertBefore(shell, main);
    shell.append(fixedNav, main);
  });

  const leftRail = page.locator('#feed_sanity_home_left_rail');
  const rightRail = page.locator('#feed_sanity_home_right_rail');
  await expect(page.locator('#e2e-feeds-shell')).toHaveAttribute(
    'data-feed-sanity-home-layout',
    '',
  );
  await expect(page.locator('#e2e-fixed-feeds-nav')).toBeHidden();
  await expect(leftRail).toBeVisible();
  await expect(rightRail).toBeVisible();

  // Below 1100 px: left rail disappears, right rail stays visible.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(leftRail).toBeHidden();
  await expect(rightRail).toBeVisible();

  // Below 900 px: right rail disappears too and page has no horizontal overflow.
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(leftRail).toBeHidden();
  await expect(rightRail).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('keeps the Home caret menu clickable and visible while a Studio theme backdrop is active', async ({
  page,
  store,
  stored,
}) => {
  const matrixVibe = STUDIO_VIBES.find((v) => v.id === 'enter-the-matrix')!;
  await store({
    [THEME_KEY]: vibeToThemeDocument(matrixVibe),
  });

  await page.goto(GROUPS);
  await expect(page.locator('[data-feed-sanity="theme-backdrop"]')).toBeVisible();

  await caret(page).click();
  await expect(menu(page)).toBeVisible();
  await feedEntry(page, 'Friends').click();

  await expect(page).toHaveURL(FRIENDS);
  await expect
    .poll(() => stored(OPTIONS_KEY))
    .toEqual(expect.objectContaining({ home_feed: 'friends' }));
});
