import type { OptionSpecs } from '../../core/options';
import type { Scope } from '../../core/scope';
import type { FacebookPage } from '../../facebook/feature';
import type { Watched } from '../../ui/watched';
import type { FeedEntry } from './feeds';
import { intercept, isPlainPress, PRESS_EVENTS } from '../../core/intercept';
import { onUrlChange } from '../../core/navigation';
import { defineFeature } from '../../facebook/feature';
import { shows, siteAddressOf } from '../../facebook/home-feed';
import { TOP_BAR_HOME } from '../../facebook/selectors';
import { mountOverlay } from '../../ui/overlay';
import { watchedValue } from '../../ui/watched';
import { FeedMenu } from './feed-menu';
import css from './feed-menu.css?inline';
import { FACEBOOK_FEED, FEEDS } from './feeds';
import { destination, feedShown, movedRecently, moveTo } from './rules';

const OPTIONS = {
  home_feed: {
    section: 'Home Feed',
    title: 'Feed on the Home page',
    description:
      "The feed you see when you open Facebook, press Home or click the Facebook logo. The menu on the Home button sets it too. Facebook's own feed changes nothing.",
    default: FACEBOOK_FEED,
    choices: FEEDS.map(({ id, label }) => ({
      value: id,
      label: id === FACEBOOK_FEED ? "Facebook's own feed" : label,
    })),
  },
  home_feed_menu: {
    section: 'Home Feed',
    title: 'Feed menu on the Home button',
    description:
      'Show a small arrow beside the Home button in the top bar that opens a list of feeds to switch to.',
    default: true,
  },
} satisfies OptionSpecs;

/**
 * Takes presses of links to the plain home address, such as Home and the
 * logo, to the saved feed instead, keeping each such press from Facebook as
 * a whole. `chosen` gives the saved feed's id.
 */
function sendHomePresses(scope: Scope, chosen: () => string): void {
  /** Where a press on a home link goes instead, or null when it goes to Facebook. */
  const redirected = (event: MouseEvent): string | null => {
    const link = isPlainPress(event)
      ? event.composedPath().find((node) => node instanceof HTMLAnchorElement)
      : undefined;
    const url = link instanceof HTMLAnchorElement ? siteAddressOf(link) : null;
    return url ? destination(url, chosen()) : null;
  };
  /** True while a press is being kept from Facebook. */
  let taken = false;
  intercept(scope, PRESS_EVENTS, (event) => {
    switch (event.type) {
      case 'pointerdown':
        taken = (event as PointerEvent).isPrimary && redirected(event as PointerEvent) !== null;
        return taken;
      case 'click': {
        const click = event as MouseEvent;
        // A click from the keyboard has no press before it, and ends none: a
        // press let go outside the window is over by now. A press let go
        // away from the link clicks something else, and goes nowhere.
        const fromKeyboard = click.detail === 0;
        const endsPress = taken && !fromKeyboard;
        const to = fromKeyboard || endsPress ? redirected(click) : null;
        taken = false;
        if (to === null) {
          // The end of a press Facebook did not see start is kept from it too.
          return endsPress;
        }
        event.preventDefault();
        moveTo(to);
        return true;
      }
      case 'pointercancel': {
        const wasTaken = taken;
        taken = false;
        return wasTaken;
      }
      default:
        return taken;
    }
  });
}

/**
 * Chooses the feed Facebook's home page shows. New in this project, in
 * place of Social Fixer's switch to the Most Recent feed.
 *
 * With a feed other than Facebook's own saved, arriving at the plain home
 * address leads to that feed instead. On a full load that is decided as
 * soon as the options are read, before Facebook draws its own feed, and
 * the address is replaced. A press of a link to the plain home address,
 * such as Home or the logo, is kept from Facebook and goes to the feed
 * through one of Facebook's own links to it when the page has one, so
 * Facebook moves there without a reload, or else by loading it. Any other
 * arrival inside the page, such as Back, replaces the address with the
 * feed's and loads it. Every other address is left alone, including the
 * home address with anything in its query.
 *
 * A menu on the Home button switches between the feeds and saves the one
 * picked. Picking Home saves Facebook's own feed, which is the way back to
 * it.
 */
export default defineFeature({
  id: 'home_feed',
  options: OPTIONS,
  setup({ options, scope, child, log }) {
    const choice: Watched<string> = {
      get: () => options.get('home_feed'),
      subscribe: (listener) => options.watch('home_feed', listener),
    };
    const shown = watchedValue(feedShown(location)?.id ?? null, log);

    /** Takes a person who just arrived at the plain home address to the saved feed. */
    const arrived = (): void => {
      const to = destination(location, choice.get());
      // A return to the plain address just after a move means Facebook sent the person back.
      if (to !== null && !movedRecently()) {
        moveTo(to, { replace: true });
      }
    };
    arrived();
    scope.add(
      onUrlChange(() => {
        shown.set(feedShown(location)?.id ?? null);
        arrived();
      }),
    );
    // Presses are heard only while a feed of the person's own is saved.
    let presses: ReturnType<typeof child> | undefined;
    options.watch('home_feed', (id) => {
      if (id === FACEBOOK_FEED) {
        presses?.scope.dispose();
        presses = undefined;
      } else if (!presses) {
        presses = child();
        sendHomePresses(presses.scope, choice.get);
      }
    });

    const pick = (feed: FeedEntry): void => {
      options.set('home_feed', feed.id).catch((error: unknown) => {
        log.error('could not save the feed', error);
      });
      if (!shows(location, feed.address)) {
        moveTo(feed.address);
      }
    };

    const showMenu = (page: FacebookPage, menuScope: Scope): void => {
      const mounted = new Map<Element, () => void>();
      page.watch(page.locate(TOP_BAR_HOME), {
        added: (link) => {
          mounted.get(link)?.();
          mounted.set(
            link,
            mountOverlay(
              link,
              <FeedMenu feeds={FEEDS} choice={choice} shown={shown} anchor={link} onPick={pick} />,
              { css },
            ),
          );
        },
        removed: (link) => {
          mounted.get(link)?.();
          mounted.delete(link);
        },
      });
      menuScope.add(() => {
        for (const unmount of mounted.values()) {
          unmount();
        }
        mounted.clear();
      });
    };

    let menu: ReturnType<typeof child> | undefined;
    options.watch('home_feed_menu', (on) => {
      menu?.scope.dispose();
      menu = undefined;
      if (on) {
        menu = child();
        showMenu(menu.page, menu.scope);
      }
    });
  },
});
