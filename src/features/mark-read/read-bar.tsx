import { useSyncExternalStore } from 'react';
import { onUrlChange } from '../../core/navigation';
import { pageContext } from '../../facebook/page';
import { mount } from '../../ui/mount';
import css from './read-bar.css?inline';

const HOST_ID = 'feed_sanity_read_bar';

export interface ReadBarState {
  readonly readCount: number;
  readonly unreadCount: number;
  readonly showingRead: boolean;
  readonly showMarkAll: boolean;
  readonly undoCount: number;
}

export interface ReadBarController {
  subscribe: (listener: () => void) => () => void;
  getState: () => ReadBarState;
  toggleShowRead: () => void;
  markAllRead: () => void;
  undo: () => void;
}

const showsHere = (): boolean => pageContext().type !== 'stories';

/**
 * Compact floating pill at the bottom of the feed for peeking at read posts,
 * undoing a Mark Read action, and optionally marking all visible posts as read.
 */
function ReadBar({ controller }: { controller: ReadBarController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const here = useSyncExternalStore(onUrlChange, showsHere);

  if (!here || (state.readCount === 0 && state.undoCount === 0 && !state.showMarkAll)) {
    return null;
  }

  return (
    <aside className="bar" aria-label="Read posts">
      {state.readCount > 0 && (
        <>
          <span className="count">{state.readCount} read</span>
          <button
            className={state.showingRead ? 'btn accent' : 'btn'}
            type="button"
            onClick={controller.toggleShowRead}
          >
            {state.showingRead ? 'Hide read' : 'Show read'}
          </button>
        </>
      )}
      {state.showMarkAll && (
        <button
          className="btn"
          type="button"
          disabled={state.unreadCount === 0}
          onClick={controller.markAllRead}
        >
          Mark all read
        </button>
      )}
      {state.undoCount > 0 && (
        <button className="btn" type="button" onClick={controller.undo}>
          Undo ({state.undoCount})
        </button>
      )}
    </aside>
  );
}

/** Mounts the floating read-posts bar in a shadow root. Returns a teardown function. */
export function showReadBar(controller: ReadBarController): () => void {
  return mount(<ReadBar controller={controller} />, { id: HOST_ID, css });
}
