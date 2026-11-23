import { listenAfterPage } from '../../core/listen-after-page';
import { onUrlChange } from '../../core/navigation';
import { defineFeature } from '../../facebook/feature';
import { pageContext } from '../../facebook/page';
import { STORIES_LIST } from '../../facebook/selectors';

/**
 * Keeps a story playing while the pointer or keyboard focus is on the list
 * of stories beside it. New in this project.
 *
 * Facebook pauses the story when the pointer or focus enters a wrapper in
 * the list, and plays it again when they leave. Its handlers are React's
 * `onMouseEnter`, `onFocus`, `onMouseLeave` and `onBlur`, and React works
 * out the first and the third from `mouseout` events: the element left is
 * the target, and the element entered is `relatedTarget`. So once the page
 * has had an event that brings the pointer or focus onto an element in the
 * list, a `mouseout` from that element to just outside the list makes
 * Facebook run its own leave handler, which lets the story play while the
 * pointer stays where it is. No event is stopped, so Facebook's other hover
 * handlers still hear the pointer come in, but React runs the leave
 * handlers of the entry under the pointer as well.
 *
 * The `mouseout` goes out only after the page's own listeners have had the
 * event. A capture listener would act too early for focus and for a pointer
 * that comes from outside the document, as React handles those from the
 * event itself.
 */
export default defineFeature({
  id: 'stories_keep_playing',
  options: {
    stories_keep_playing: {
      section: 'Media',
      group: 'Stories',
      title: 'Keep playing over the list',
      description:
        'Keep a story playing while the pointer or keyboard focus is on the list of stories beside it, where Facebook would pause it.',
      keywords: ['stories', 'hover', 'pause'],
      default: true,
    },
  },
  enabledBy: 'stories_keep_playing',
  setup({ page, scope, log }) {
    const list = page.locate(STORIES_LIST);

    /** Makes Facebook see the pointer leave the list from where the event came in. */
    const leave = (event: MouseEvent | FocusEvent): void => {
      const { target } = event;
      if (!(target instanceof Element) || !target.isConnected) {
        return;
      }
      const nav = list.closest(target);
      const outside = nav?.parentElement;
      if (!nav || !outside) {
        return;
      }
      // Facebook's `onFocus` runs whenever an element in the list takes
      // focus. Its `onMouseEnter` runs when the pointer comes from outside
      // the wrapper, which sits inside the list, so a move onto an entry
      // from a part of the list outside the wrapper can pause the story too.
      // Only a move out from an element inside the target enters nothing. An element that has left
      // the page, as when Facebook draws the list again, counts as outside,
      // for React too.
      const from = event instanceof MouseEvent ? event.relatedTarget : null;
      if (from instanceof Node && target.contains(from)) {
        return;
      }
      target.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: outside,
          view: target.ownerDocument.defaultView,
        }),
      );
    };

    // Listens only while on a stories page.
    let stop: (() => void) | undefined;
    const follow = (): void => {
      const here = pageContext().type === 'stories';
      if (here && !stop) {
        stop = listenAfterPage(scope, ['mouseover', 'focusin'], leave, log);
      } else if (!here && stop) {
        stop();
        stop = undefined;
      }
    };
    scope.add(onUrlChange(follow));
    follow();
  },
});
