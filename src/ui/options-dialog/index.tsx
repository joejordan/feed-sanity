import type { Options } from '../../core/options';
import { mount } from '../mount';
import { OptionsDialog } from './options-dialog';
import css from './options-dialog.css?inline';

const HOST_ID = 'feed_sanity_options';

/** Closes the open dialog, or undefined when none is open. */
let closeOpen: (() => void) | undefined;

/** Shows the options dialog, unless it is already open. */
export function openOptionsDialog(options: Options): void {
  if (closeOpen) {
    return;
  }
  // A save that finishes after the user closed this dialog calls `close`
  // again. By then another dialog may be open, and it has to stay.
  const close = () => {
    if (closeOpen === close) {
      closeOpen = undefined;
      unmount();
    }
  };
  const unmount = mount(<OptionsDialog options={options} onClose={close} />, { id: HOST_ID, css });
  closeOpen = close;
}
