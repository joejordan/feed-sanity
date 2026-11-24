// Cross-site capability feature combining Feed Sanity's bottom video scrubber
// and click-to-pause behavior (`PauseHolds` + `hasControlAt` + `intercept`)
// for any site exposing `MediaCapability` (Instagram, X.com, Reddit, etc.).

import type { CapablePage, MediaItem } from '../../capabilities';
import type { Feature } from '../../core/feature';
import type { Locate, LocatorSpec } from '../../core/locator';
import type { OptionSpec } from '../../core/options';
import type { Scope } from '../../core/scope';
import { defineCapabilityFeature } from '../../capabilities';
import { containsAcrossShadows } from '../../core/dom';
import { intercept, isPlainPress, PRESS_EVENTS } from '../../core/intercept';
import { OWN_ATTR } from '../../core/surface';
import { PauseHolds } from '../video-click-pauses/hold';
import { hasControlAt, measureControls, pointIn } from '../video-layout';
import { overlayEachVideo } from '../video-overlay';
import { AT_BOTTOM, placeStrip, samePlace } from '../video-scrubber/layout';
import { Scrubber } from '../video-scrubber/scrubber';
import scrubberCss from '../video-scrubber/scrubber.css?inline';

export interface VideoControlsPage extends CapablePage {
  readonly doc: Document;
  readonly locate: Locate;
}

export interface SharedVideoControlsConfig {
  readonly id: string;
  /** Option key prefix (e.g. `'ig'` -> `ig_video_scrubber`, `ig_video_click_pauses`). */
  readonly prefix: string;
  readonly scrubberDescription: string;
  readonly clickToPauseDescription: string;
  /** CSS selector matching the feed post container surrounding clickable feed videos. */
  readonly postSelector: string;
  /** Locator for native player controls so clicking mute/fullscreen never triggers pause. */
  readonly controlSpec: LocatorSpec;
  /** Allowed video surfaces for click-to-pause (defaults to `'feed'`). */
  readonly clickSurface?: string;
}

const noopHide = () => () => undefined;
const DRAG_DISTANCE = 5;
const OWN_SELECTOR = `[${OWN_ATTR}]`;

interface Press {
  readonly pointerId: number;
  readonly video: MediaItem;
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

const isPlainPointer = (event: PointerEvent): boolean => event.isPrimary && isPlainPress(event);

const distance = (a: { x: number; y: number }, event: MouseEvent): number =>
  Math.hypot(event.clientX - a.x, event.clientY - a.y);

/**
 * Factory for cross-site video scrubber + click-to-pause controls built on
 * `defineCapabilityFeature` (`requires: ['media']`).
 */
export function createVideoControlsFeature<P extends VideoControlsPage>(
  config: SharedVideoControlsConfig,
): Feature<P> {
  const scrubberKey = `${config.prefix}_video_scrubber`;
  const clickKey = `${config.prefix}_video_click_pauses`;
  const clickSurface = config.clickSurface ?? 'feed';

  const optionsSpec: Record<string, OptionSpec> = {
    [scrubberKey]: {
      section: 'Media',
      group: 'Videos',
      title: 'Video scrubber',
      description: config.scrubberDescription,
      keywords: ['progress', 'seek', 'video'],
      default: true,
    },
    [clickKey]: {
      section: 'Media',
      group: 'Videos',
      title: 'Click to pause',
      description: config.clickToPauseDescription,
      keywords: ['pause', 'play', 'video'],
      default: true,
    },
  };

  return defineCapabilityFeature<typeof optionsSpec, 'media', P>({
    id: config.id,
    requires: ['media'],
    options: optionsSpec,
    setup({ page, caps, options, scope, log }) {
      const { media } = caps;
      const overlayPage = { videos: media };
      let scrubberScope: Scope | undefined;
      let clickScope: Scope | undefined;

      const startClickToPause = (subScope: Scope): void => {
        const holds = new PauseHolds(subScope, log);
        const controls = page.locate(config.controlSpec);
        subScope.add(media.onRemove((video) => holds.release(video.element)));
        subScope.add(media.onAdd(() => undefined));

        const videoAt = (event: MouseEvent): MediaItem | undefined => {
          const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
          let target: Element | undefined;
          let container: Element | undefined;
          for (const node of path) {
            if (!(node instanceof Element)) {
              continue;
            }
            if (node.hasAttribute(OWN_ATTR)) {
              return undefined;
            }
            target ??= node;
            if (!container && node.matches(config.postSelector)) {
              container = node;
            }
          }
          if (!target && event.target instanceof Element) {
            if (event.target.closest(OWN_SELECTOR)) {
              return undefined;
            }
            target = event.target;
            container = event.target.closest(config.postSelector) ?? undefined;
          }
          if (!target || !container) {
            return undefined;
          }
          const video = media.around(target, container);
          if (!video || video.surface !== clickSurface) {
            return undefined;
          }
          // Clicking Like/Retweet/Reply/author outside the video player container
          // should never force synchronous `getBoundingClientRect()` layout.
          if (video.container && !containsAcrossShadows(video.container, target)) {
            return undefined;
          }
          // Never hijack pointer events while the player is in fullscreen; host
          // players provide their own fullscreen scrubber and click controls.
          const fs = page.doc.fullscreenElement;
          if (
            fs &&
            (fs === video.element ||
              containsAcrossShadows(fs, video.element) ||
              containsAcrossShadows(video.element, fs))
          ) {
            return undefined;
          }
          const box = video.element.getBoundingClientRect();
          if (
            !pointIn(box, event.clientX, event.clientY) ||
            hasControlAt(event.clientX, event.clientY, video.element, box, controls, page.doc)
          ) {
            return undefined;
          }
          return video;
        };

        let press: Press | undefined;

        intercept(
          subScope,
          [...PRESS_EVENTS, 'keydown'],
          (event) => {
            if (event.type === 'keydown') {
              holds.gesture(event);
              return false;
            }
            if (event.type === 'pointerdown') {
              press = undefined;
              const pointer = event as PointerEvent;
              if (!isPlainPointer(pointer)) {
                holds.gesture(event);
                return false;
              }
              const video = videoAt(pointer);
              if (!video) {
                holds.gesture(event);
                return false;
              }
              press = {
                pointerId: pointer.pointerId,
                video,
                x: pointer.clientX,
                y: pointer.clientY,
                moved: false,
              };
              return true;
            }
            const current = press;
            if (!current) {
              holds.gesture(event);
              return false;
            }
            const isPointer = event.type === 'pointerup' || event.type === 'pointercancel';
            if (isPointer && (event as PointerEvent).pointerId !== current.pointerId) {
              return false;
            }
            switch (event.type) {
              case 'pointercancel':
                press = undefined;
                return false;
              case 'pointerup':
                current.moved = distance(current, event as PointerEvent) > DRAG_DISTANCE;
                return true;
              case 'click': {
                press = undefined;
                const mouse = event as MouseEvent;
                if (mouse.detail === 0) {
                  return false;
                }
                mouse.preventDefault();
                if (current.moved || !current.video.element.isConnected) {
                  return true;
                }
                const el = current.video.element;
                if (el.paused) {
                  holds.release(el);
                  el.play().catch((error: unknown) => log.debug('could not play the video', error));
                } else {
                  el.pause();
                  holds.hold(current.video);
                }
                return true;
              }
              default:
                return true;
            }
          },
          log,
        );
      };

      options.watch(scrubberKey, (enabled) => {
        if (enabled && !scrubberScope) {
          scrubberScope = scope.child();
          overlayEachVideo<ReturnType<typeof placeStrip>, MediaItem>(
            { page: overlayPage, scope: scrubberScope, log },
            {
              css: scrubberCss,
              initial: AT_BOTTOM,
              measure: (video) =>
                placeStrip(video.element.getBoundingClientRect(), measureControls(video)),
              same: samePlace,
              render: (video, place) => (
                <Scrubber video={video.element} place={place} hide={noopHide} />
              ),
            },
          );
        } else if (!enabled && scrubberScope) {
          scrubberScope.dispose();
          scrubberScope = undefined;
        }
      });

      options.watch(clickKey, (enabled) => {
        if (enabled && !clickScope) {
          clickScope = scope.child();
          startClickToPause(clickScope);
        } else if (!enabled && clickScope) {
          clickScope.dispose();
          clickScope = undefined;
        }
      });
    },
  });
}
