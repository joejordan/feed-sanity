import type { OptionSpecs } from '../../core/options';
import type { Post } from '../../facebook/posts';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import { postCaptions, postText } from '../../facebook/post-text';
import { addHideStyles, hidePost, unhidePost } from './hide';
import { keywordMatcher } from './matcher';

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
} satisfies OptionSpecs;

/**
 * Hides posts that contain any of the user's keywords. Social Fixer's "Hide
 * Posts" section.
 */
export default defineFeature({
  id: 'hide_posts',
  options: OPTIONS,
  setup({ options, page, log }) {
    /**
     * The posts on the page, each with the kind of page it arrived on. The
     * address can change while a post stays, as when a photo is opened from
     * the feed, and the post is still judged by the page it belongs to.
     */
    const posts = new Map<Post, string>();
    /** Null while there is nothing to hide: no keywords, or filtering turned off. */
    let matcher: RegExp | null = null;
    let stopWatching: (() => void)[] = [];

    /** False for the kinds of page the user has not turned filtering on for. */
    const appliesOn = (pageType: string): boolean =>
      (pageType !== 'profile' || options.get('filters_enabled_pages')) &&
      (pageType !== 'groups' || options.get('filters_enabled_groups'));

    /** Hides or shows one post to fit the current settings. Safe to call again at any time. */
    const apply = (post: Post): void => {
      const { element } = post;
      if (!matcher || !appliesOn(posts.get(post) ?? pageContext().type)) {
        unhidePost(post);
        return;
      }
      const captions = options.get('hide_posts_caption') ? postCaptions(element) : [];
      const text = [postText(element), ...captions].join(' ');
      // Facebook has emptied the post and will fill it again. Until then
      // there is nothing to judge it by, so it stays as it is.
      if (!text.trim()) {
        return;
      }
      const match = matcher.exec(text)?.[1];
      if (match === undefined) {
        unhidePost(post);
        return;
      }
      const shown = options.get('hide_posts_show_match') ? `: ${match}` : '';
      const showNote = options.get('hide_posts_show_hidden_message');
      hidePost(post, `Post Hidden by keyword${shown}`, showNote);
    };

    // Watching posts starts Facebook-wide post detection, so it waits until
    // there is something to hide.
    const watchPosts = (): void => {
      addHideStyles().catch((error: unknown) => {
        log.error('could not add the style sheet', error);
      });
      stopWatching = [
        page.posts.onReset(() => posts.clear()),
        page.posts.onRemove((post) => posts.delete(post)),
        // Facebook refills posts it emptied while they were out of view, and
        // the note goes with the old content.
        page.posts.onUpdate(apply),
        // Also called at once with the posts already on the page.
        page.posts.onAdd((post) => {
          posts.set(post, pageContext().type);
          apply(post);
        }),
      ];
    };

    const refresh = (): void => {
      matcher = options.get('filters_enabled')
        ? keywordMatcher(options.get('hide_posts_text'), {
            partial: options.get('hide_posts_partial'),
            caseSensitive: options.get('hide_posts_case_sensitive'),
          })
        : null;
      if (matcher && stopWatching.length === 0) {
        // Subscribing applies the settings to every post on the page.
        watchPosts();
        return;
      }
      for (const post of posts.keys()) {
        apply(post);
      }
      if (!matcher) {
        for (const stop of stopWatching.splice(0)) {
          stop();
        }
        posts.clear();
      }
    };

    for (const key of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) {
      options.watch(key, refresh);
    }
  },
});
