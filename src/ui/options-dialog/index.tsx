import type { Options } from '../../core/options';
import type { SiteIdentity } from './options-dialog';
import type { OptionsPanel } from './panel';
import { mount } from '../mount';
import { primitivesCss } from '../primitives';
import { OptionsDialog } from './options-dialog';
import css from './options-dialog.css?inline';

const HOST_ID = 'feed_sanity_options';

/** Closes the open dialog, or undefined when none is open. */
let closeOpen: (() => void) | undefined;
/** Switches sections on the already-open dialog when deep-linked from the popup. */
let jumpOpenSection: ((section: string) => void) | undefined;

/** Closes the currently mounted Options dialog, if any. */
export function closeOptionsDialog(): void {
  closeOpen?.();
}

export interface OpenOptionsDialogConfig {
  readonly site?: SiteIdentity;
  readonly siteEnabled?: boolean;
  readonly onToggleSite?: (enabled: boolean) => void | Promise<void>;
  readonly onSiteEnabledChange?: (listener: (enabled: boolean) => void) => () => void;
  readonly initialSection?: string;
}

/**
 * Shows the options dialog, or jumps to `config.initialSection` if it is already
 * open. Waits for saved values first so the dialog shows live persisted state cleanly.
 */
export async function openOptionsDialog(
  options: Options,
  panels: readonly OptionsPanel[] = [],
  config: OpenOptionsDialogConfig = {},
): Promise<void> {
  await Promise.all([options.loaded, ...panels.map((panel) => panel.ready)]);
  if (closeOpen) {
    if (document.querySelector(`#${HOST_ID}`)) {
      if (config.initialSection) {
        jumpOpenSection?.(config.initialSection);
      }
      return;
    }
    // Host page detached our dialog container: clean up the stale root and remount.
    closeOpen();
  }
  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    if (closeOpen === close) {
      closeOpen = undefined;
      jumpOpenSection = undefined;
      unmount();
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    }
  };
  const unmount = mount(
    <OptionsDialog
      options={options}
      panels={panels}
      {...(config.site ? { site: config.site } : {})}
      {...(config.siteEnabled === undefined ? {} : { siteEnabled: config.siteEnabled })}
      {...(config.onToggleSite ? { onToggleSite: config.onToggleSite } : {})}
      {...(config.onSiteEnabledChange ? { onSiteEnabledChange: config.onSiteEnabledChange } : {})}
      {...(config.initialSection ? { initialSection: config.initialSection } : {})}
      registerSectionJump={(jump) => {
        if (closeOpen === close || jump !== undefined) {
          jumpOpenSection = jump;
        }
      }}
      onClose={close}
    />,
    {
      id: HOST_ID,
      css: [primitivesCss, css, ...panels.map((panel) => panel.css ?? '')].join('\n'),
    },
  );
  closeOpen = close;
}
