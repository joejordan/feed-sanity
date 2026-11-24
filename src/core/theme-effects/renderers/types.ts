// Shared contracts between the effects layer controller and backdrop renderers.

import type { ThemeColorScheme, ThemePalette } from '../../theming';
import type { ThemeEffectsConfig } from '../model';

export interface BackdropContext {
  readonly doc: Document;
  readonly container: HTMLElement;
  readonly palette: ThemePalette | null;
  readonly hostScheme: ThemeColorScheme;
  readonly effects: ThemeEffectsConfig;
}

export interface BackdropInstance {
  update: (ctx: BackdropContext) => void;
  burst?: (normX: number, normY: number) => void;
  destroy: () => void;
}
