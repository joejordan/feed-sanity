import type { Options } from '../../core/options';
import type { OptionsPanel } from './panel';
import { mount } from '../mount';
import { OptionsDialog } from './options-dialog';
import css from './options-dialog.css?inline';

const HOST_ID = 'feed_sanity_options';

/** Closes the open dialog, or undefined when none is open. */
let closeOpen: (() => void) | undefined;

/**
 * Shows the options dialog, unless it is already open. It waits for the
 * saved values first, so that the dialog shows them and a save does not
 * overwrite the ones not read yet.
 */
export async function openOptionsDialog(
  options: Options,
  panels: readonly OptionsPanel[] = [],
): Promise<void> {
  await Promise.all([options.loaded, ...panels.map((panel) => panel.ready)]);
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
  const unmount = mount(<OptionsDialog options={options} panels={panels} onClose={close} />, {
    id: HOST_ID,
    css: [css, ...panels.map((panel) => panel.css ?? '')].join('\n'),
  });
  closeOpen = close;
}
