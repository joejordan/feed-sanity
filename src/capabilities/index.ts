// Composable cross-site capability contracts.
//
// Features declare which capabilities they need (`feed`, `media`, `composer`,
// `navigation`, `threads`) instead of importing site-specific page interfaces.
// Each `SiteAdapter` composes the engines it needs (React, Meta Comet, Network
// Tap, Web Components, Closure/Wiz) to implement the capabilities that exist
// on that host.

import type { Feature, FeatureContext, FeatureDefinition } from '../core/feature';
import type { OptionSpecs } from '../core/options';
import { defineFeature } from '../core/feature';

/** Aggregate tracking statistics reported by any feed capability implementation. */
export interface FeedStats {
  readonly started: boolean;
  readonly tracked: number;
  readonly withId: number;
  readonly withoutId: number;
  readonly identifying: number;
  readonly unrecognised: number;
}

/** One interactive host control overlaying a video player. */
export interface VideoControl {
  readonly element: Element;
  /** True for a horizontal seek/position slider running across the player. */
  readonly bar: boolean;
}

/** Progressive video file or manifest metadata returned by a site's media reader. */
export interface MediaSources {
  readonly file: string | null;
  readonly manifest: boolean | string | null;
  readonly videoId: string | null;
}

/** A single logical feed item (Facebook post, Instagram post, X tweet, TikTok card, Reddit post). */
export interface FeedItem {
  readonly element: HTMLElement;
  readonly content: HTMLElement;
  readonly id: string | null;
  readonly permalink: boolean;
  readonly isAd?: boolean;
  readonly isSuggested?: boolean;
  readonly readLowerText?: () => string;
}

/** Feed stream capability for cross-site post filtering, ad hiding, and mark-as-read features. */
export interface FeedCapability {
  onTrack: (listener: (item: FeedItem) => void) => () => void;
  onUntrack: (listener: (item: FeedItem) => void) => () => void;
  onAdd: (listener: (item: FeedItem) => void) => () => void;
  onUpdate: (listener: (item: FeedItem) => void) => () => void;
  onRemove: (listener: (item: FeedItem) => void) => () => void;
  onReset: (listener: () => void) => () => void;
}

/** A single logical media/video player on a page. */
export interface MediaItem {
  readonly element: HTMLVideoElement;
  readonly container: Element;
  readonly surface: string;
  onControls: (listener: () => void) => () => void;
}

/** Media/video capability for cross-site video scrubber, click-to-pause, and download features. */
export interface MediaCapability {
  onAdd: (listener: (video: MediaItem) => void) => () => void;
  onRemove: (listener: (video: MediaItem) => void) => () => void;
  onControls?: (listener: (video: MediaItem) => void) => () => void;
  around: (element: Element, within?: Element) => MediaItem | undefined;
}

/** Navigation/chrome capability (top bar, sidebars, active feed switching). */
export interface NavCapability {
  readonly currentFeed: () => string | null;
  readonly switchFeed?: (feedId: string) => Promise<boolean>;
}

/** Post/message composer capability. */
export interface ComposerCapability {
  readonly open: (mode?: string) => Promise<boolean>;
}

/** Thread/inbox row capability for mail and messaging apps such as Gmail. */
export interface ThreadRow {
  readonly element: HTMLElement;
  readonly id: string | null;
  readonly unread: boolean;
  readonly isAd?: boolean;
  readonly readLowerText?: () => string;
}

export interface ThreadListCapability {
  onAdd: (listener: (row: ThreadRow) => void) => () => void;
  onUpdate?: (listener: (row: ThreadRow) => void) => () => void;
  onRemove: (listener: (row: ThreadRow) => void) => () => void;
  onReset?: (listener: () => void) => () => void;
}

/** Complete map of optional domain capabilities a site may expose. */
export interface SiteCapabilities {
  readonly feed?: FeedCapability;
  readonly media?: MediaCapability;
  readonly navigation?: NavCapability;
  readonly composer?: ComposerCapability;
  readonly threads?: ThreadListCapability;
}

export type CapabilityName = keyof SiteCapabilities;

/** Page object carrying a capability bag, accepted by cross-site capability features. */
export interface CapablePage {
  readonly capabilities: SiteCapabilities;
}

/** Narrows `SiteCapabilities` so every key in `K` is guaranteed defined. */
export type RequiredCapabilities<K extends CapabilityName> = {
  readonly [P in K]-?: NonNullable<SiteCapabilities[P]>;
};

export interface CapabilityFeatureDefinition<
  S extends OptionSpecs,
  K extends CapabilityName,
  P extends CapablePage = CapablePage,
> extends Omit<FeatureDefinition<S, P>, 'setup'> {
  /** Capabilities this feature requires; it is skipped cleanly on sites that omit any of them. */
  readonly requires: readonly K[];
  readonly setup: (
    context: FeatureContext<S, P> & { readonly caps: RequiredCapabilities<K> },
  ) => void | Promise<void>;
}

/**
 * Declares a site-agnostic feature that activates automatically on any site
 * whose `SiteAdapter` provides all of `requires`.
 */
export function defineCapabilityFeature<
  S extends OptionSpecs,
  K extends CapabilityName,
  P extends CapablePage = CapablePage,
>(definition: CapabilityFeatureDefinition<S, K, P>): Feature<P> {
  const { requires, setup, ...rest } = definition;
  return defineFeature<S, P>({
    ...rest,
    setup(context) {
      const caps = context.page.capabilities;
      for (const name of requires) {
        if (!caps[name]) {
          return;
        }
      }
      return setup({
        ...context,
        caps: caps as RequiredCapabilities<K>,
      });
    },
  });
}
