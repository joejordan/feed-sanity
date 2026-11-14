import type { OptionSpecs } from '../../core/options';
import type { Post } from '../../facebook/posts';
import type { Applied } from './effects';
import type { Filter } from './types';
import { addStyle } from '../../core/dom';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import { readPostFields } from '../../facebook/post-fields';
import { applyOutcome, undo } from './effects';
import { isFixedTabName, runFilters, untouched } from './engine';
import { unhidePost } from './hide';
import { keywordFilter } from './keyword-filter';
import css from './post-filters.css?inline';
import { showTabPanel } from './tab-panel';
import { Tabs } from './tabs';
import { isRunnable, isTabAction, savedFilters } from './types';

const STYLE_ID = 'feed_sanity_post_filters';

const OPTIONS = {
  hide_posts_text: {
    section: 'Hide Posts',
    title: 'Keywords',
    description:
      'Hide posts that contain any of these words or phrases. Put each one on its own line.',
    default: '',
    multiline: true,
  },
  hide_posts_show_hidden_message: {
    section: 'Hide Posts',
    title: 'Show a note',
    description: 'Leave a note in place of each hidden post. Click the note to see the post.',
    default: true,
  },
  hide_posts_show_match: {
    section: 'Hide Posts',
    title: 'Show the match',
    description: 'Say in the note which word or phrase matched.',
    default: true,
  },
  hide_posts_partial: {
    section: 'Hide Posts',
    title: 'Match partial words',
    description: 'For example, "the" also matches "them".',
    default: true,
  },
  hide_posts_case_sensitive: {
    section: 'Hide Posts',
    title: 'Match case',
    description: 'Treat capital and small letters as different.',
    default: false,
  },
  hide_posts_caption: {
    section: 'Hide Posts',
    title: 'Match photo descriptions',
    description: "Also look in the descriptions of a post's photos.",
    default: true,
  },
  filters_enabled: {
    section: 'Filters',
    title: 'Post filtering',
    description: 'Turn this off to stop all hiding and filtering of posts.',
    default: true,
  },
  filters_enabled_pages: {
    section: 'Filters',
    title: 'Filter on pages and profiles',
    description: 'Also hide and filter posts on the timelines of pages and people.',
    default: false,
  },
  filters_enabled_groups: {
    section: 'Filters',
    title: 'Filter in groups',
    description: 'Also hide and filter posts inside groups.',
    default: false,
  },
  always_show_tabs: {
    section: 'Filters',
    title: 'Always show the tab list',
    description: 'Show the list of filter tabs before any post has been moved to one.',
    default: false,
  },
} satisfies OptionSpecs;

/** What is remembered about each post on the page. */
interface Tracked {
  /**
   * The kind of page the post arrived on. The address can change while a
   * post stays, as when a photo is opened from the feed, and the post is
   * still judged by the page it belongs to.
   */
  pageType: string;
  applied?: Applied;
}

/**
 * Runs the user's filters on every post: Social Fixer's post filters. The
 * Hide Posts keywords are the first filter. Filters can hide a post, restyle
 * it, rewrite its text and sort it into tabs.
 *
 * A post is filtered when it arrives and again whenever Facebook adds
 * content to it, and every post is filtered again when the filters or their
 * settings change, so nothing needs a page reload.
 */
export default defineFeature({
  id: 'post_filters',
  options: OPTIONS,
  async setup({ options, data, page, log }) {
    const saved = savedFilters(data);
    await saved.ready;

    const tabs = new Tabs();
    const posts = new Map<Post, Tracked>();
    /** The filters in use. Empty while there is nothing to do: filtering is off, or no filter is set up. */
    let filters: Filter[] = [];
    let stopWatching: (() => void)[] = [];

    /** False for the kinds of page the user has not turned filtering on for. */
    const appliesOn = (pageType: string): boolean =>
      (pageType !== 'profile' || options.get('filters_enabled_pages')) &&
      (pageType !== 'groups' || options.get('filters_enabled_groups'));

    /** Creates the tabs whose names are known before any post arrives. */
    const addFixedTabs = (): void => {
      if (!options.get('always_show_tabs')) {
        return;
      }
      for (const action of filters.flatMap((filter) => filter.actions ?? [])) {
        if (isTabAction(action) && isFixedTabName(action.tab)) {
          tabs.add(action.tab);
        }
      }
    };

    /** Filters one post to fit the current settings. Safe to call again at any time. */
    const apply = (post: Post): void => {
      const tracked = posts.get(post);
      if (!tracked) {
        return;
      }
      const fields = readPostFields(post.content, page.atoms);
      let outcome = untouched();
      if (appliesOn(tracked.pageType)) {
        // Facebook has emptied the post and will fill it again. Until then
        // there is nothing to judge it by, so it stays as it is.
        if (!fields.get('all_content') && !fields.get('image')) {
          return;
        }
        outcome = runFilters(filters, {
          post: post.content,
          fields,
          atoms: page.atoms,
          now: () => new Date(),
          report: (message, error) => log.debug(message, error ?? ''),
        });
      }
      tracked.applied = applyOutcome(post, outcome, fields, page.atoms, tracked.applied);
      // A post the page is about is left out of the tabs, so that a filter
      // cannot sort it out of view.
      if (!post.permalink) {
        tabs.assign(post.element, outcome.tabs, outcome.hiding !== null);
      }
    };

    // Watching posts starts Facebook-wide post detection, so it waits until
    // there is a filter to run.
    const start = (): void => {
      addStyle(STYLE_ID, css).catch((error: unknown) => {
        log.error('could not add the style sheet', error);
      });
      addFixedTabs();
      stopWatching = [
        showTabPanel({
          tabs,
          watchAlwaysShow: (listener) => options.watch('always_show_tabs', listener),
        }),
        page.posts.onReset(() => {
          posts.clear();
          tabs.reset();
          addFixedTabs();
        }),
        page.posts.onRemove((post) => {
          posts.delete(post);
          tabs.remove(post.element);
        }),
        // Facebook refills posts it emptied while they were out of view, and
        // what the filters did to the old content goes with it.
        page.posts.onUpdate(apply),
        // Also called at once with the posts already on the page.
        page.posts.onAdd((post) => {
          posts.set(post, { pageType: pageContext().type });
          apply(post);
        }),
      ];
    };

    const stop = (): void => {
      for (const end of stopWatching.splice(0)) {
        end();
      }
      for (const [post, { applied }] of posts) {
        undo(applied);
        unhidePost(post);
      }
      posts.clear();
      tabs.clear();
    };

    const refresh = (): void => {
      const keywords = keywordFilter({
        keywords: options.get('hide_posts_text'),
        partial: options.get('hide_posts_partial'),
        caseSensitive: options.get('hide_posts_case_sensitive'),
        captions: options.get('hide_posts_caption'),
        showNote: options.get('hide_posts_show_hidden_message'),
        showMatch: options.get('hide_posts_show_match'),
      });
      filters = options.get('filters_enabled')
        ? [...(keywords ? [keywords] : []), ...saved.get()].filter(isRunnable)
        : [];
      const watching = stopWatching.length > 0;
      if (filters.length === 0) {
        // Does nothing when nothing is watched.
        stop();
      } else if (watching) {
        addFixedTabs();
        for (const post of posts.keys()) {
          apply(post);
        }
      } else {
        // Subscribing filters every post on the page.
        start();
      }
    };

    // `watch` calls back at once for every option. One refresh covers them all.
    let settingUp = true;
    for (const key of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) {
      options.watch(key, () => {
        if (!settingUp) {
          refresh();
        }
      });
    }
    saved.onChange(refresh);
    settingUp = false;
    refresh();
  },
});
