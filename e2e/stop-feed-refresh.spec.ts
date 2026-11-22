import { OPTIONS_TITLE } from '../project';
import { expect, OPTIONS_KEY, ORIGIN, test } from './extension';

const REFRESH_PAGE = `${ORIGIN}/refresh/`;

test('disables automatic feed refresh modules on load and restores them when turned off', async ({
  page,
  store,
}) => {
  await page.goto(REFRESH_PAGE);

  // Default is on: Home staleness constants and ReturnToFeed route checks are patched.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { staleness, returnToFeed } = (
          globalThis as unknown as {
            __e2eRefresh: {
              staleness: Record<string, unknown>;
              returnToFeed: { isRouteEligible: (route: string) => boolean };
            };
          }
        ).__e2eRefresh;
        return {
          stale: staleness.FEED_STALE_TIMEOUT === Number.POSITIVE_INFINITY,
          vis: staleness.FEED_VISIBILITY_TIMEOUT === Number.POSITIVE_INFINITY,
          push: staleness.FEED_STALE_PUSH_VIEW_TIMEOUT,
          badge: staleness.BADGE_STALE_TIMEOUT,
          groupEligible: returnToFeed.isRouteEligible('comet.group'),
        };
      }),
    )
    .toEqual({
      stale: true,
      vis: true,
      push: null,
      badge: 600_000,
      groupEligible: false,
    });

  // A module loaded later (as when navigating to /groups/feed/) is patched automatically.
  const countWhileOn = await page.evaluate(() => {
    const api = (
      globalThis as unknown as {
        __e2eRefresh: {
          loadGroupsModule: () => void;
          mountGroupsHook: () => void;
          triggerGroupsRefresh: () => number;
        };
      }
    ).__e2eRefresh;
    api.loadGroupsModule();
    api.mountGroupsHook();
    return api.triggerGroupsRefresh();
  });
  expect(countWhileOn).toBe(0);

  // Turning the option off restores all three without a reload.
  await store({ [OPTIONS_KEY]: { stop_feed_refresh: false } });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { staleness, returnToFeed, triggerGroupsRefresh } = (
          globalThis as unknown as {
            __e2eRefresh: {
              staleness: Record<string, unknown>;
              returnToFeed: { isRouteEligible: (route: string) => boolean };
              triggerGroupsRefresh: () => number;
            };
          }
        ).__e2eRefresh;
        return {
          stale: staleness.FEED_STALE_TIMEOUT,
          vis: staleness.FEED_VISIBILITY_TIMEOUT,
          push: staleness.FEED_STALE_PUSH_VIEW_TIMEOUT,
          groupEligible: returnToFeed.isRouteEligible('comet.group'),
          groupsCount: triggerGroupsRefresh(),
        };
      }),
    )
    .toEqual({
      stale: 600_000,
      vis: 120_000,
      push: 1_800_000,
      groupEligible: true,
      groupsCount: 1,
    });

  // Turning it back on re-disables all three without a reload.
  await store({ [OPTIONS_KEY]: { stop_feed_refresh: true } });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { staleness, returnToFeed, triggerGroupsRefresh } = (
          globalThis as unknown as {
            __e2eRefresh: {
              staleness: Record<string, unknown>;
              returnToFeed: { isRouteEligible: (route: string) => boolean };
              triggerGroupsRefresh: () => number;
            };
          }
        ).__e2eRefresh;
        return {
          visInfinite: staleness.FEED_VISIBILITY_TIMEOUT === Number.POSITIVE_INFINITY,
          groupEligible: returnToFeed.isRouteEligible('comet.group'),
          groupsCount: triggerGroupsRefresh(),
        };
      }),
    )
    .toEqual({
      visInfinite: true,
      groupEligible: false,
      groupsCount: 1,
    });
});

test('shows stop_feed_refresh running and the bridge toggle under Diagnostics', async ({
  page,
  pressToolbarButton,
}) => {
  await page.goto(REFRESH_PAGE);
  await pressToolbarButton();

  const dialog = page.getByRole('dialog', { name: OPTIONS_TITLE });
  await dialog.getByRole('button', { name: 'Diagnostics', exact: true }).click();

  const row = dialog.getByRole('row', { name: /stop_feed_refresh/ });
  await expect(row.getByRole('cell', { name: 'running', exact: true })).toBeVisible();
  await expect(dialog.getByText(/1 toggle: stop-feed-refresh/)).toBeVisible();
});
