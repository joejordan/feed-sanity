import type { BridgeFailure } from '../../core/bridge';
import type { OptionSpecs } from '../../core/options';
import type { Post } from '../../facebook/posts';
import type { Applied } from './effects';
import type { Filter } from './types';
import { BridgeError } from '../../core/bridge';
import { addStyle } from '../../core/dom';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import { readPostFields, SPONSORED } from '../../facebook/post-fields';
import { sponsoredFilter, suggestedFilter, testsSponsored } from './built-in-filters';
import { applyOutcome, undo } from './effects';
import { isFixedTabName, runFilters, untouched } from './engine';
import { isPagePost, unhidePost } from './hide';
import { keywordFilter } from './keyword-filter';
import css from './post-filters.css?inline';
import { showTabPanel } from './tab-panel';
import { Tabs } from './tabs';
import { isRunnable, isTabAction, savedFilters } from './types';

const STYLE_ID = 'feed_sanity_post_filters';

const OPTIONS = {
  hide_posts_suggested: {
    section: 'Hide Posts',
    title: 'Hide suggested posts',
    description:
      'Hide the posts Facebook suggests from pages, people and groups you do not follow, the ones with a Follow or Join button by the name.',
    default: true,
  },
  hide_posts_sponsored: {
    section: 'Hide Posts',
    title: 'Hide ads',
    description:
      "Hide sponsored posts. Feed Sanity tells them apart by Facebook's own data on the page, and does nothing where it cannot read it.",
    default: false,
  },
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
  /** True while a filter hides the post. */
  hidden?: boolean;
  /**
   * Whether the post is an ad, as the page-world bridge said. Undefined
   * until it is asked, and `asking` while the question is open.
   */
  sponsored?: boolean | 'asking' | undefined;
}

/** Failures after which the question about an ad is asked again when the post next changes. */
const ASK_AGAIN: readonly BridgeFailure[] = ['timeout', 'detached'];

/**
 * Runs the user's filters on every post: Social Fixer's post filters. The
 * Hide Posts keywords are the first filter, followed by the filters for
 * suggested posts and ads. Filters can hide a post, restyle it, rewrite its
 * text and sort it into tabs.
 *
 * A post is filtered when it arrives and again whenever Facebook adds
 * content to it, and every post is filtered again when the filters or their
 * settings change, so nothing needs a page reload.
 *
 * Whether a post is an ad is asked of the page-world bridge, only while a
 * filter tests it, and once per post. The post is filtered at once without
 * the answer, and again when a yes comes back. A post the page is about
 * counts as neither suggested nor an ad.
 */
export default defineFeature({
  id: 'post_filters',
  options: OPTIONS,
  async setup({ options, data, page, log, scope, child }) {
    const saved = savedFilters(data);
    await saved.ready;

    const tabs = new Tabs();
    const posts = new Map<Post, Tracked>();
    /** The filters in use. Empty while there is nothing to do: filtering is off, or no filter is set up. */
    let filters: Filter[] = [];
    /** True while a filter tests whether posts are ads. */
    let testsAds = false;
    /**
     * The context `start` set up, whose scope ends it. Only there while posts
     * are being watched. Its number on the badge goes with it.
     */
    let watching: ReturnType<typeof child> | undefined;

    /** How many of `posts` a filter hides, shown on the toolbar button's badge. */
    let hiddenCount = 0;
    const showHidden = (): void => watching?.badge(hiddenCount);

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

    /**
     * Asks the page-world bridge whether `post` is an ad, unless it has
     * been asked. Filters the post again when the answer is yes. The other
     * filters do not wait for it.
     */
    const askIfAd = (post: Post, tracked: Tracked): void => {
      if (tracked.sponsored !== undefined || !watching) {
        return;
      }
      tracked.sponsored = 'asking';
      const settle = (sponsored: boolean | undefined): void => {
        // The post may have left, or the page changed, while it was asked about.
        if (posts.get(post) !== tracked) {
          return;
        }
        tracked.sponsored = sponsored;
        if (sponsored) {
          apply(post);
        }
      };
      // Withdrawn when watching stops.
      watching.page.bridge
        .postSponsored(post.element)
        .then(
          (sponsored) => settle(sponsored === true),
          (error: unknown) => {
            const failure = error instanceof BridgeError ? error.failure : undefined;
            // An unavailable bridge stays so for the page load, and Diagnostics says so.
            settle(failure && ASK_AGAIN.includes(failure) ? undefined : false);
          },
        )
        .catch((error: unknown) => log.error('could not filter a post found to be an ad', error));
    };

    /** Filters one post to fit the current settings. Safe to call again at any time. */
    const apply = (post: Post): void => {
      const tracked = posts.get(post);
      if (!tracked) {
        return;
      }
      const fields = readPostFields(post.content, page.locate);
      let outcome = untouched();
      if (appliesOn(tracked.pageType)) {
        // Facebook has emptied the post and will fill it again. Until then
        // there is nothing to judge it by, so it stays as it is.
        if (!fields.get('all_content') && !fields.get('image')) {
          return;
        }
        if (isPagePost(post)) {
          // The person came to see this post.
          fields.set('suggested', null);
        } else if (testsAds) {
          askIfAd(post, tracked);
          fields.set('sponsored', tracked.sponsored === true ? SPONSORED : null);
        }
        outcome = runFilters(filters, {
          post: post.content,
          fields,
          atoms: page.atoms,
          locate: page.locate,
          now: () => new Date(),
          report: (message, error) => log.debug(message, error ?? ''),
        });
      }
      tracked.applied = applyOutcome(post, outcome, fields, page.atoms, tracked.applied);
      const hidden = outcome.hiding !== null;
      if (hidden !== !!tracked.hidden) {
        tracked.hidden = hidden;
        hiddenCount += hidden ? 1 : -1;
        showHidden();
      }
      // A post the page is about is left out of the tabs, so that a filter
      // cannot sort it out of view.
      if (!post.permalink) {
        tabs.assign(post.element, outcome.tabs, outcome.hiding !== null);
      }
    };

    // Watching posts starts Facebook-wide post detection, so it waits until
    // there is a filter to run.
    const start = (): void => {
      const running = child();
      watching = running;
      const watched = running.page;
      running.scope.add(addStyle(STYLE_ID, css));
      addFixedTabs();
      // Suggested posts are hidden by default, so this runs on most pages.
      // The tab list goes in the page only once it has something to list.
      let panelShown = false;
      const showPanel = (): void => {
        if (panelShown || !(tabs.hasCustomTabs || running.options.get('always_show_tabs'))) {
          return;
        }
        panelShown = true;
        running.scope.add(
          showTabPanel({
            tabs,
            watchAlwaysShow: (listener) => running.options.watch('always_show_tabs', listener),
          }),
        );
      };
      running.scope.add(tabs.onChange(showPanel));
      running.options.watch('always_show_tabs', showPanel);
      watched.posts.onReset(() => {
        posts.clear();
        hiddenCount = 0;
        showHidden();
        tabs.reset();
        addFixedTabs();
      });
      watched.posts.onRemove((post) => {
        if (posts.get(post)?.hidden) {
          hiddenCount--;
          showHidden();
        }
        posts.delete(post);
        tabs.remove(post.element);
      });
      // Facebook refills posts it emptied while they were out of view, and
      // what the filters did to the old content goes with it.
      watched.posts.onUpdate(apply);
      // Also called at once with the posts already on the page.
      watched.posts.onAdd((post) => {
        posts.set(post, { pageType: pageContext().type });
        apply(post);
      });
    };

    const stop = (): void => {
      watching?.scope.dispose();
      watching = undefined;
      for (const [post, { applied }] of posts) {
        undo(applied);
        unhidePost(post);
      }
      posts.clear();
      hiddenCount = 0;
      tabs.clear();
    };

    const refresh = (): void => {
      const showNote = options.get('hide_posts_show_hidden_message');
      const keywords = keywordFilter({
        keywords: options.get('hide_posts_text'),
        partial: options.get('hide_posts_partial'),
        caseSensitive: options.get('hide_posts_case_sensitive'),
        captions: options.get('hide_posts_caption'),
        showNote,
        showMatch: options.get('hide_posts_show_match'),
      });
      const builtIn = [
        keywords,
        options.get('hide_posts_suggested') ? suggestedFilter(showNote) : null,
        options.get('hide_posts_sponsored') ? sponsoredFilter(showNote) : null,
      ].filter((filter) => filter !== null);
      filters = options.get('filters_enabled')
        ? [...builtIn, ...saved.get()].filter(isRunnable)
        : [];
      testsAds = filters.some(testsSponsored);
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
    // Undoes what the filters did if the feature is stopped.
    scope.add(stop);
    refresh();
  },
});
