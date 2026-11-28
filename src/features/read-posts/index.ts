import type { Locate } from '../../core/locator';
import type { OptionSpecs } from '../../core/options';
import type { Post } from '../../facebook/posts';
import type { ReadHistory } from '../../facebook/read-history';
import type { ReadBarController, ReadBarState } from './read-bar';
import { addStyle } from '../../core/dom';
import { callSafely, Listeners } from '../../core/listeners';
import { OWN_ATTR } from '../../core/surface';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import { readPostFields } from '../../facebook/post-fields';
import {
  isPostRead,
  isValidPostId,
  pruneReadHistory,
  savedReadHistory,
  setPostsRead,
} from '../../facebook/read-history';
import { isFilterHidden, isPagePost } from '../post-filters/markers';
import { BUTTON_CLASS, createCheckIcon, mountButton } from './header-button';
import buttonCss from './header-button.css?inline';
import { HIDE_READ_ATTR, READ_ATTR, READ_NOTE_CLASS } from './markers';
import { showReadBar } from './read-bar';
import css from './read-posts.css?inline';

const STYLE_ID = 'feed_sanity_read_posts';
const REVEAL_STYLE_ID = 'feed_sanity_read_posts_reveal';

const SECTION = 'Feed & Reading';
const GROUP = 'Mark Posts as Read';

const OPTIONS = {
  read_posts: {
    section: SECTION,
    group: GROUP,
    title: 'Mark posts as read',
    description:
      'Adds a check button to every post. Clicking it marks the post as read and hides it from your feed from then on.',
    keywords: ['read', 'seen', 'mark', 'hide', 'done', 'check'],
    default: true,
  },
  read_posts_note: {
    section: SECTION,
    group: GROUP,
    dependsOn: 'read_posts',
    title: 'Leave a note where a read post was',
    description:
      'Shows a thin bar in place of each hidden read post, so you can look at it again or mark it unread.',
    keywords: ['read', 'note', 'placeholder', 'bar'],
    default: true,
  },
  read_posts_mark_all: {
    section: SECTION,
    group: GROUP,
    dependsOn: 'read_posts',
    title: 'Show a "Mark all read" button',
    description:
      'Keeps the floating bar at the bottom of the page, with a button that marks every loaded post as read.',
    keywords: ['read', 'mark all', 'bulk', 'floating bar'],
    default: false,
  },
  read_posts_hide_in_groups: {
    section: SECTION,
    group: GROUP,
    advanced: true,
    dependsOn: 'read_posts',
    title: 'Hide read posts in groups',
    description: 'Also hides posts you marked as read when you browse a group.',
    keywords: ['read', 'groups'],
    default: true,
  },
  read_posts_hide_on_profiles: {
    section: SECTION,
    group: GROUP,
    advanced: true,
    dependsOn: 'read_posts',
    title: 'Hide read posts on profiles and pages',
    description: "Also hides posts you marked as read on a person's or a page's timeline.",
    keywords: ['read', 'profile', 'timeline', 'page'],
    default: true,
  },
  read_posts_keep_days: {
    section: SECTION,
    group: GROUP,
    advanced: true,
    dependsOn: 'read_posts',
    title: 'Remember read posts for (days)',
    description:
      'Read marks older than this are forgotten, and those posts show again. 0 remembers them forever.',
    keywords: ['read', 'history', 'forget', 'days', 'expire'],
    default: 28,
  },
  read_posts_reveal_css: {
    section: SECTION,
    group: GROUP,
    advanced: true,
    dependsOn: 'read_posts',
    title: 'Style of a revealed read post',
    description:
      'CSS declarations for a read post while you are looking at it again, such as an outline. Leave empty for none.',
    keywords: ['read', 'css', 'style', 'outline', 'reveal'],
    default: 'outline: 2px solid var(--accent, #0866ff); outline-offset: -2px;',
  },
} satisfies OptionSpecs;

/** What the feature knows about one post on the page. */
interface Entry {
  post: Post;
  /** The page type the post was first seen on. It keeps it when the address changes later. */
  readonly pageType: string;
  readonly button: HTMLButtonElement;
  note: Note | null;
  /** Marked read here while it has no ID, so only until the page reloads or the feed resets. */
  tempRead: boolean;
  /**
   * Shown or hidden by its own note; null to follow "Show read". A post the
   * page is about is shown unless its note hid it.
   */
  reveal: boolean | null;
  /** The post's author, or null when it has none; undefined until looked for. */
  author: string | null | undefined;
}

interface Note {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly toggle: HTMLButtonElement;
}

/** What the last mark action did, so "Undo" can take it back. */
interface UndoRecord {
  readonly ids: readonly string[];
  readonly temps: readonly Entry[];
}

type ReadState = 'hidden' | 'shown' | 'kept';

function ownElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.setAttribute(OWN_ATTR, '');
  return element;
}

function ownButton(className: string): HTMLButtonElement {
  const button = ownElement('button', className);
  button.type = 'button';
  return button;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

/** Sets or removes `name` on `element`, touching it only when the value changes. */
function setAttr(element: Element, name: string, value: string | null): void {
  if (value === null) {
    element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function paintButton(button: HTMLButtonElement, read: boolean, temporary: boolean): void {
  let label: string;
  let tooltip: string;
  if (read) {
    label = 'Mark as unread';
    tooltip = 'Mark as unread';
  } else if (temporary) {
    label = 'Hide until reload';
    tooltip = 'Hide until reload. This post has no ID, so the mark is not saved.';
  } else {
    label = 'Mark as read';
    tooltip = 'Mark as read. Shift+Click also marks every post above it.';
  }
  const readValue = String(read);
  const tempValue = String(!read && temporary);
  if (
    button.dataset.read === readValue &&
    button.dataset.temp === tempValue &&
    button.firstElementChild
  ) {
    return;
  }
  button.dataset.read = readValue;
  button.dataset.temp = tempValue;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', readValue);
  button.title = tooltip;
  button.replaceChildren(createCheckIcon(read, !read && temporary));
}

/** The author's name as the post's `author` part reads it, or null. */
function authorOf(post: Post, locate: Locate): string | null {
  const value = readPostFields(post.content, locate).get('author');
  const name = typeof value === 'string' ? value : value?.[0];
  return name || null;
}

const sameBarState = (a: ReadBarState, b: ReadBarState): boolean =>
  a.readCount === b.readCount &&
  a.unreadCount === b.unreadCount &&
  a.showingRead === b.showingRead &&
  a.showMarkAll === b.showMarkAll &&
  a.undoCount === b.undoCount;

/**
 * Mark posts as read: a check button on every post marks it read, and read
 * posts are hidden from then on, leaving a note. A floating bar counts them,
 * shows them again, and undoes the last mark.
 */
export default defineFeature({
  id: 'read_posts',
  options: OPTIONS,
  enabledBy: 'read_posts',
  setup: ({ options, page, scope, log, data }) => {
    const saved = savedReadHistory(data);
    let history: ReadHistory = saved.get();
    const entries = new Map<HTMLElement, Entry>();
    /** True while "Show read" is on. */
    let showAll = false;
    let undo: UndoRecord | null = null;
    const html = document.documentElement;

    const save = (ids: readonly string[], read: boolean): void => {
      setPostsRead(saved, ids, read).catch((error: unknown) => {
        log.error('could not save the read posts', error);
      });
    };

    const isRead = (entry: Entry): boolean => entry.tempRead || isPostRead(history, entry.post.id);

    /** True when read posts are hidden on pages of `type`. */
    const hidesOn = (type: string): boolean => {
      switch (type) {
        case 'groups':
          return options.get('read_posts_hide_in_groups');
        case 'profile':
          return options.get('read_posts_hide_on_profiles');
        default:
          return true;
      }
    };

    const readState = (entry: Entry): ReadState | null => {
      if (!isRead(entry)) {
        return null;
      }
      if (!hidesOn(entry.pageType)) {
        return 'kept';
      }
      return (entry.reveal ?? (showAll || isPagePost(entry.post))) ? 'shown' : 'hidden';
    };

    /** True for an unread post that "Mark all read" and Shift+Click may mark. */
    const markableInBulk = (entry: Entry): boolean =>
      entry.post.element.isConnected &&
      !isRead(entry) &&
      !isPagePost(entry.post) &&
      !isFilterHidden(entry.post.element);

    // The floating bar.

    let barState: ReadBarState = {
      readCount: 0,
      unreadCount: 0,
      showingRead: false,
      showMarkAll: false,
      undoCount: 0,
    };
    const barListeners = new Listeners(log);
    let stopBar: (() => void) | null = null;
    let publishQueued = false;

    const publish = (): void => {
      publishQueued = false;
      if (scope.disposed) {
        return;
      }
      let readCount = 0;
      let unreadCount = 0;
      for (const entry of entries.values()) {
        if (!entry.post.element.isConnected) {
          continue;
        }
        if (isRead(entry)) {
          readCount++;
        } else if (markableInBulk(entry)) {
          unreadCount++;
        }
      }
      const next: ReadBarState = {
        readCount,
        unreadCount,
        showingRead: showAll,
        showMarkAll: options.get('read_posts_mark_all'),
        undoCount: undo ? undo.ids.length + undo.temps.length : 0,
      };
      if (!sameBarState(next, barState)) {
        barState = next;
        barListeners.emit();
      }
      const wanted = next.readCount > 0 || next.undoCount > 0 || next.showMarkAll;
      if (wanted && !stopBar) {
        stopBar = showReadBar(controller);
      } else if (!wanted && stopBar) {
        stopBar();
        stopBar = null;
      }
    };

    /** Brings the bar up to date once the current batch of post changes is done. */
    const queuePublish = (): void => {
      if (!publishQueued) {
        publishQueued = true;
        queueMicrotask(publish);
      }
    };

    // Each post's button, note and mark.

    const removeNote = (entry: Entry): void => {
      entry.note?.root.remove();
    };

    const showNote = (entry: Entry, shown: boolean): void => {
      let { note } = entry;
      if (!note) {
        const root = ownElement('div', READ_NOTE_CLASS);
        const label = ownElement('span', `${READ_NOTE_CLASS}-label`);
        const toggle = ownButton(`${READ_NOTE_CLASS}-button`);
        const unread = ownButton(`${READ_NOTE_CLASS}-button`);
        unread.textContent = 'Mark unread';
        onClick(toggle, () => {
          entry.reveal = readState(entry) !== 'shown';
          render(entry);
        });
        onClick(unread, () => markUnread(entry));
        root.append(label, toggle, unread);
        note = { root, label, toggle };
        entry.note = note;
      }
      if (entry.author === undefined) {
        entry.author = authorOf(entry.post, page.locate);
      }
      setText(note.label, entry.author ? `Read post by ${entry.author}` : 'Read post');
      setText(note.toggle, shown ? 'Hide' : 'Show');
      note.toggle.setAttribute('aria-expanded', String(shown));
      const { element } = entry.post;
      if (note.root.parentElement !== element) {
        element.prepend(note.root);
      }
    };

    /** Brings the post's button, mark and note up to date. */
    const render = (entry: Entry): void => {
      const { post, button } = entry;
      paintButton(button, isRead(entry), !isValidPostId(post.id));
      const state = readState(entry);
      setAttr(post.element, READ_ATTR, state);
      if (
        (state === 'hidden' || state === 'shown') &&
        (options.get('read_posts_note') || isPagePost(post))
      ) {
        showNote(entry, state === 'shown');
      } else {
        removeNote(entry);
      }
      queuePublish();
    };

    const renderAll = (): void => {
      for (const entry of entries.values()) {
        render(entry);
      }
      queuePublish();
    };

    const forget = (entry: Entry): void => {
      entry.button.remove();
      removeNote(entry);
      entry.post.element.removeAttribute(READ_ATTR);
      entries.delete(entry.post.element);
    };

    const forgetAll = (): void => {
      for (const entry of [...entries.values()]) {
        forget(entry);
      }
    };

    // What the user does.

    /** Runs a user action, unless the feature has stopped, and logs what it throws. */
    const act = (action: () => void): void => {
      if (!scope.disposed) {
        callSafely(log, action);
      }
    };

    /** Runs `action` on a click of one of this feature's buttons, keeping the click from Facebook. */
    const onClick = (button: HTMLButtonElement, action: (event: MouseEvent) => void): void => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        act(() => action(event));
      });
    };

    /**
     * Saves the change to `ids`, which renders every post again once the
     * history changes, and renders `temps`, posts with no ID that only this
     * tab knows about.
     */
    const apply = (ids: readonly string[], read: boolean, temps: readonly Entry[]): void => {
      if (ids.length > 0) {
        save(ids, read);
      }
      for (const entry of temps) {
        // A post Facebook removed since is forgotten, and its element may hold a new entry.
        if (entries.get(entry.post.element) === entry) {
          render(entry);
        }
      }
      queuePublish();
    };

    /** Marks each unread post of `targets` as read, as one action "Undo" can take back. */
    const markRead = (targets: readonly Entry[]): void => {
      const ids = new Set<string>();
      const temps: Entry[] = [];
      for (const entry of targets) {
        if (isRead(entry)) {
          continue;
        }
        entry.reveal = null;
        const { id } = entry.post;
        if (isValidPostId(id)) {
          ids.add(id);
        } else {
          entry.tempRead = true;
          temps.push(entry);
        }
      }
      if (ids.size + temps.length > 0) {
        undo = { ids: [...ids], temps };
        apply(undo.ids, true, temps);
      }
    };

    const markUnread = (entry: Entry): void => {
      undo = null;
      entry.tempRead = false;
      entry.reveal = null;
      const { id } = entry.post;
      apply(isValidPostId(id) && isPostRead(history, id) ? [id] : [], false, [entry]);
    };

    /** Marks `entry` and every unread post above it. */
    const markWithAbove = (entry: Entry): void => {
      const { element } = entry.post;
      const above = [...entries.values()].filter(
        (other) =>
          other !== entry &&
          markableInBulk(other) &&
          (element.compareDocumentPosition(other.post.element) &
            Node.DOCUMENT_POSITION_PRECEDING) !==
            0,
      );
      markRead([entry, ...above]);
    };

    const controller: ReadBarController = {
      subscribe: (listener) => barListeners.add(listener),
      getState: () => barState,
      toggleShowRead: () =>
        act(() => {
          showAll = !showAll;
          for (const entry of entries.values()) {
            entry.reveal = null;
          }
          html.toggleAttribute(HIDE_READ_ATTR, !showAll);
          renderAll();
        }),
      markAllRead: () => act(() => markRead([...entries.values()].filter(markableInBulk))),
      undo: () =>
        act(() => {
          const last = undo;
          if (!last) {
            return;
          }
          undo = null;
          for (const entry of last.temps) {
            entry.tempRead = false;
          }
          apply(last.ids, false, last.temps);
        }),
    };

    /**
     * Renders a known post again after Facebook redrew it: puts the button
     * back in place and reads the author again. False for a post not known.
     */
    const refresh = (post: Post): boolean => {
      const entry = entries.get(post.element);
      if (!entry) {
        return false;
      }
      entry.post = post;
      entry.author = undefined;
      mountButton(post, entry.button, page.locate);
      render(entry);
      return true;
    };

    const track = (post: Post): void => {
      if (refresh(post)) {
        return;
      }
      const button = ownButton(BUTTON_CLASS);
      const entry: Entry = {
        post,
        pageType: pageContext().type,
        button,
        note: null,
        tempRead: false,
        reveal: null,
        author: undefined,
      };
      onClick(button, (event) => {
        if (isRead(entry)) {
          markUnread(entry);
        } else if (event.shiftKey) {
          // Shift+Click also selects the text between the last click and this one.
          getSelection()?.removeAllRanges();
          markWithAbove(entry);
        } else {
          markRead([entry]);
        }
      });
      entries.set(post.element, entry);
      mountButton(post, button, page.locate);
      render(entry);
    };

    // Wiring.

    scope.add(addStyle(STYLE_ID, `${buttonCss}\n${css}`));
    let stopReveal: (() => void) | null = null;
    scope.add(() => stopReveal?.());
    options.watch('read_posts_reveal_css', (declarations) => {
      stopReveal?.();
      stopReveal = declarations.trim()
        ? addStyle(REVEAL_STYLE_ID, `[${READ_ATTR}="shown"] { ${declarations} }`)
        : null;
    });

    html.toggleAttribute(HIDE_READ_ATTR, true);
    scope.add(() => {
      forgetAll();
      html.removeAttribute(HIDE_READ_ATTR);
      stopBar?.();
      stopBar = null;
      barListeners.clear();
    });

    saved.onChange((value) => {
      history = value;
      renderAll();
    });
    options.watch('read_posts_note', renderAll);
    options.watch('read_posts_hide_in_groups', renderAll);
    options.watch('read_posts_hide_on_profiles', renderAll);
    options.watch('read_posts_mark_all', queuePublish);

    // Subscribed first: a reset that happened already is reported at once.
    page.posts.onReset(() => {
      forgetAll();
      showAll = false;
      undo = null;
      html.toggleAttribute(HIDE_READ_ATTR, true);
      queuePublish();
    });
    page.posts.onAdd(track);
    page.posts.onUpdate(refresh);
    page.posts.onRemove((post) => {
      const entry = entries.get(post.element);
      if (entry) {
        forget(entry);
        queuePublish();
      }
    });

    // `ready` never rejects: a failed read is logged by `Saved`, and its `set` then throws.
    void saved.ready.then(() => {
      if (scope.disposed) {
        return;
      }
      options.watch('read_posts_keep_days', (days) => {
        const pruned = pruneReadHistory(saved.get(), days, Date.now());
        if (pruned) {
          saved.set(pruned).catch((error: unknown) => {
            log.error('could not forget old read posts', error);
          });
        }
      });
    });
  },
});
