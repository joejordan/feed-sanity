import type { OptionSpecs } from '../../core/options';
import type { Scope } from '../../core/scope';
import type { FacebookPage } from '../../facebook/feature';
import type { ComposerMode } from '../../facebook/post-composer';
import type { Watched } from '../../ui/watched';
import type { ComposerState } from './feed-composer';
import type { FeedEntry } from './feeds';
import { BridgeError } from '../../core/bridge';
import { addStyle } from '../../core/dom';
import { intercept, isPlainPress, PRESS_EVENTS } from '../../core/intercept';
import { onUrlChange } from '../../core/navigation';
import { hideElement, markElement, mountSlot, whileOnRoute } from '../../core/surface';
import { defineFeature } from '../../facebook/feature';
import { HOME_ADDRESS, isPlainHome, shows, siteAddressOf } from '../../facebook/home-feed';
import { findFeedsLeftRail } from '../../facebook/home-rails';
import {
  FEED_COMPOSER,
  FEED_CONTAINER,
  FEED_MAIN,
  FEEDS_LEFT_RAIL,
  HOME_ACTIVE,
  HOME_LAYOUT,
  TOOLTIP,
  TOP_BAR_ACTIONS,
  TOP_BAR_AVATAR,
  TOP_BAR_HOME,
} from '../../facebook/selectors';
import { isFacebookAddress } from '../../facebook/urls';
import { HOST_TAG, renderInShadow } from '../../ui/mount';
import { mountOverlay } from '../../ui/overlay';
import { watchedValue } from '../../ui/watched';
import { FeedComposer } from './feed-composer';
import composerCss from './feed-composer.css?inline';
import { FeedMenu } from './feed-menu';
import css from './feed-menu.css?inline';
import { FACEBOOK_FEED, FEEDS, feedById } from './feeds';
import layoutCss from './home-layout.css?inline';
import { destination, feedShown, isAlternateHomeFeed, movedRecently, moveTo } from './rules';

const LAYOUT_STYLE_ID = 'feed_sanity_home_layout';
const COMPOSER_HOST_ID = 'feed_sanity_home_composer';
const LEFT_RAIL_ID = 'feed_sanity_home_left_rail';
const RIGHT_RAIL_ID = 'feed_sanity_home_right_rail';

const OPTIONS = {
  home_feed: {
    section: 'Feed & Reading',
    group: 'Home Feed',
    title: 'Feed on the Home page',
    description:
      "The feed you see when you open Facebook, press Home or click the Facebook logo. The menu on the Home button sets it too. Facebook's own feed changes nothing.",
    keywords: ['chronological', 'most recent', 'friends', 'favorites'],
    default: FACEBOOK_FEED,
    choices: FEEDS.map(({ id, label }) => ({
      value: id,
      label: id === FACEBOOK_FEED ? "Facebook's own feed" : label,
    })),
  },
  home_feed_menu: {
    section: 'Feed & Reading',
    group: 'Home Feed',
    title: 'Feed menu on the Home button',
    description:
      'Show a small arrow beside the Home button in the top bar that opens a list of feeds to switch to. Moves beside the right-side top-bar buttons on narrow windows.',
    default: true,
  },
  home_feed_composer: {
    section: 'Feed & Reading',
    group: 'Home Feed',
    title: 'Post box on other feeds',
    description:
      'Show the "What\'s on your mind?" post box at the top of the Friends, Favorites, Groups, Pages and Most recent feeds.',
    default: true,
  },
  home_feed_rails: {
    section: 'Feed & Reading',
    group: 'Home Feed',
    title: 'Home sidebars and responsive layout on other feeds',
    description:
      "Replace the fixed Feeds sidebar on Friends, Favorites, Groups, Pages and Most recent with Facebook's Home left and right sidebars (including Birthdays), hiding them on narrow windows.",
    default: true,
  },
} satisfies OptionSpecs;

/**
 * Takes presses of links to the plain home address, such as Home and the
 * logo, to the saved feed instead, keeping each such press from Facebook as
 * a whole. `chosen` gives the saved feed's id.
 */
function sendHomePresses(scope: Scope, chosen: () => string, shouldIntercept: () => boolean): void {
  /** Where a press on a home link goes instead, or null when it goes to Facebook. */
  const redirected = (event: MouseEvent): string | null => {
    if (!shouldIntercept()) {
      return null;
    }
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
        const fromKeyboard = click.detail === 0;
        const endsPress = taken && !fromKeyboard;
        const to = fromKeyboard || endsPress ? redirected(click) : null;
        taken = false;
        if (to === null) {
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

/** Logs unexpected bridge failures while ignoring expected cancellation or unavailability. */
function isUnexpectedBridgeError(error: unknown): boolean {
  const failure = error instanceof BridgeError ? error.failure : undefined;
  return failure !== 'cancelled' && failure !== 'unavailable';
}

/** Extracts a validated Facebook avatar image URL from an `<image>` or `<img>` element. */
function avatarSrcFromElement(element: Element | null): string | null {
  if (!element) {
    return null;
  }
  const raw =
    element.getAttribute('xlink:href') ??
    element.getAttribute('href') ??
    element.getAttribute('src');
  return raw && isFacebookAddress(raw) ? raw : null;
}

/**
 * Chooses the feed Facebook's home page shows and gives alternate feeds
 * (`Friends`, `Favorites`, `Groups`, `Pages`, `Most recent`, `/?sk=h_chr`) the
 * full responsive Home experience.
 *
 * On live Facebook, plain `/` switches `CometModernHomeFeedQuery` in place
 * through the page-world bridge so the URL stays `https://www.facebook.com/`
 * with Facebook's native Home layout, rails, and composer intact. Whenever
 * in-place switching is unavailable (for example without the bridge), it falls
 * back to Facebook's `/feeds` query URLs, where our responsive Home rails,
 * inline composer, and active Home tab state fill in the missing Home chrome.
 */
export default defineFeature({
  id: 'home_feed',
  options: OPTIONS,
  setup({ options, page: featurePage, scope, child, log }) {
    scope.add(addStyle(LAYOUT_STYLE_ID, layoutCss));

    const choice: Watched<string> = {
      get: () => options.get('home_feed'),
      subscribe: (listener) => options.watch('home_feed', listener),
    };
    const shown = watchedValue(feedShown(location)?.id ?? null, log);

    /** True once the page-world `set-home-feed` action confirmed Facebook's Relay loader is live. */
    let inPlaceCapable = false;
    /** True while a non-null feedStyle override is installed in page-world `set-home-feed`. */
    let pageWorldOverrideActive = false;
    /** Which feed is currently active in-place on `/` (null when not overridden in-place). */
    let inPlaceFeedId: string | null = null;
    /** Tracks a pending in-place refresh waiting for `[role=feed]` to mount on `/`. */
    let pendingFeedWatch: (() => void) | undefined;
    let arrivalSeq = 0;

    const clearPendingRefresh = (): void => {
      pendingFeedWatch?.();
      pendingFeedWatch = undefined;
    };
    scope.add(clearPendingRefresh);

    const computeShown = (): string | null => {
      if (isPlainHome(location) && inPlaceFeedId !== null) {
        return inPlaceFeedId;
      }
      return feedShown(location)?.id ?? null;
    };

    const syncShown = (): void => {
      shown.set(computeShown());
    };

    const fallbackMove = (to: string): void => {
      if (!movedRecently()) {
        moveTo(to, { replace: true });
      }
    };

    /**
     * Attempts to configure Facebook's live Home feed stream in place on `/`.
     * Returns whether Facebook's Home feed module accepted the override.
     */
    const applyInPlace = async (
      feed: FeedEntry,
      refresh: boolean,
    ): Promise<{ applied: boolean; refreshed: boolean }> => {
      try {
        return await featurePage.bridge.setHomeFeed(feed.feedStyle, refresh);
      } catch {
        return { applied: false, refreshed: false };
      }
    };

    /** Takes a person who just arrived at the plain home address to the saved feed. */
    const arrived = (): void => {
      clearPendingRefresh();
      const seq = ++arrivalSeq;
      const savedId = choice.get();
      const to = destination(location, savedId);

      if (to === null) {
        if (!isPlainHome(location)) {
          inPlaceFeedId = null;
        }
        syncShown();
        return;
      }

      const feed = feedById(savedId);

      const attempt = async (allowDomWait: boolean): Promise<void> => {
        const result = await applyInPlace(feed, true);
        if (result.applied) {
          inPlaceCapable = true;
          pageWorldOverrideActive = feed.feedStyle !== null;
        }
        if (seq !== arrivalSeq || !isPlainHome(location)) {
          return;
        }
        if (result.applied) {
          inPlaceFeedId = feed.id;
          syncShown();
          if (!result.refreshed) {
            // Facebook's module loader is present, but `[role=feed]` has not
            // mounted yet. Trigger the live Relay switch as soon as it does.
            let done = false;
            const stopFeedWatch = featurePage.watch(featurePage.locate(FEED_CONTAINER), {
              added: () => {
                if (done || seq !== arrivalSeq || !isPlainHome(location)) {
                  return;
                }
                done = true;
                clearPendingRefresh();
                void applyInPlace(feed, true);
              },
            });
            if (done) {
              stopFeedWatch();
            } else {
              pendingFeedWatch = stopFeedWatch;
            }
          }
          return;
        }
        // At `document_start`, Facebook's head scripts may not have defined
        // `window.require` yet. Wait once for DOMContentLoaded before falling
        // back to URL redirection.
        if (allowDomWait && document.readyState === 'loading') {
          let removeReadyCleanup: (() => void) | undefined;
          const onReady = (): void => {
            removeReadyCleanup?.();
            if (seq === arrivalSeq && isPlainHome(location)) {
              void attempt(false);
            }
          };
          document.addEventListener('DOMContentLoaded', onReady, { once: true });
          removeReadyCleanup = scope.add(() =>
            document.removeEventListener('DOMContentLoaded', onReady),
          );
          return;
        }
        fallbackMove(to);
      };

      void attempt(true);
    };

    arrived();
    scope.add(onUrlChange(arrived));

    // Presses on Home / Logo are redirected only when in-place switching is not active.
    let presses: ReturnType<typeof child> | undefined;
    options.watch('home_feed', (id) => {
      if (id === FACEBOOK_FEED) {
        presses?.scope.dispose();
        presses = undefined;
        if (inPlaceCapable && pageWorldOverrideActive) {
          pageWorldOverrideActive = false;
          inPlaceFeedId = null;
          void featurePage.bridge.setHomeFeed(null, isPlainHome(location)).catch(() => undefined);
          syncShown();
        }
      } else if (!presses) {
        presses = child();
        sendHomePresses(presses.scope, choice.get, () => !inPlaceCapable);
      }
    });

    const pick = (feed: FeedEntry): void => {
      if (isPlainHome(location)) {
        // Clear `pageWorldOverrideActive` before saving `home` so the `home_feed`
        // watcher does not fire a duplicate `setHomeFeed(null, true)` refetch.
        if (feed.feedStyle === null) {
          pageWorldOverrideActive = false;
          inPlaceFeedId = null;
        }
        options.set('home_feed', feed.id).catch((error: unknown) => {
          log.error('could not save the feed', error);
        });
        void applyInPlace(feed, true).then((result) => {
          if (result.applied && (result.refreshed || feed.feedStyle === null)) {
            inPlaceCapable = true;
            pageWorldOverrideActive = feed.feedStyle !== null;
            inPlaceFeedId = feed.feedStyle === null ? null : feed.id;
            syncShown();
            return;
          }
          if (!shows(location, feed.address)) {
            moveTo(feed.address);
          }
        });
        return;
      }

      if (inPlaceCapable) {
        // Update page-world `activeFeedStyle` BEFORE navigating back to `/` so
        // Facebook's route preload uses the newly picked feed (or restores Home).
        pageWorldOverrideActive = feed.feedStyle !== null;
        inPlaceFeedId = feed.feedStyle === null ? null : feed.id;
        options.set('home_feed', feed.id).catch((error: unknown) => {
          log.error('could not save the feed', error);
        });
        void applyInPlace(feed, false).finally(() => {
          moveTo(HOME_ADDRESS);
        });
        return;
      }

      options.set('home_feed', feed.id).catch((error: unknown) => {
        log.error('could not save the feed', error);
      });

      if (!shows(location, feed.address)) {
        moveTo(feed.address);
      }
    };

    /** Marks the top-bar Home link active (blue underline + accent icon) on alternate feeds. */
    const homeLinks = new Set<Element>();
    let activeHomeScope: Scope | undefined;
    const syncHomeActive = (): void => {
      const prev = activeHomeScope;
      activeHomeScope = undefined;
      if (isAlternateHomeFeed(location)) {
        const next = scope.child();
        for (const link of homeLinks) {
          if (link.isConnected && link.getAttribute('aria-current') !== 'page') {
            markElement(next, link, HOME_ACTIVE);
          }
        }
        activeHomeScope = next;
      }
      prev?.dispose();
    };
    scope.add(onUrlChange(syncHomeActive));

    featurePage.watch(
      featurePage.locate(TOP_BAR_HOME),
      {
        added: (link) => {
          homeLinks.add(link);
          syncHomeActive();
        },
        removed: (link) => {
          homeLinks.delete(link);
          syncHomeActive();
        },
        changed: () => syncHomeActive(),
      },
      { attributes: ['aria-current'] },
    );

    /**
     * Suppresses Facebook's plain "Home" tooltip whenever a custom Home feed is
     * saved and the user is hovering/focusing the Home link, so our centered
     * "Home | <Feed>" tooltip replaces it cleanly without mutating React text.
     */
    const isHomeHoveredOrFocused = (): boolean => {
      for (const link of homeLinks) {
        if (
          link.isConnected &&
          (link.matches(':hover') ||
            document.activeElement === link ||
            link.contains(document.activeElement))
        ) {
          return true;
        }
      }
      return false;
    };
    let tipWatchScope: Scope | undefined;
    const syncTooltipSuppression = (): void => {
      const want = choice.get() !== FACEBOOK_FEED && options.get('home_feed_menu');
      if (!want) {
        tipWatchScope?.dispose();
        tipWatchScope = undefined;
        return;
      }
      if (tipWatchScope) {
        return;
      }
      const next = scope.child();
      tipWatchScope = next;
      const releases = new Map<Element, () => void>();
      const stopTipWatch = featurePage.watch(featurePage.locate(TOOLTIP), {
        added: (tipEl) => {
          if (isHomeHoveredOrFocused() && tipEl.textContent?.trim() === 'Home') {
            releases.set(tipEl, hideElement(next, tipEl));
          }
        },
        removed: (tipEl) => {
          releases.get(tipEl)?.();
          releases.delete(tipEl);
        },
      });
      next.add(() => {
        stopTipWatch();
        releases.clear();
      });
    };
    options.watch('home_feed', syncTooltipSuppression);
    options.watch('home_feed_menu', syncTooltipSuppression);

    const toggleFeature = (
      key: 'home_feed_menu' | 'home_feed_composer' | 'home_feed_rails',
      run: (page: FacebookPage, subScope: Scope) => void,
    ): void => {
      let current: ReturnType<typeof child> | undefined;
      options.watch(key, (on) => {
        current?.scope.dispose();
        current = undefined;
        if (on) {
          current = child();
          run(current.page, current.scope);
        }
      });
    };

    /** Minimum width of the Home cell at which its inline caret is shown. */
    const MIN_HOME_WIDTH = 40;

    const showMenu = (page: FacebookPage, menuScope: Scope): void => {
      const homeOverlays = new Map<Element, () => void>();
      const actionOverlays = new Map<Element, () => void>();
      const fallback = watchedValue(false, log);

      const syncFallback = (): void => {
        let homePresent = false;
        let homeVisible = false;
        for (const link of homeOverlays.keys()) {
          if (!link.isConnected) {
            continue;
          }
          homePresent = true;
          if (link.getBoundingClientRect().width >= MIN_HOME_WIDTH) {
            homeVisible = true;
            break;
          }
        }
        let actionsVisible = false;
        for (const actions of actionOverlays.keys()) {
          if (actions.isConnected && actions.getBoundingClientRect().width > 0) {
            actionsVisible = true;
            break;
          }
        }
        fallback.set(homePresent && !homeVisible && actionsVisible);
      };

      page.watch(page.locate(TOP_BAR_HOME), {
        added: (link) => {
          homeOverlays.get(link)?.();
          homeOverlays.set(
            link,
            mountOverlay(
              link,
              <FeedMenu feeds={FEEDS} choice={choice} shown={shown} anchor={link} onPick={pick} />,
              { css, onMeasure: syncFallback, zIndex: 10 },
            ),
          );
          syncFallback();
        },
        removed: (link) => {
          homeOverlays.get(link)?.();
          homeOverlays.delete(link);
          syncFallback();
        },
      });

      page.watch(page.locate(TOP_BAR_ACTIONS), {
        added: (actions) => {
          actionOverlays.get(actions)?.();
          actionOverlays.set(
            actions,
            mountOverlay(
              actions,
              <FeedMenu
                feeds={FEEDS}
                choice={choice}
                shown={shown}
                anchor={actions}
                onPick={pick}
                mode="toolbar"
                visible={fallback}
              />,
              { css, onMeasure: syncFallback, zIndex: 10 },
            ),
          );
          syncFallback();
        },
        removed: (actions) => {
          actionOverlays.get(actions)?.();
          actionOverlays.delete(actions);
          syncFallback();
        },
      });

      addEventListener('resize', syncFallback);
      menuScope.add(() => {
        removeEventListener('resize', syncFallback);
        for (const unmount of homeOverlays.values()) {
          unmount();
        }
        homeOverlays.clear();
        for (const unmount of actionOverlays.values()) {
          unmount();
        }
        actionOverlays.clear();
      });
    };

    toggleFeature('home_feed_menu', showMenu);

    const showComposer = (page: FacebookPage, composerScope: Scope): void => {
      const readAvatar = (): string | null =>
        avatarSrcFromElement(page.locate(TOP_BAR_AVATAR).first(document));
      const state = watchedValue<ComposerState>(
        { shortName: null, userId: null, avatarSrc: readAvatar() },
        log,
      );
      let infoLoaded = false;

      const updateState = (changes: Partial<ComposerState>): void => {
        const current = state.get();
        const next: ComposerState = { ...current, ...changes };
        if (
          next.shortName !== current.shortName ||
          next.userId !== current.userId ||
          next.avatarSrc !== current.avatarSrc
        ) {
          state.set(next);
        }
      };

      const loadUserInfo = (anchor: Element): void => {
        if (infoLoaded) {
          return;
        }
        infoLoaded = true;
        void page.bridge
          .composerInfo(anchor)
          .then((info) => {
            if (info) {
              updateState({ shortName: info.shortName, userId: info.userId });
            }
          })
          .catch((error: unknown) => {
            if (isUnexpectedBridgeError(error)) {
              log.debug('could not read user info for post composer', error);
            }
          });
      };

      const openComposer = (mode: ComposerMode): void => {
        void page.bridge.openPostComposer(mode).catch((error: unknown) => {
          if (isUnexpectedBridgeError(error)) {
            log.error('could not open post composer', error);
          }
        });
      };

      whileOnRoute(composerScope, isAlternateHomeFeed, (routeScope) => {
        const feedScopes = new Map<Element, Scope>();
        if (!state.get().avatarSrc) {
          const initial = readAvatar();
          if (initial) {
            updateState({ avatarSrc: initial });
          } else {
            let foundAvatar = false;
            let stopAvatar: (() => void) | undefined;
            stopAvatar = page.watch(page.locate(TOP_BAR_AVATAR), {
              added: (el) => {
                const src = avatarSrcFromElement(el);
                if (src) {
                  foundAvatar = true;
                  updateState({ avatarSrc: src });
                  stopAvatar?.();
                }
              },
            });
            if (foundAvatar) {
              stopAvatar();
            } else {
              routeScope.add(stopAvatar);
            }
          }
        }
        const stopFeeds = page.watch(page.locate(FEED_CONTAINER), {
          added: (feed) => {
            if (feedScopes.has(feed) || page.locate(FEED_COMPOSER).first(document) !== null) {
              return;
            }
            if (!state.get().avatarSrc) {
              updateState({ avatarSrc: readAvatar() });
            }
            loadUserInfo(feed);
            const itemScope = routeScope.child();
            const host = document.createElement(HOST_TAG);
            host.id = COMPOSER_HOST_ID;
            host.style.display = 'block';
            host.style.width = '100%';
            mountSlot(itemScope, feed, 'before', host);
            itemScope.add(
              renderInShadow(
                host,
                <FeedComposer state={state} onOpen={openComposer} />,
                composerCss,
              ),
            );
            feedScopes.set(feed, itemScope);
          },
          removed: (feed) => {
            feedScopes.get(feed)?.dispose();
            feedScopes.delete(feed);
          },
        });
        routeScope.add(() => {
          stopFeeds();
          feedScopes.clear();
        });
      });
    };

    toggleFeature('home_feed_composer', showComposer);

    /**
     * Replaces Facebook's fixed Feeds left sidebar with responsive Home left
     * and right rails on alternate feed URLs (`/?filter=...&sk=h_chr`, `/?sk=h_chr`).
     */
    const showHomeRails = (page: FacebookPage, railsScope: Scope): void => {
      whileOnRoute(railsScope, isAlternateHomeFeed, (routeScope) => {
        const mainScopes = new Map<Element, Scope>();
        const mains = new Set<Element>();

        const mountRailSlot = (
          itemScope: Scope,
          main: Element,
          spec: {
            id: string;
            role: string;
            ariaLabel: string;
            placement: 'before' | 'after';
            label: string;
            mount: (slot: Element, signal: AbortSignal) => Promise<(() => void) | null>;
            onMounted?: (slotScope: Scope) => void;
          },
        ): void => {
          const slotScope = itemScope.child();
          const slot = document.createElement('div');
          slot.id = spec.id;
          slot.setAttribute('role', spec.role);
          slot.setAttribute('aria-label', spec.ariaLabel);
          mountSlot(slotScope, main, spec.placement, slot);
          const controller = new AbortController();
          slotScope.add(() => controller.abort());
          void spec
            .mount(slot, controller.signal)
            .then((handle) => {
              if (!handle) {
                // Remove empty slot if Facebook's rail declined to mount.
                slotScope.dispose();
                return;
              }
              slotScope.add(handle);
              if (!slotScope.disposed) {
                spec.onMounted?.(slotScope);
              }
            })
            .catch((error: unknown) => {
              slotScope.dispose();
              if (isUnexpectedBridgeError(error)) {
                log.debug(`could not mount ${spec.label}`, error);
              }
            });
        };

        const tryAttach = (main: Element): void => {
          if (mainScopes.has(main)) {
            return;
          }
          const parent = main.parentElement;
          const feedsLeftRail = findFeedsLeftRail(main, page.locate);
          if (!parent || !feedsLeftRail) {
            return;
          }
          const itemScope = routeScope.child();
          markElement(itemScope, parent, HOME_LAYOUT);

          mountRailSlot(itemScope, main, {
            id: LEFT_RAIL_ID,
            role: 'navigation',
            ariaLabel: 'Shortcuts',
            placement: 'before',
            label: 'home left rail',
            mount: (slot, signal) => page.bridge.mountHomeLeftRail(slot, signal),
            onMounted: (slotScope) => {
              // Only hide Facebook's native Feeds sidebar once our replacement
              // Home left rail actually mounted, so a bridge failure never
              // leaves the user without navigation.
              hideElement(slotScope, feedsLeftRail);
            },
          });
          mountRailSlot(itemScope, main, {
            id: RIGHT_RAIL_ID,
            role: 'complementary',
            ariaLabel: 'Sidebar',
            placement: 'after',
            label: 'home right rail',
            mount: (slot, signal) => page.bridge.mountHomeRightRail(slot, signal),
          });

          mainScopes.set(main, itemScope);
        };

        const stopMain = page.watch(page.locate(FEED_MAIN), {
          added: (main) => {
            mains.add(main);
            tryAttach(main);
          },
          removed: (main) => {
            mains.delete(main);
            mainScopes.get(main)?.dispose();
            mainScopes.delete(main);
          },
        });
        // Also retry when the fixed Feeds sidebar mounts after `[role=main]`.
        const stopNav = page.watch(page.locate(FEEDS_LEFT_RAIL), {
          added: () => {
            for (const main of mains) {
              tryAttach(main);
            }
          },
        });
        routeScope.add(() => {
          stopMain();
          stopNav();
          mains.clear();
          mainScopes.clear();
        });
      });
    };

    toggleFeature('home_feed_rails', showHomeRails);
  },
});
