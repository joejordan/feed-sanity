import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Watched } from '../../ui/watched';
import type { FeedEntry } from './feeds';
import { TIP_DELAY_MS } from '../../ui/tooltip';
import { CARET_NAME, FeedMenu, MENU_NAME, placeMenu } from './feed-menu';
import { FEEDS } from './feeds';

/** A value the test changes, as the feature's are. */
function value<T>(initial: T): Watched<T> & { set: (next: T) => void } {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      current = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

const caret = () => screen.getByRole<HTMLButtonElement>('button', { name: CARET_NAME });
const menu = () => screen.queryByRole('menu', { name: MENU_NAME });
const entry = (name: string) => screen.getByRole('menuitemradio', { name });
const focused = () => document.activeElement?.textContent;

afterEach(cleanup);

describe('FeedMenu', () => {
  let choice: ReturnType<typeof value<string>>;
  let shown: ReturnType<typeof value<string | null>>;
  let onPick: ReturnType<typeof vi.fn<(feed: FeedEntry) => void>>;
  /** Facebook's Home link, and the house icon in it. */
  let anchor: HTMLAnchorElement;
  let icon: HTMLElement;

  beforeEach(() => {
    choice = value('home');
    shown = value<string | null>('home');
    onPick = vi.fn();
    anchor = document.createElement('a');
    icon = document.createElement('span');
    anchor.append(icon);
    document.body.append(anchor);
    render(
      <FeedMenu feeds={FEEDS} choice={choice} shown={shown} anchor={anchor} onPick={onPick} />,
    );
  });

  it('is a menu button that opens a menu of every feed, with the saved one checked', async () => {
    expect(caret().getAttribute('aria-haspopup')).toBe('menu');
    expect(caret().getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();

    await userEvent.click(caret());

    expect(caret().getAttribute('aria-expanded')).toBe('true');
    expect(caret().getAttribute('aria-controls')).toBe(menu()?.id);
    const entries = screen.getAllByRole('menuitemradio');
    expect(entries.map((item) => item.textContent)).toEqual([
      'Home',
      'Friends',
      'Favorites',
      'Groups',
      'Pages',
      'Most recent',
    ]);
    expect(entries.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
    // Facebook's own feed apart from the others.
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(focused()).toBe('Home');
  });

  it('moves with the arrow keys, Home and End, going round at the ends', async () => {
    await userEvent.click(caret());

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(focused()).toBe('Favorites');
    await userEvent.keyboard('{End}');
    expect(focused()).toBe('Most recent');
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe('Home');
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Most recent');
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe('Home');
  });

  it('picks with Enter or Space, closes and gives focus back to the caret', async () => {
    await userEvent.click(caret());
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'friends' }));
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(caret());

    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Most recent');
    await userEvent.keyboard(' ');
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'all' }));
  });

  it('picks the entry that is clicked', async () => {
    await userEvent.click(caret());
    await userEvent.click(entry('Groups'));

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'groups' }));
    expect(menu()).toBeNull();
  });

  it('closes on Escape, giving focus back to the caret, and picks nothing', async () => {
    await userEvent.click(caret());
    await userEvent.keyboard('{Escape}');

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(caret());
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes on a press outside it, and on a second press of the caret', async () => {
    await userEvent.click(caret());
    fireEvent.pointerDown(document.body);
    expect(menu()).toBeNull();

    await userEvent.click(caret());
    expect(menu()).not.toBeNull();
    await userEvent.click(caret());
    expect(menu()).toBeNull();
  });

  it('closes when focus goes elsewhere, as when a press it does not hear takes it', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    await userEvent.click(caret());
    expect(menu()).not.toBeNull();

    act(() => outside.focus());

    expect(menu()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('stays open while focus moves inside it', async () => {
    await userEvent.click(caret());
    await userEvent.keyboard('{ArrowDown}');
    act(() => menu()?.focus());

    expect(menu()).not.toBeNull();
  });

  it('closes when the page moves to another feed', async () => {
    await userEvent.click(caret());

    act(() => shown.set('friends'));

    expect(menu()).toBeNull();
  });

  it('marks the entry with focus only while the keyboard is in use', async () => {
    await userEvent.click(caret());
    expect(menu()?.classList.contains('keys')).toBe(false);

    await userEvent.keyboard('{ArrowDown}');
    expect(menu()?.classList.contains('keys')).toBe(true);

    fireEvent.pointerMove(entry('Groups'));
    expect(menu()?.classList.contains('keys')).toBe(false);

    await userEvent.keyboard('{Escape}{Enter}');
    expect(menu()?.classList.contains('keys')).toBe(true);
  });

  describe("Facebook's own Home tooltip", () => {
    /** The pointer events that reached Facebook's listeners on the page. */
    let heard: Event[];
    let listening: AbortController;

    beforeEach(() => {
      heard = [];
      listening = new AbortController();
      for (const type of [
        'pointerover',
        'pointerout',
        'pointermove',
        'mouseover',
        'mouseout',
        'mousemove',
      ]) {
        document.addEventListener(type, (event) => heard.push(event), listening);
      }
    });

    afterEach(() => listening.abort());

    it('does not hear the pointer over the caret or the menu', async () => {
      fireEvent.pointerOver(caret());
      fireEvent.pointerMove(caret());
      fireEvent.mouseMove(caret());
      await userEvent.click(caret());
      heard = [];
      fireEvent.mouseOver(entry('Friends'));
      fireEvent.pointerMove(entry('Friends'));

      expect(heard).toEqual([]);
    });

    it('is told the pointer left Home when it comes onto the caret, once its own listeners have heard the move', async () => {
      fireEvent.pointerEnter(caret(), { clientX: 560, clientY: 28 });
      expect(heard).toEqual([]);

      await vi.waitFor(() =>
        expect(heard.map((event) => event.type)).toEqual(['pointerout', 'mouseout']),
      );
      expect(heard.every((event) => event.target === anchor)).toBe(true);
      expect(heard.every((event) => (event as MouseEvent).relatedTarget === document.body)).toBe(
        true,
      );
      // Facebook ignores pointer events at 0, 0.
      expect(
        heard.map((event) => [(event as MouseEvent).clientX, (event as MouseEvent).clientY]),
      ).toEqual([
        [560, 28],
        [560, 28],
      ]);
    });

    it('is told the pointer came back when it goes from the caret to the house icon', async () => {
      fireEvent.pointerLeave(caret(), { relatedTarget: icon });

      await vi.waitFor(() =>
        expect(heard.map((event) => event.type)).toEqual(['pointerover', 'mouseover']),
      );
      expect(heard[0]?.target).toBe(icon);
    });

    it('is told nothing when the pointer leaves the caret for elsewhere, or for the open menu', async () => {
      fireEvent.pointerLeave(caret(), { relatedTarget: document.body });
      await userEvent.click(caret());
      heard = [];
      fireEvent.pointerLeave(caret(), { relatedTarget: icon });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(heard).toEqual([]);
    });
  });

  it('opens with the arrow keys from the caret', async () => {
    caret().focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe('Most recent');

    await userEvent.keyboard('{Escape}{ArrowDown}');
    expect(focused()).toBe('Home');
  });

  it('follows the saved feed and the feed the page shows', async () => {
    expect(caret().classList.contains('chosen')).toBe(false);

    act(() => {
      choice.set('friends');
      shown.set('pages');
    });
    expect(caret().classList.contains('chosen')).toBe(true);
    await userEvent.click(caret());

    expect(entry('Friends').getAttribute('aria-checked')).toBe('true');
    expect(entry('Home').getAttribute('aria-checked')).toBe('false');
    expect(entry('Pages').getAttribute('aria-current')).toBe('page');
    expect(entry('Friends').hasAttribute('aria-current')).toBe(false);
    expect(focused()).toBe('Friends');

    act(() => choice.set('home'));
    expect(entry('Home').getAttribute('aria-checked')).toBe('true');
    expect(caret().classList.contains('chosen')).toBe(false);
  });

  it('names itself in a tooltip after the pointer rests on it', () => {
    vi.useFakeTimers();
    try {
      fireEvent.pointerEnter(caret());
      expect(screen.queryByRole('tooltip')).toBeNull();

      act(() => {
        vi.advanceTimersByTime(TIP_DELAY_MS);
      });
      expect(screen.getByRole('tooltip').textContent).toBe(CARET_NAME);

      fireEvent.pointerDown(caret());
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('placeMenu', () => {
  it('centres the menu under the Home cell, 5 pixels below it', () => {
    expect(placeMenu({ left: 506, width: 130, bottom: 56 }, 1707)).toEqual({
      left: 431,
      top: 61,
      width: 280,
    });
  });

  it('keeps the menu inside the window', () => {
    expect(placeMenu({ left: 0, width: 60, bottom: 56 }, 1000).left).toBe(8);
    expect(placeMenu({ left: 950, width: 60, bottom: 56 }, 1000).left).toBe(712);
    expect(placeMenu({ left: 0, width: 60, bottom: 56 }, 200)).toEqual({
      left: 8,
      top: 61,
      width: 184,
    });
  });
});
