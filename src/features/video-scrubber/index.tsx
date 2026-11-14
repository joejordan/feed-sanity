import type { Scope } from '../../core/scope';
import type { Video } from '../../facebook/videos';
import type { MountedOverlay } from '../../ui/overlay';
import type { ControlBox, StripPlace } from './layout';
import { addStyle } from '../../core/dom';
import { Listeners } from '../../core/listeners';
import { defineFeature } from '../../facebook/feature';
import { STOOD_IN_FOR } from '../../facebook/selectors';
import { mountOverlay } from '../../ui/overlay';
import { AT_BOTTOM, placeStrip, sameBox, samePlace } from './layout';
import { Scrubber } from './scrubber';
import css from './scrubber.css?inline';

export const STYLE_ID = 'feed_sanity_video_scrubber';

/**
 * What to hide to hide Facebook's bar: the outermost of the elements around
 * it that have its box and hold no other control, since those take the
 * pointer over the bar too, or else the bar itself. It never holds the
 * video, whose container holds the scrubber, which a hidden element around
 * it would hide too. Reads layout only.
 */
function coverOf(bar: ControlBox, video: Element, controls: readonly ControlBox[]): Element {
  const others = controls.filter(({ element }) => !bar.element.contains(element));
  let cover = bar.element;
  for (let node = cover.parentElement; node && node !== document.body; node = node.parentElement) {
    const holdsOther = node.contains(video) || others.some(({ element }) => node.contains(element));
    if (holdsOther || !sameBox(node.getBoundingClientRect(), bar.box)) {
      break;
    }
    cover = node;
  }
  return cover;
}

/** Where the strip goes on `video`, from where the video and Facebook's controls are. Reads layout only. */
function measurePlace(video: Video): StripPlace {
  const controls = video.controls().map(({ element, bar }) => ({
    element,
    box: element.getBoundingClientRect(),
    bar,
  }));
  const place = placeStrip(video.element.getBoundingClientRect(), controls);
  const bar = place.hides && controls.find(({ element }) => element === place.hides);
  return bar ? { ...place, hides: coverOf(bar, video.element, controls) } : place;
}

/**
 * Hides Facebook's elements that a scrubber stands in for: marks each one
 * and hides what carries the mark, and everything in it, with one rule.
 * Returns a function that hides an element and returns one that shows it
 * again once no scrubber stands in for it. When `scope` is disposed every
 * element is shown again at once, before the rule goes, and nothing is
 * hidden after that.
 */
function hider(scope: Scope): (element: Element) => () => void {
  scope.add(
    addStyle(STYLE_ID, `[${STOOD_IN_FOR}], [${STOOD_IN_FOR}] * { visibility: hidden !important; }`),
  );
  /** How many scrubbers stand in for each hidden element. */
  const hidden = new Map<Element, number>();
  scope.add(() => {
    for (const element of hidden.keys()) {
      element.removeAttribute(STOOD_IN_FOR);
    }
    hidden.clear();
  });
  return (element) => {
    if (scope.disposed) {
      return () => undefined;
    }
    element.setAttribute(STOOD_IN_FOR, '');
    hidden.set(element, (hidden.get(element) ?? 0) + 1);
    let shown = false;
    return () => {
      const count = hidden.get(element);
      if (shown || count === undefined) {
        return;
      }
      shown = true;
      if (count > 1) {
        hidden.set(element, count - 1);
      } else {
        hidden.delete(element);
        element.removeAttribute(STOOD_IN_FOR);
      }
    };
  };
}

/**
 * Puts a scrubber on every video: a bar along its bottom edge that shows
 * what has played and lets the user move through the video. New in this
 * project.
 *
 * Facebook keeps its own controls over the video, faded out when not in
 * use. The strip is placed from where they are on the screen; see
 * `placeStrip`. Where Facebook's own position bar lies over the bottom
 * edge, as in the reel viewer, the strip takes its place and Facebook's bar
 * is hidden for as long as the scrubber shows on that video. The strip is
 * measured when it is put on the video, when the video or its container
 * changes size, and when the tracker reports that Facebook's controls may
 * have moved.
 */
export default defineFeature({
  id: 'video_scrubber',
  options: {
    video_scrubber: {
      section: 'Videos',
      title: 'Video scrubber',
      description:
        'Show a bar along the bottom of each video with how far it has played. Click or drag the bar to move through the video.',
      default: true,
    },
  },
  enabledBy: 'video_scrubber',
  setup({ page, scope, log }) {
    const hide = hider(scope);
    /** The overlay on each video. */
    const shown = new Map<Video, MountedOverlay>();
    const remove = (video: Video): void => {
      shown.get(video)?.();
      shown.delete(video);
    };
    scope.add(() => {
      for (const video of shown.keys()) {
        remove(video);
      }
    });
    page.videos.onControls((video) => shown.get(video)?.measure());
    page.videos.onRemove(remove);
    // Also called at once with the videos already on the page.
    page.videos.onAdd((video) => {
      let place = AT_BOTTOM;
      const moved = new Listeners(log);
      const scrubber = (
        <Scrubber
          video={video.element}
          place={{ get: () => place, subscribe: (listener) => moved.add(listener) }}
          hide={hide}
        />
      );
      const overlay = mountOverlay(video.element, scrubber, {
        container: () => video.container,
        css,
        onMeasure: () => {
          const next = measurePlace(video);
          if (!samePlace(place, next)) {
            place = next;
            moved.emit();
          }
        },
      });
      shown.set(video, overlay);
    });
  },
});
