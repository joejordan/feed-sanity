import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Watched } from '../../ui/watched';
import type { FeedEntry } from './feeds';
import { stopAtHost } from '../../ui/mount';
import { focusedByKeyboard, TIP_DELAY_MS, useTip } from '../../ui/tooltip';
import { FACEBOOK_FEED, feedById } from './feeds';

/** The caret's name, read out and shown in its tooltip. */
export const CARET_NAME = 'Choose feed';

/** The menu's name. */
export const MENU_NAME = 'Feeds';

/** The menu's width, its gap below the Home cell and its margin from the window's edges, in pixels. */
const MENU_WIDTH = 280;
const MENU_GAP = 5;
const EDGE = 8;

/** Where the menu goes: under `anchor`, centred on it, and inside a window `viewport` pixels wide. */
export function placeMenu(
  anchor: Pick<DOMRect, 'bottom' | 'left' | 'width'>,
  viewport: number,
): { left: number; top: number; width: number } {
  const width = Math.max(0, Math.min(MENU_WIDTH, viewport - 2 * EDGE));
  const centred = anchor.left + anchor.width / 2 - width / 2;
  return {
    left: Math.max(EDGE, Math.min(centred, viewport - width - EDGE)),
    top: anchor.bottom + MENU_GAP,
    width,
  };
}

/**
 * Puts the element `ref` holds in the browser's top layer, above the page
 * and every layer of Facebook's, while it is drawn. A browser without
 * popovers draws it where it is.
 */
function useTopLayer(ref: { readonly current: HTMLElement | null }): void {
  useEffect(() => {
    const element = ref.current;
    if (typeof element?.showPopover === 'function') {
      element.showPopover();
    }
  }, [ref]);
}

function Icon({ path, className = 'icon' }: { path: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const CHEVRON = 'm7 10 5 5 5-5';
const CHECK = 'M5 12.5 9.5 17 19 7.5';

/** The events by which the page follows where the pointer is. */
const POINTER_MOVES = [
  'pointerover',
  'pointerout',
  'pointermove',
  'mouseover',
  'mouseout',
  'mousemove',
] as const;

/**
 * Tells the page that the pointer left `element` for somewhere outside it,
 * or came to it from outside, as the browser would have if the caret were
 * not in between. Facebook shows the Home tooltip while it thinks the
 * pointer is over Home. Sent once the page's own listeners have heard the
 * real move, at the place and with the pointer of the move `at`: Facebook
 * ignores pointer events at 0, 0.
 */
function tellPointer(
  element: Element,
  move: 'came' | 'left',
  at: Pick<
    PointerEvent,
    'clientX' | 'clientY' | 'screenX' | 'screenY' | 'pointerId' | 'pointerType' | 'isPrimary'
  >,
): void {
  const init: PointerEventInit = {
    bubbles: true,
    composed: true,
    relatedTarget: document.body,
    clientX: at.clientX,
    clientY: at.clientY,
    screenX: at.screenX,
    screenY: at.screenY,
    pointerId: at.pointerId,
    pointerType: at.pointerType,
    isPrimary: at.isPrimary,
  };
  setTimeout(() => {
    const [pointer, mouse] =
      move === 'left' ? ['pointerout', 'mouseout'] : ['pointerover', 'mouseover'];
    element.dispatchEvent(new PointerEvent(pointer, init));
    element.dispatchEvent(new MouseEvent(mouse, init));
  }, 0);
}

/** The button's tooltip, under it, in the top layer. */
function Tip({ caret }: { caret: HTMLElement }) {
  const tip = useRef<HTMLDivElement>(null);
  useTopLayer(tip);
  const box = caret.getBoundingClientRect();
  const center = Math.max(48, Math.min(box.left + box.width / 2, innerWidth - 48));
  return (
    <div
      ref={tip}
      className="tip"
      role="tooltip"
      popover="manual"
      style={{ left: `${center}px`, top: `${box.bottom + 8}px` }}
    >
      {CARET_NAME}
    </div>
  );
}

/** Where focus goes when the menu opens: the saved choice, or the last entry. */
type Start = 'checked' | 'last';

/** The place of the entry `id` in `feeds`, or 0 when it is not there. */
const indexOf = (feeds: readonly FeedEntry[], id: string): number =>
  Math.max(
    0,
    feeds.findIndex((feed) => feed.id === id),
  );

interface MenuProps {
  id: string;
  feeds: readonly FeedEntry[];
  chosen: string;
  showing: string | null;
  start: Start;
  /** True when the menu was opened from the keyboard. */
  byKeyboard: boolean;
  anchor: Element;
  caret: HTMLElement;
  onPick: (feed: FeedEntry) => void;
  /** Closes the menu, putting focus back on the caret when asked to. */
  onClose: (focusCaret: boolean) => void;
}

function Menu({
  id,
  feeds,
  chosen,
  showing,
  start,
  byKeyboard,
  anchor,
  caret,
  onPick,
  onClose,
}: MenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const focused = useRef(0);
  // As in Facebook's menus, the entry with focus is marked only while the
  // keyboard is in use.
  const [keys, setKeys] = useState(byKeyboard);
  // Measured once: the top bar does not move while the menu is open.
  const place = useMemo(() => placeMenu(anchor.getBoundingClientRect(), innerWidth), [anchor]);
  useTopLayer(menu);

  const focusAt = useCallback(
    (index: number) => {
      const count = feeds.length;
      items.current[((index % count) + count) % count]?.focus();
    },
    [feeds],
  );

  // Worked out when the menu opens, and kept while it is open.
  const [first] = useState(() => (start === 'last' ? feeds.length - 1 : indexOf(feeds, chosen)));
  useEffect(() => focusAt(first), [focusAt, first]);

  // A press anywhere else, focus leaving it, a move of the window or a
  // switch to another one closes it. A press that another feature keeps
  // from the page may not reach the listener on the window, but it still
  // takes focus away.
  useEffect(() => {
    const element = menu.current;
    const outside = (target: EventTarget | null): boolean =>
      target !== caret && !(target instanceof Node && element?.contains(target));
    const pressed = (event: Event): void => {
      const path = event.composedPath();
      if (!(element && path.includes(element)) && !path.includes(caret)) {
        onClose(false);
      }
    };
    const focusLeft = (event: FocusEvent): void => {
      if (outside(event.relatedTarget)) {
        onClose(false);
      }
    };
    const leave = (): void => onClose(false);
    addEventListener('pointerdown', pressed, true);
    addEventListener('resize', leave);
    addEventListener('blur', leave);
    element?.addEventListener('focusout', focusLeft);
    return () => {
      removeEventListener('pointerdown', pressed, true);
      removeEventListener('resize', leave);
      removeEventListener('blur', leave);
      element?.removeEventListener('focusout', focusLeft);
    };
  }, [caret, onClose]);

  // A move to another page, as after a press on Home, closes it too.
  const shownAtOpen = useRef(showing);
  useEffect(() => {
    if (showing !== shownAtOpen.current) {
      onClose(false);
    }
  }, [showing, onClose]);

  const pick = (feed: FeedEntry | undefined): void => {
    onClose(true);
    if (feed) {
      onPick(feed);
    }
  };

  const onKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    switch (event.key) {
      case 'ArrowDown':
        focusAt(focused.current + 1);
        break;
      case 'ArrowUp':
        focusAt(focused.current - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(feeds.length - 1);
        break;
      case 'Enter':
      case ' ':
        pick(feeds[focused.current]);
        break;
      case 'Escape':
        onClose(true);
        break;
      case 'Tab':
        // Focus moves on, out of the menu.
        onClose(false);
        return;
      default:
        return;
    }
    setKeys(true);
    // Keeps the page from scrolling, and a link or button behind from acting too.
    event.preventDefault();
  };

  return (
    <div
      ref={menu}
      id={id}
      className={keys ? 'menu keys' : 'menu'}
      role="menu"
      aria-label={MENU_NAME}
      // A press on its padding or a line keeps focus in the menu.
      tabIndex={-1}
      popover="manual"
      style={{ left: `${place.left}px`, top: `${place.top}px`, width: `${place.width}px` }}
      onKeyDown={onKeyDown}
    >
      {feeds.map((feed, index) => (
        <div key={feed.id} role="none">
          {index > 0 && feed.group !== feeds[index - 1]?.group && (
            <div className="separator" role="separator" />
          )}
          <div
            ref={(element) => {
              items.current[index] = element;
            }}
            className={feed.id === showing ? 'item current' : 'item'}
            role="menuitemradio"
            aria-checked={feed.id === chosen}
            aria-current={feed.id === showing ? 'page' : undefined}
            tabIndex={-1}
            onFocus={() => {
              focused.current = index;
            }}
            onPointerMove={(event) => {
              if (keys) {
                setKeys(false);
              }
              if (focused.current !== index) {
                event.currentTarget.focus();
              }
            }}
            onClick={() => pick(feed)}
          >
            <Icon path={feed.icon} />
            <span className="label">{feed.label}</span>
            {feed.id === chosen && <Icon path={CHECK} className="check" />}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface FeedMenuProps {
  feeds: readonly FeedEntry[];
  /** The id of the saved feed. */
  choice: Watched<string>;
  /** The id of the feed the page shows, or null when it shows none of them. */
  shown: Watched<string | null>;
  /** The element the menu opens under: Facebook's Home link in `caret` mode. */
  anchor: Element;
  /** Called with the entry the person picked. */
  onPick: (feed: FeedEntry) => void;
  /**
   * `caret` puts a small chevron inside Facebook's Home cell (default);
   * `toolbar` draws a 40 x 40 circular button beside Facebook's right-side
   * top-bar buttons for narrow windows where the middle bar disappears.
   */
  mode?: 'caret' | 'toolbar';
  /** When given, the button is rendered only while its value is true. */
  visible?: Watched<boolean>;
}

const ALWAYS_VISIBLE: Watched<boolean> = {
  get: () => true,
  subscribe: () => () => undefined,
};

/**
 * Opens a menu of feeds from either a small round chevron in Facebook's Home
 * cell (`mode="caret"`) or a 40 x 40 circular button beside Facebook's
 * right-side top-bar buttons (`mode="toolbar"`). The button takes Facebook's
 * accent colour while a feed other than Facebook's own is saved. The menu
 * marks the saved feed with a check and the one the page shows in the accent
 * colour. It is a menu for assistive technology, and works from the keyboard:
 * the arrow keys, Home and End move, Enter and Space pick, and Escape closes it.
 */
export function FeedMenu({
  feeds,
  choice,
  shown,
  anchor,
  onPick,
  mode = 'caret',
  visible = ALWAYS_VISIBLE,
}: FeedMenuProps) {
  const id = useId();
  const chosen = useSyncExternalStore(choice.subscribe, choice.get);
  const showing = useSyncExternalStore(shown.subscribe, shown.get);
  const isVisible = useSyncExternalStore(visible.subscribe, visible.get);
  const [opened, setOpened] = useState<{ start: Start; byKeyboard: boolean } | null>(null);
  const [tip, setTip] = useTip();
  const cell = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);
  const open = opened !== null;
  const isToolbar = mode === 'toolbar';

  // Facebook does not hear the pointer over the button or the menu, so it
  // does not show its own Home tooltip there.
  // The listeners go with the element.
  useEffect(() => {
    if (isVisible && cell.current) {
      stopAtHost(cell.current, POINTER_MOVES);
    }
  }, [isVisible]);

  // Close the menu and tooltip if the button hides (for example, when the
  // window widens again and the Home button returns).
  useEffect(() => {
    if (!isVisible) {
      setOpened(null);
      setTip(false);
    }
  }, [isVisible, setTip]);

  const close = useCallback((focusCaret: boolean) => {
    setOpened(null);
    if (focusCaret) {
      caret.current?.focus();
    }
  }, []);
  const openAt = (start: Start, byKeyboard: boolean): void => {
    setTip(false);
    setOpened({ start, byKeyboard });
  };

  if (!isVisible) {
    return null;
  }

  const baseClass = isToolbar ? 'toolbar-btn' : 'caret';
  const buttonClass = chosen === FACEBOOK_FEED ? baseClass : `${baseClass} chosen`;
  const menuAnchor = isToolbar && caret.current ? caret.current : anchor;

  return (
    <div className={isToolbar ? 'toolbar-slot' : 'cell'} ref={cell}>
      <button
        ref={caret}
        type="button"
        className={buttonClass}
        aria-label={CARET_NAME}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        // A click from the keyboard has no pointer press behind it.
        onClick={(event) => (open ? close(false) : openAt('checked', event.detail === 0))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openAt(event.key === 'ArrowUp' ? 'last' : 'checked', true);
          } else if (event.key === 'Escape') {
            setTip(false);
          }
        }}
        onPointerEnter={(event) => {
          setTip(true, TIP_DELAY_MS);
          if (!isToolbar) {
            tellPointer(anchor, 'left', event);
          }
        }}
        onPointerLeave={(event) => {
          setTip(false);
          if (isToolbar) {
            return;
          }
          // Back onto the house icon: Facebook may show its tooltip again.
          const { relatedTarget } = event;
          if (!open && relatedTarget instanceof Element && anchor.contains(relatedTarget)) {
            tellPointer(relatedTarget, 'came', event);
          }
        }}
        onPointerDown={() => setTip(false)}
        onFocus={(event) => setTip(!open && focusedByKeyboard(event.currentTarget))}
        onBlur={() => setTip(false)}
      >
        {isToolbar ? (
          <>
            <Icon path={feedById(chosen).icon} className="toolbar-icon" />
            <Icon path={CHEVRON} className="toolbar-chevron" />
          </>
        ) : (
          <Icon path={CHEVRON} className="chevron" />
        )}
      </button>
      {tip && !open && caret.current && <Tip caret={caret.current} />}
      {opened && caret.current && (
        <Menu
          id={`${id}-menu`}
          feeds={feeds}
          chosen={chosen}
          showing={showing}
          start={opened.start}
          byKeyboard={opened.byKeyboard}
          anchor={menuAnchor}
          caret={caret.current}
          onPick={onPick}
          onClose={close}
        />
      )}
    </div>
  );
}
