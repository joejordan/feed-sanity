import { Listeners } from '../../core/listeners';
import { createLogger } from '../../core/log';
import { MARK } from '../../facebook/selectors';
import { FILTERED_FEED } from './engine';

const log = createLogger('filter-tabs');

/** The tab that holds every post, whatever the filters did with it. */
export const ALL_POSTS = 'All Posts';

/** ID of the style element that hides the posts outside the selected tab. Social Fixer's. */
const STYLE_ID = 'sfx_filter_tabselect';

/** One tab as the tab list shows it. */
export interface TabInfo {
  name: string;
  /** How many posts are in the tab. */
  total: number;
  /** How many of them a filter has hidden. */
  hidden: number;
  selected: boolean;
}

/**
 * Sorts posts into tabs and shows one tab at a time, as Social Fixer's
 * "move to tab" and "copy to tab" filter actions need.
 *
 * Each tab has a number, and a post in it carries the class
 * `sfx_filter_tab_<number>`. One style rule hides the sorted posts that lack
 * the selected tab's class. Posts in the comments popup are always shown, and
 * so is a post that has not been sorted yet.
 */
export class Tabs {
  /** Tab names by number. The two built-in tabs come first. */
  readonly #names: string[] = [ALL_POSTS, FILTERED_FEED];
  readonly #posts = new Map<HTMLElement, { tabs: Set<string>; hidden: boolean }>();
  readonly #listeners = new Listeners(log);
  #selected = FILTERED_FEED;
  #style: HTMLStyleElement | undefined;
  /** The rule now in `#style`. */
  #rule = '';
  #version = 0;

  /** Goes up whenever the tabs, their counts or the selection may have changed. */
  get version(): number {
    return this.#version;
  }

  /** Calls `listener` whenever `version` goes up. */
  onChange(listener: () => void): () => void {
    return this.#listeners.add(listener);
  }

  /** Creates the tab called `name`, if it does not exist yet. */
  add(name: string): void {
    if (!this.#names.includes(name)) {
      this.#names.push(name);
      this.#changed();
    }
  }

  /**
   * Puts a post in the tabs called `names` and takes it out of the others.
   * Every post is also in `ALL_POSTS`. `hidden` says whether a filter has
   * hidden the post, for the counts.
   */
  assign(post: HTMLElement, names: readonly string[], hidden: boolean): void {
    const tabs = new Set([ALL_POSTS, ...names]);
    const before = this.#posts.get(post);
    const sameTabs =
      before?.tabs.size === tabs.size && [...tabs].every((name) => before.tabs.has(name));
    // Posts are filtered again whenever Facebook adds to them, mostly with the same result.
    if (sameTabs && before?.hidden === hidden) {
      return;
    }
    if (!sameTabs) {
      for (const name of tabs) {
        if (!this.#names.includes(name)) {
          this.#names.push(name);
        }
      }
      this.#names.forEach((name, number) => {
        post.classList.toggle(`${MARK.tab}${number}`, tabs.has(name));
      });
    }
    this.#posts.set(post, { tabs, hidden });
    this.#showSelected(true);
    this.#changed();
  }

  /** Forgets a post that left the page. */
  remove(post: HTMLElement): void {
    if (this.#posts.delete(post)) {
      this.#changed();
    }
  }

  /** Forgets every post and every tab the filters made, as when Facebook moves to another page. */
  reset(): void {
    this.#posts.clear();
    this.#names.length = 2;
    this.#selected = FILTERED_FEED;
    this.#showSelected();
    this.#changed();
  }

  /** Stops sorting: every post is shown again and loses its tab classes. */
  clear(): void {
    for (const post of this.#posts.keys()) {
      for (const name of [...post.classList]) {
        if (name.startsWith(MARK.tab)) {
          post.classList.remove(name);
        }
      }
    }
    this.#style?.remove();
    this.#style = undefined;
    this.reset();
  }

  /** Shows the posts of the tab called `name`, and scrolls to the first of them. */
  select(name: string): void {
    if (!this.#names.includes(name) || name === this.#selected) {
      return;
    }
    this.#selected = name;
    this.#showSelected(true);
    this.#changed();
    for (const [post, { tabs }] of this.#posts) {
      if (tabs.has(name) && post.getBoundingClientRect().height > 0) {
        post.scrollIntoView({ block: 'center' });
        break;
      }
    }
  }

  /** True once a filter has made a tab of its own. */
  get hasCustomTabs(): boolean {
    return this.#names.length > 2;
  }

  /** The tabs in display order: all posts, the filtered feed, then the filters' tabs by name. */
  list(): TabInfo[] {
    const counts = new Map(this.#names.map((name) => [name, { total: 0, hidden: 0 }]));
    for (const { tabs, hidden } of this.#posts.values()) {
      for (const name of tabs) {
        const count = counts.get(name);
        if (count) {
          count.total++;
          count.hidden += hidden ? 1 : 0;
        }
      }
    }
    const custom = this.#names.slice(2).sort((a, b) => a.localeCompare(b));
    return [ALL_POSTS, FILTERED_FEED, ...custom].map((name) => ({
      name,
      total: counts.get(name)?.total ?? 0,
      hidden: counts.get(name)?.hidden ?? 0,
      selected: name === this.#selected,
    }));
  }

  #changed(): void {
    this.#version++;
    this.#listeners.emit();
  }

  /** Updates the rule that hides the other tabs' posts. It is only added to the page when `create` is set. */
  #showSelected(create = false): void {
    if (!this.#style?.isConnected) {
      if (!create) {
        return;
      }
      this.#style = document.createElement('style');
      this.#style.id = STYLE_ID;
      this.#rule = '';
      (document.head ?? document.documentElement).append(this.#style);
    }
    const number = this.#names.indexOf(this.#selected);
    // Only posts that carry the class of `ALL_POSTS` have been sorted.
    const rule = `.${MARK.tab}0:not(.${MARK.tab}${number}):not(.${MARK.popupPost}) { display: none; }`;
    if (this.#rule !== rule) {
      this.#rule = rule;
      this.#style.textContent = rule;
    }
  }
}
