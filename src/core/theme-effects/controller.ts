// Coordinates live backdrop mounting, updates, click effects, and zero-residue
// teardown for one host `Document`.

import type { ThemeColorScheme, ThemePalette } from '../theming';
import type { BackdropInstance } from './backdrops';
import type { BackdropEffectId, ThemeEffectsConfig } from './model';
import { OWN_ATTR } from '../surface';
import { BACKDROP_REGISTRY } from './backdrops';
import { mountClickEffects } from './click-fx';
import { DEFAULT_THEME_EFFECTS } from './model';
import { BACKDROP_OWN_VALUE } from './surfaces';

export interface EffectsLayerController {
  sync: (
    effects: ThemeEffectsConfig | undefined,
    palette: ThemePalette | null,
    hostScheme: ThemeColorScheme,
  ) => void;
  dispose: () => void;
}

export function createEffectsLayerController(doc: Document): EffectsLayerController {
  let backdropHost: HTMLDivElement | null = null;
  let activeBackdropId: BackdropEffectId = 'none';
  let activeBackdrop: BackdropInstance | null = null;
  let disposed = false;

  const clickFx = mountClickEffects(doc, (normX, normY) => {
    activeBackdrop?.burst?.(normX, normY);
  });

  const teardownBackdrop = (): void => {
    activeBackdrop?.destroy();
    activeBackdrop = null;
    activeBackdropId = 'none';
    backdropHost?.remove();
    backdropHost = null;
  };

  const ensureBackdropHost = (): HTMLDivElement | null => {
    if (disposed) {
      return null;
    }
    if (backdropHost?.isConnected) {
      return backdropHost;
    }
    // The page detached our host: the live backdrop went with it, so remount it
    // in the fresh host instead of updating a renderer nobody can see.
    if (backdropHost) {
      teardownBackdrop();
    }
    const target = doc.body ?? doc.documentElement;
    if (!target) {
      return null;
    }
    backdropHost = doc.createElement('div');
    backdropHost.setAttribute(OWN_ATTR, BACKDROP_OWN_VALUE);
    backdropHost.setAttribute('aria-hidden', 'true');
    backdropHost.style.cssText =
      'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;contain:strict;';
    target.prepend(backdropHost);
    return backdropHost;
  };

  const syncBackdrop = (
    effects: ThemeEffectsConfig,
    palette: ThemePalette | null,
    hostScheme: ThemeColorScheme,
  ): void => {
    if (effects.backdrop === 'none') {
      teardownBackdrop();
      return;
    }
    const host = ensureBackdropHost();
    if (!host) {
      return;
    }
    host.style.opacity = String(effects.intensity);
    host.dataset.fsBackdrop = effects.backdrop;

    const ctx = { doc, container: host, palette, hostScheme, effects };
    if (activeBackdrop && activeBackdropId === effects.backdrop) {
      activeBackdrop.update(ctx);
      return;
    }
    activeBackdrop?.destroy();
    activeBackdrop = BACKDROP_REGISTRY[effects.backdrop].mount(ctx);
    activeBackdropId = effects.backdrop;
  };

  return {
    sync(rawEffects, palette, hostScheme) {
      if (disposed) {
        return;
      }
      const effects = rawEffects ?? DEFAULT_THEME_EFFECTS;
      syncBackdrop(effects, palette, hostScheme);
      // Clicks may cascade the backdrop only when it reacts to bursts (Matrix Rain)
      // and the user keeps pointer reactions on.
      clickFx.setEffect(effects.click, palette, {
        cascade: effects.interactive && Boolean(activeBackdrop?.burst),
      });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      teardownBackdrop();
      clickFx.destroy();
    },
  };
}
