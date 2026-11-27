import { servePageWorld } from '../../core/page-world';
import { createSetHomeFeedAction, PAGE_ACTIONS, SET_HOME_FEED } from '../../facebook/page-actions';
import { PAGE_MOUNTS } from '../../facebook/page-mounts';
import { PAGE_TOGGLES } from '../../facebook/page-toggles';
import { PAGE_READERS } from '../../facebook/react-readers';

/** Starts Facebook's MAIN-world PageBridge responder (shared by extension and userscript). */
export function startFacebookPageWorld(): void {
  const setHomeFeed = createSetHomeFeedAction();
  const emitter = servePageWorld(
    PAGE_READERS,
    PAGE_TOGGLES,
    { ...PAGE_ACTIONS, [SET_HOME_FEED]: setHomeFeed },
    PAGE_MOUNTS,
  );
  emitter.onDispose(() => setHomeFeed.dispose());
}
