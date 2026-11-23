import { useRef } from 'react';
import type { QuickPopupRequest } from '../../core/platform';
import { mount } from '../mount';
import { primitivesCss, useDraggable } from '../primitives';
import { QuickPopup } from './quick-popup';
import css from './quick-popup.css?inline';

const HOST_ID = 'feed_sanity_quick_popup';

let closeOpen: (() => void) | undefined;

function DraggableQuickOverlay({
  request,
  onClose,
}: {
  readonly request: QuickPopupRequest;
  readonly onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useDraggable(overlayRef);

  return (
    <div
      ref={overlayRef}
      className="qp-overlay"
      data-dragging={drag.dragging ? 'true' : undefined}
      style={drag.style}
    >
      <QuickPopup
        store={request.store}
        activeTab={request.activeTab}
        siteSettings={request.siteSettings}
        headerDragProps={drag.handleProps}
        onOpenSettings={(section) => {
          onClose();
          request.onOpenSettings(section);
        }}
        onOpenSiteUrl={(url) => {
          onClose();
          window.open(url, '_blank', 'noopener');
        }}
        onClose={onClose}
      />
    </div>
  );
}

/**
 * Mounts the shared Quick Control Center anchored top-right inside a draggable
 * Shadow DOM overlay (used by the Userscript build for feature parity with the
 * extension toolbar popup).
 */
export function openQuickPopup(request: QuickPopupRequest): void {
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

  const unmount = mount(<DraggableQuickOverlay request={request} onClose={close} />, {
    id: HOST_ID,
    css: [primitivesCss, css].join('\n'),
  });
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
