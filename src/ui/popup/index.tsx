import type { QuickPopupRequest } from '../../core/platform';
import { mount } from '../mount';
import { primitivesCss } from '../primitives';
import { QuickPopup } from './quick-popup';
import css from './quick-popup.css?inline';

const HOST_ID = 'feed_sanity_quick_popup';

let closeOpen: (() => void) | undefined;

/**
 * Mounts the shared Quick Control Center anchored top-right inside a Shadow DOM
 * overlay (used by the Userscript build for feature parity with the extension
 * toolbar popup).
 */
export function openQuickPopup({
  store,
  activeTab,
  siteSettings,
  onOpenSettings,
}: QuickPopupRequest): void {
  if (closeOpen) {
    closeOpen();
    return;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const close = (): void => {
    if (closeOpen === close) {
      closeOpen = undefined;
      globalThis.removeEventListener('keydown', onKeyDown, true);
      unmount();
    }
  };

  const unmount = mount(
    <div className="qp-overlay">
      <QuickPopup
        store={store}
        activeTab={activeTab}
        siteSettings={siteSettings}
        onOpenSettings={(section) => {
          close();
          onOpenSettings(section);
        }}
        onOpenSiteUrl={(url) => {
          close();
          window.open(url, '_blank', 'noopener');
        }}
        onClose={close}
      />
    </div>,
    {
      id: HOST_ID,
      css: [primitivesCss, css].join('\n'),
    },
  );
  // Capture phase ensures Escape still closes the overlay even when focus is inside
  // the Shadow DOM host (where `stopAtHost` stops bubble-phase keydown events).
  globalThis.addEventListener('keydown', onKeyDown, true);
  closeOpen = close;
}

export type { QuickPopupProps } from './quick-popup';
export type {
  QuickToggleSpec,
  SiteQuickConfig,
  StarterModeId,
  StarterModeSpec,
} from './starter-modes';
export { QuickPopup } from './quick-popup';
export {
  detectActiveMode,
  getSiteQuickConfig,
  QUICK_THEME_PRESET_IDS,
  SITE_QUICK_CONFIGS,
} from './starter-modes';
