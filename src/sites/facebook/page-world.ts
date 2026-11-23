import { servePageWorld } from '../../core/page-world';
import { PAGE_ACTIONS } from '../../facebook/page-actions';
import { PAGE_MOUNTS } from '../../facebook/page-mounts';
import { PAGE_TOGGLES } from '../../facebook/page-toggles';
import { PAGE_READERS } from '../../facebook/react-readers';

/** Starts Facebook's MAIN-world PageBridge responder (shared by extension and userscript). */
export function startFacebookPageWorld(): void {
  servePageWorld(PAGE_READERS, PAGE_TOGGLES, PAGE_ACTIONS, PAGE_MOUNTS);
}
