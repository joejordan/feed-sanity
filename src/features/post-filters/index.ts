// Post filters on Facebook: the built-in switches (keywords, suggested posts,
// ads) and the user's saved filters, run on every post as it is found, as
// Facebook refills it, and again whenever an option or a filter changes.

import type { FeatureContext } from '../../core/feature';
import type { FilterOutcome } from '../../core/filter-engine';
import type { FilterHitTracker } from '../../core/filter-hits';
import type { Filter } from '../../core/filter-types';
import type { Scope } from '../../core/scope';
import type { FacebookPage } from '../../facebook/feature';
import type { PostFields } from '../../facebook/post-fields';
import type { Post } from '../../facebook/posts';
import type { FilterSettings, PostFilterOptions } from './settings';
import { BridgeError } from '../../core/bridge';
import { addStyle } from '../../core/dom';
import { runFilters } from '../../core/filter-engine';
import { getFilterHitTracker } from '../../core/filter-hits';
import { isRunnable, savedFilters } from '../../core/filter-types';
import { onUrlChange } from '../../core/navigation';
import { hideElement } from '../../core/surface';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import { readPostFields, SPONSORED } from '../../facebook/post-fields';
import { hasPostText } from '../../facebook/post-text';
import { isValidPostId, savedReadHistory, setPostsRead } from '../../facebook/read-history';
import { FEED_FILTERING, POST_CHECKED } from '../../facebook/selectors';
import { applyStyling, replaceText } from './apply';
import { builtInFilters, testsPart } from './built-ins';
import { postConditions } from './conditions';
import { FILTERED_ATTR, FILTERED_HIDDEN, FILTERED_SHOWN, isPagePost } from './markers';
import { FilterNote } from './notes';
import { watchRightRailAds } from './right-rail-ads';
import { filtersPageType, POST_FILTER_OPTIONS, readSettings } from './settings';
import { POST_FILTERS_CSS, STYLE_ID } from './styles';

type Context = FeatureContext<PostFilterOptions, FacebookPage>;

/** Where the page-world answer about a post being an ad stands. */
type AdAnswer = 'unknown' | 'asking' | 'yes' | 'no';

interface PostState {
  /** The post as last reported, with its ID once known. */
  post: Post;
  /** The page type the post was first seen on. It keeps it when the address changes. */
  readonly pageType: string;
  /** Undoes what the last run did to the post, except the note and replaced text. */
  effects: Scope | null;
  /** The note while the post is hidden with one. */
  note: FilterNote | null;
  /** The note's label. */
  label: string;
  /** True or false once the user has clicked the note. Until then the page post starts revealed. */
  revealed: boolean | null;
  hidden: boolean;
  ad: AdAnswer;
  /** The read state last recorded for the post's ID, so the same write is not repeated. */
  read: 'read' | 'unread' | undefined;
}

/** True when asking about `error` again later may get an answer. */
const isTransient = (error: unknown): boolean =>
  error instanceof BridgeError &&
  (error.failure === 'timeout' || error.failure === 'detached' || error.failure === 'cancelled');

/** Filtering while it has something to do. Disposing its context's scope undoes all of it. */
class Filtering {
  readonly #ctx: Context;
  readonly #tracker: FilterHitTracker;
  readonly #states = new Map<HTMLElement, PostState>();
  #settings: FilterSettings;
  #filters: readonly Filter[];
  #askAds: boolean;
  #hiddenCount = 0;
  #rail: Scope | undefined;

  constructor(ctx: Context, settings: FilterSettings, filters: readonly Filter[]) {
    this.#ctx = ctx;
    this.#tracker = getFilterHitTracker(ctx.data);
    this.#settings = settings;
    this.#filters = filters;
    this.#askAds = testsPart(filters, 'sponsored');
  }

  start(): void {
    const { scope, page } = this.#ctx;
    scope.add(addStyle(STYLE_ID, POST_FILTERS_CSS));
    scope.add(() => this.#undoAll());
    // Before the posts, so that the bridge is on its way when the first ads are asked about.
    this.#syncRail();
    this.#syncFlash();
    scope.add(onUrlChange(() => this.#syncFlash()));
    page.posts.onReset(() => this.#reset());
    page.posts.onTrack((post) => this.#see(post));
    page.posts.onAdd((post) => this.#see(post));
    page.posts.onUpdate((post) => this.#see(post));
    page.posts.onUntrack((post) => this.#forget(post));
  }

  /** Takes new options or filters, and filters every post again. */
  update(settings: FilterSettings, filters: readonly Filter[]): void {
    this.#settings = settings;
    this.#filters = filters;
    this.#askAds = testsPart(filters, 'sponsored');
    this.#syncRail();
    this.#syncFlash();
    for (const state of this.#states.values()) {
      this.#filter(state);
    }
  }

  #see(post: Post): void {
    let state = this.#states.get(post.element);
    if (state) {
      state.post = post;
    } else {
      state = {
        post,
        pageType: pageContext().type,
        effects: null,
        note: null,
        label: '',
        revealed: null,
        hidden: false,
        ad: 'unknown',
        read: undefined,
      };
      this.#states.set(post.element, state);
    }
    this.#filter(state);
  }

  #filter(state: PostState): void {
    const { post } = state;
    const { locate } = this.#ctx.page;
    if (!filtersPageType(this.#settings, state.pageType)) {
      this.#undo(state);
      this.#tracker.forgetItem(post.element);
      this.#setHidden(state, false);
      this.#markChecked(state);
      return;
    }
    // An empty post is left as it is until Facebook fills it again.
    if (!hasPostText(post.content, locate)) {
      return;
    }
    const pagePost = isPagePost(post);
    if (this.#askAds && !pagePost && state.ad === 'unknown') {
      this.#askAd(state);
    }
    const fields = readPostFields(post.content, locate);
    if (pagePost) {
      // The post the page is about is never taken for a suggestion or an ad.
      fields.set('suggested', null);
      fields.set('sponsored', null);
    } else if (state.ad === 'yes') {
      fields.set('sponsored', SPONSORED);
    }
    const matched: Filter[] = [];
    const outcome = runFilters(this.#filters, {
      fields,
      element: post.content,
      itemNoun: 'post',
      testCondition: postConditions(post.content, locate),
      onFilterMatch: (filter) => matched.push(filter),
      report: (message, error) => this.#ctx.log.debug(message, error),
    });
    this.#tracker.setItemMatches(post.element, matched);
    this.#apply(state, outcome, fields, pagePost);
    if (state.ad !== 'asking') {
      this.#markChecked(state);
    }
  }

  #apply(state: PostState, outcome: FilterOutcome, fields: PostFields, pagePost: boolean): void {
    const { element } = state.post;
    const { locate } = this.#ctx.page;
    state.effects?.dispose();
    const effects = this.#ctx.scope.child();
    state.effects = effects;
    const { hiding } = outcome;
    if (hiding) {
      element.setAttribute(FILTERED_ATTR, FILTERED_HIDDEN);
      effects.add(() => element.removeAttribute(FILTERED_ATTR));
      const notes = this.#settings.notes || hiding.forceNote;
      if (pagePost || (hiding.showNote && notes)) {
        state.label = hiding.label;
        state.note ??= new FilterNote(element.ownerDocument, () => this.#toggle(state));
        state.note.place(element);
        this.#showNote(state);
      } else {
        this.#dropNote(state);
        hideElement(effects, element);
      }
    } else {
      this.#dropNote(state);
    }
    applyStyling(effects, state.post, outcome, locate);
    replaceText(fields, outcome.replacements, locate);
    this.#setHidden(state, hiding !== null);
    this.#record(state, outcome.read);
  }

  #showNote(state: PostState): void {
    const revealed = state.revealed ?? isPagePost(state.post);
    state.note?.show(state.label, revealed);
    state.post.element.setAttribute(FILTERED_ATTR, revealed ? FILTERED_SHOWN : FILTERED_HIDDEN);
  }

  #toggle(state: PostState): void {
    if (this.#states.get(state.post.element) !== state || !state.note) {
      return;
    }
    state.revealed = !(state.revealed ?? isPagePost(state.post));
    this.#showNote(state);
  }

  #dropNote(state: PostState): void {
    state.note?.remove();
    state.note = null;
    state.revealed = null;
  }

  /** Records the read state a filter asked for, for a post with an ID. */
  #record(state: PostState, read: FilterOutcome['read']): void {
    if (read === undefined) {
      state.read = undefined;
      return;
    }
    const { id } = state.post;
    if (!isValidPostId(id) || state.read === read) {
      return;
    }
    state.read = read;
    setPostsRead(savedReadHistory(this.#ctx.data), [id], read === 'read').catch((error: unknown) =>
      this.#ctx.log.error('could not record a post as read', error),
    );
  }

  /** Asks the page-world side once whether the post is an ad, and filters it again on a yes. */
  #askAd(state: PostState): void {
    state.ad = 'asking';
    const { element } = state.post;
    const current = (): boolean => this.#states.get(element) === state;
    this.#ctx.page.bridge
      .postSponsored(element)
      .then(
        (sponsored) => {
          if (!current()) {
            return;
          }
          if (sponsored === true) {
            state.ad = 'yes';
            this.#filter(state);
          } else {
            state.ad = 'no';
            this.#markChecked(state);
          }
        },
        (error: unknown) => {
          if (!current()) {
            return;
          }
          // A timeout or a detached post is asked about again on its next update.
          // Any other failure, such as an unavailable bridge, means it is not an ad.
          state.ad = isTransient(error) ? 'unknown' : 'no';
          this.#markChecked(state);
        },
      )
      .catch((error: unknown) => this.#ctx.log.error('could not filter an ad', error));
  }

  #markChecked(state: PostState): void {
    state.post.element.setAttribute(POST_CHECKED, '');
  }

  #setHidden(state: PostState, hidden: boolean): void {
    if (state.hidden === hidden) {
      return;
    }
    state.hidden = hidden;
    this.#hiddenCount += hidden ? 1 : -1;
    this.#ctx.badge(this.#hiddenCount);
  }

  /** Undoes everything filtering did to the post, except replaced text. */
  #undo(state: PostState): void {
    state.effects?.dispose();
    state.effects = null;
    this.#dropNote(state);
  }

  #forget(post: Post): void {
    const state = this.#states.get(post.element);
    if (!state) {
      return;
    }
    this.#undo(state);
    this.#setHidden(state, false);
    state.post.element.removeAttribute(POST_CHECKED);
    this.#states.delete(post.element);
    this.#tracker.forgetItem(post.element);
  }

  /** Numbering started again after an in-page move: every post from before has gone. */
  #reset(): void {
    if (this.#states.size === 0) {
      this.#tracker.clear();
    }
    let hidden = 0;
    for (const state of this.#states.values()) {
      hidden += state.hidden ? 1 : 0;
    }
    this.#hiddenCount = hidden;
    this.#ctx.badge(hidden);
  }

  #undoAll(): void {
    for (const state of this.#states.values()) {
      this.#undo(state);
      state.post.element.removeAttribute(POST_CHECKED);
    }
    this.#states.clear();
    this.#tracker.clear();
    document.documentElement.removeAttribute(FEED_FILTERING);
  }

  /** Hides the right rail's ads while ad hiding is on. */
  #syncRail(): void {
    const { scope, page } = this.#ctx;
    if (this.#settings.sponsored && !this.#rail) {
      const rail = scope.child();
      this.#rail = rail;
      // Starts the bridge early, so the first feed ads are checked before they paint.
      rail.add(page.bridge.onStatus(() => undefined));
      watchRightRailAds(page, rail);
    } else if (!this.#settings.sponsored && this.#rail) {
      this.#rail.dispose();
      this.#rail = undefined;
    }
  }

  /** Keeps new feed posts invisible until checked, where filtering applies. */
  #syncFlash(): void {
    const context = pageContext();
    document.documentElement.toggleAttribute(
      FEED_FILTERING,
      this.#settings.preventFlash &&
        !context.singlePost &&
        filtersPageType(this.#settings, context.type),
    );
  }
}

export default defineFeature({
  id: 'post_filters',
  options: POST_FILTER_OPTIONS,
  setup(ctx) {
    const { options, data, scope } = ctx;
    const saved = savedFilters(data);
    let watching: { ctx: Context; filtering: Filtering } | undefined;
    let ready = false;

    const sync = (): void => {
      if (!ready || scope.disposed) {
        return;
      }
      const settings = readSettings(options);
      const filters = [...builtInFilters(settings), ...saved.get()].filter(isRunnable);
      if (!settings.enabled || filters.length === 0) {
        watching?.ctx.scope.dispose();
        watching = undefined;
        return;
      }
      if (watching) {
        watching.filtering.update(settings, filters);
        return;
      }
      const child = ctx.child();
      watching = { ctx: child, filtering: new Filtering(child, settings, filters) };
      watching.filtering.start();
    };

    for (const key of Object.keys(POST_FILTER_OPTIONS) as (keyof PostFilterOptions)[]) {
      options.watch(key, sync);
    }
    scope.add(saved.onChange(sync));
    ready = true;
    sync();
  },
});
