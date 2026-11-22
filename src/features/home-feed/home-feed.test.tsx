import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { MockInstance } from 'vitest';
import { startFeatures } from '../../core/app';
import { Options } from '../../core/options';
import { SavedData } from '../../core/saved';
import { bindPage } from '../../facebook/feature';
import { FakeResizeObserver, placeAt, videoPage } from '../../facebook/testing';
import { extensionStore } from '../../platform/extension-store';
import { HOST_TAG } from '../../ui/mount';
import homeFeed from '.';
import { CARET_NAME } from './feed-menu';
import { loader, noteMove } from './rules';

const FRIENDS = '/?filter=friends&sk=h_chr';

/** Facebook's top bar as measured on 2026-11-14, and the Feeds links of its left column. */
const PAGE = `
  <div role="navigation" aria-label="Facebook"><ul>
    <li><span><div style="position: relative; display: flex"><a role="link" href="/" aria-label="Home" tabindex="0"><svg width="24" height="24"></svg></a></div></span></li>
    <li><span><div style="position: relative; display: flex"><a role="link" href="/watch/" aria-label="Video" tabindex="0"><svg></svg></a></div></span></li>
  </ul></div>
  <div role="navigation" aria-label="Feeds"><a id="friends" href="${FRIENDS}">Friends</a></div>`;

const homeLink = () =>
  document.querySelector<HTMLAnchorElement>('a[aria-label=Home]') as HTMLElement;
const shadow = () => homeLink().parentElement?.querySelector(`:scope > ${HOST_TAG}`)?.shadowRoot;
const caret = () => shadow()?.querySelector<HTMLButtonElement>(`[aria-label="${CARET_NAME}"]`);
const entry = (name: string) =>
  [...(shadow()?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [])].find(
    (item) => item.textContent === name,
  );

/** The caret, once it is drawn. */
const caretShown = () =>
  vi.waitFor(() => {
    const found = caret();
    if (!found) {
      throw new Error('no caret yet');
    }
    return found;
  });

describe('home_feed', () => {
  let options: Options;
  let replace: MockInstance<(address: string) => void>;
  let assign: MockInstance<(address: string) => void>;
  /** Presses and clicks that reached Facebook's own listener on its Home link. */
  let homePressed: string[];
  /** Clicks that reached Facebook's own Friends link. */
  let friendsClicked: number;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    fakeBrowser.reset();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
    document.body.innerHTML = PAGE;
    homePressed = [];
    friendsClicked = 0;
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      homeLink().addEventListener(type, (event) => {
        if (type === 'click') {
          // Facebook moves there itself, without a reload.
          event.preventDefault();
        }
        homePressed.push(type);
      });
    }
    document.querySelector('#friends')?.addEventListener('click', (event) => {
      // Facebook moves there itself, without a reload.
      event.preventDefault();
      friendsClicked++;
      history.pushState({}, '', FRIENDS);
    });
    replace = vi.spyOn(loader, 'replace').mockImplementation(() => undefined);
    assign = vi.spyOn(loader, 'assign').mockImplementation(() => undefined);
  });

  /** The features each test started. */
  const started: Options[] = [];
  let user = 0;

  afterEach(async () => {
    // The feature has no switch to stop it, so it is left with nothing to
    // do. Each test saves under a user of its own, so it stays that way.
    for (const each of started.splice(0)) {
      await each.set('home_feed', 'home');
      await each.set('home_feed_menu', false);
      await each.set('home_feed_composer', false);
    }
    vi.unstubAllGlobals();
  });

  const start = async (saved: Record<string, unknown> = {}): Promise<void> => {
    user++;
    await browser.storage.local.set({ [`${user}/options`]: saved });
    options = new Options(extensionStore, `${user}/options`);
    started.push(options);
    const data = new SavedData(extensionStore, String(user));
    expect(await startFeatures([homeFeed], options, bindPage(videoPage()), data)).toEqual([]);
  };

  describe('on arrival', () => {
    it('replaces a full load of the plain home address with the saved feed', async () => {
      await start({ home_feed: 'friends' });

      expect(replace).toHaveBeenCalledExactlyOnceWith(FRIENDS);
    });

    it("leaves the load alone with Facebook's own feed saved, or on another address", async () => {
      await start();
      expect(replace).not.toHaveBeenCalled();

      history.replaceState({}, '', '/?notif_id=1&ref=notif');
      await start({ home_feed: 'friends' });
      expect(replace).not.toHaveBeenCalled();
    });

    it('does not move again just after a move, so a feed Facebook sends back cannot loop', async () => {
      noteMove();

      await start({ home_feed: 'friends' });

      expect(replace).not.toHaveBeenCalled();
    });

    it('replaces the address when Back or Facebook returns to the plain home address', async () => {
      history.replaceState({}, '', '/groups/');
      await start({ home_feed: 'pages' });
      expect(replace).not.toHaveBeenCalled();

      history.pushState({}, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));

      expect(replace).toHaveBeenCalledExactlyOnceWith('/?filter=pages&sk=h_chr');
    });
  });

  describe('presses of Home', () => {
    it("go to the saved feed through Facebook's own link, kept from Facebook", async () => {
      await start({ home_feed: 'friends', home_feed_menu: false });
      history.replaceState({}, '', '/groups/');

      await userEvent.click(homeLink());

      expect(homePressed).toEqual([]);
      expect(friendsClicked).toBe(1);
      expect(location.search).toBe('?filter=friends&sk=h_chr');
      expect(assign).not.toHaveBeenCalled();
    });

    it('load the feed when the page has no link to it', async () => {
      await start({ home_feed: 'favorites', home_feed_menu: false });
      history.replaceState({}, '', '/groups/');

      await userEvent.click(homeLink());

      expect(assign).toHaveBeenCalledExactlyOnceWith('/?filter=favorites&sk=h_chr');
    });

    it('go to the saved feed from the keyboard too', async () => {
      await start({ home_feed: 'favorites', home_feed_menu: false });
      history.replaceState({}, '', '/groups/');
      homeLink().focus();

      await userEvent.keyboard('{Enter}');

      expect(assign).toHaveBeenCalledExactlyOnceWith('/?filter=favorites&sk=h_chr');
    });

    it('end with a press let go outside the window, so a later key press goes nowhere', async () => {
      await start({ home_feed: 'favorites', home_feed_menu: false });
      history.replaceState({}, '', '/groups/');
      const other = document.createElement('button');
      document.body.append(other);
      const otherClicked = vi.fn();
      other.addEventListener('click', otherClicked);

      homeLink().dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }),
      );
      other.focus();
      await userEvent.keyboard('{Enter}');

      expect(otherClicked).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
    });

    it("go to Facebook with a modifier key, or with Facebook's own feed saved", async () => {
      await start({ home_feed: 'friends', home_feed_menu: false });
      history.replaceState({}, '', '/groups/');

      const person = userEvent.setup();
      await person.keyboard('{Control>}');
      await person.click(homeLink());
      await person.keyboard('{/Control}');
      expect(homePressed).toContain('click');

      await options.set('home_feed', 'home');
      homePressed = [];
      await userEvent.click(homeLink());
      expect(homePressed).toEqual(['pointerdown', 'mousedown', 'click']);
      expect(friendsClicked).toBe(0);
      expect(assign).not.toHaveBeenCalled();
    });
  });

  describe('the menu', () => {
    it('puts a caret in the Home cell that opens the menu, and a press on it never reaches Home', async () => {
      await start();
      const button = await caretShown();
      expect(button.getAttribute('aria-haspopup')).toBe('menu');

      await userEvent.click(button);

      expect(homePressed).toEqual([]);
      await vi.waitFor(() => expect(entry('Home')?.getAttribute('aria-checked')).toBe('true'));
      expect(entry('Home')?.getAttribute('aria-current')).toBe('page');
    });

    it('saves the feed picked and goes there, and Home then lands on it', async () => {
      await start();
      await userEvent.click(await caretShown());
      await vi.waitFor(() => expect(entry('Friends')).toBeDefined());

      await userEvent.click(entry('Friends') as HTMLElement);

      expect(options.get('home_feed')).toBe('friends');
      expect(friendsClicked).toBe(1);
      expect(location.search).toBe('?filter=friends&sk=h_chr');
      await vi.waitFor(() => expect(caret()?.classList).toContain('chosen'));

      history.replaceState({}, '', '/groups/');
      await userEvent.click(homeLink());
      expect(friendsClicked).toBe(2);
      expect(homePressed).toEqual([]);
    });

    it("goes back to Facebook's own feed when Home is picked", async () => {
      history.replaceState({}, '', FRIENDS);
      await start({ home_feed: 'friends' });
      await userEvent.click(await caretShown());
      await vi.waitFor(() => expect(entry('Friends')?.getAttribute('aria-current')).toBe('page'));

      await userEvent.click(entry('Home') as HTMLElement);

      expect(options.get('home_feed')).toBe('home');
      // Through Facebook's own Home link, which Facebook then follows.
      expect(homePressed).toEqual(['click']);
      await vi.waitFor(() => expect(caret()?.classList).not.toContain('chosen'));
    });

    it('follows a feed saved from the options dialog', async () => {
      await start();
      const button = await caretShown();

      await options.set('home_feed', 'groups');
      await vi.waitFor(() => expect(button.classList).toContain('chosen'));

      await userEvent.click(button);
      await vi.waitFor(() => expect(entry('Groups')?.getAttribute('aria-checked')).toBe('true'));
    });

    it('goes when its switch goes off, and comes back when it goes on', async () => {
      await start();
      await caretShown();

      await options.set('home_feed_menu', false);
      expect(document.querySelector(HOST_TAG)).toBeNull();

      await options.set('home_feed_menu', true);
      await caretShown();
    });

    it('comes back when Facebook draws the top bar again', async () => {
      await start();
      await caretShown();

      document.body.innerHTML = PAGE;

      await caretShown();
      expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    });

    it('shows a fallback button beside the right top-bar actions only when Home collapses', async () => {
      document.body.innerHTML = `
        <div role="banner">
          ${PAGE}
          <div style="position: fixed; right: 0">
            <div role="navigation" aria-label="Account Controls and Settings" id="actions">
              <div><div role="button" aria-label="Facebook menu"></div></div>
              <div><div role="button" aria-label="Messenger"></div></div>
            </div>
          </div>
        </div>`;
      const home = homeLink();
      const actions = document.querySelector('#actions') as HTMLElement;
      placeAt(home, 352, 0, 130, 56);
      placeAt(actions, 1185, 0, 184, 56);

      await start();
      await caretShown();
      const actionShadow = () =>
        actions.parentElement?.querySelector(`:scope > ${HOST_TAG}`)?.shadowRoot;
      const fallbackButton = () =>
        actionShadow()?.querySelector<HTMLButtonElement>(`[aria-label="${CARET_NAME}"]`);

      // Wide: inline caret is visible, fallback is hidden.
      expect(fallbackButton()).toBeNull();

      // Mid-narrow (50 px): still enough for the compact inline caret, no fallback yet.
      placeAt(home, 206, 0, 50, 56);
      FakeResizeObserver.latest?.report([home]);
      expect(fallbackButton()).toBeNull();

      // Narrow (<= 700 px): Facebook hides the middle cells (width 0), fallback appears.
      placeAt(home, 0, 0, 0, 0);
      FakeResizeObserver.latest?.report([home]);
      await vi.waitFor(() => expect(fallbackButton()).not.toBeNull());

      await userEvent.click(fallbackButton() as HTMLElement);
      const friendsEntry = [
        ...(actionShadow()?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? []),
      ].find((item) => item.textContent === 'Friends');
      await userEvent.click(friendsEntry as HTMLElement);
      expect(options.get('home_feed')).toBe('friends');

      // Widening back restores the Home cell and hides the fallback button.
      placeAt(home, 352, 0, 130, 56);
      FakeResizeObserver.latest?.report([home]);
      await vi.waitFor(() => expect(fallbackButton()).toBeNull());
    });

    it('does not show the fallback button on pages that have no Home button at all', async () => {
      document.body.innerHTML = `
        <div role="banner">
          <div role="navigation" aria-label="Account" id="actions">
            <div role="button" aria-label="Menu"></div>
          </div>
        </div>`;
      const actions = document.querySelector('#actions') as HTMLElement;
      placeAt(actions, 1185, 0, 184, 56);

      await start();
      const actionShadow = actions.parentElement?.querySelector(`:scope > ${HOST_TAG}`)?.shadowRoot;
      expect(actionShadow?.querySelector(`[aria-label="${CARET_NAME}"]`)).toBeNull();
    });
  });
});
