import type { ReactNode } from 'react';
import type { Options } from '../../core/options';

/** Searchable item contributed by a custom panel to unified dialog search (`⌘K`). */
export interface PanelSearchItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  /** Optional one-click action when selected in search (in addition to opening the section). */
  readonly onSelect?: () => void;
}

/** What a panel's component receives. */
export interface PanelProps<T> {
  /** The value as the user has edited it so far. */
  value: T;
  /**
   * Call with the whole new value after each edit. Saved immediately for
   * `instant` panels, or buffered when explicit validation/apply is required.
   */
  onChange: (value: T) => void;
  /** Optional toast notifier supplied by `OptionsDialog` for instant-apply + Undo feedback. */
  notify?: (message: string, onUndo?: () => void) => void;
  /** Optional shared `Options` store so panels can embed related feature options cleanly. */
  options?: Options;
}

/**
 * A part of the options dialog that a feature draws itself, for settings
 * that are more than a list of options. It appears in `section`, alongside
 * that section's options.
 */
export interface OptionsPanel<T = unknown> {
  section: string;
  /** Style sheet for the panel, added to the dialog's. */
  css?: string;
  /** When true, `onChange` persists immediately (instant-apply) instead of buffering. */
  instant?: boolean;
  /** Optional sidebar pill text (e.g. active rule count or `'5/5'`). */
  badge?: () => string | null;
  /** Optional dual-tone sidebar swatch (e.g. active theme preview dot). */
  swatch?: () => { readonly bg: string; readonly accent: string } | null;
  /** Optional items indexed by unified Command Jump / Search (`⌘K`). */
  searchItems?: () => readonly PanelSearchItem[];
  /** Settles once `read` returns the saved value. The dialog waits for it before it opens. */
  ready: Promise<void>;
  read: () => T;
  save: (value: T) => Promise<void>;
  /**
   * Why the edited value cannot be saved, or null when it can. While a
   * panel has a problem, the dialog says so and will not save.
   */
  problem?: (value: T) => string | null;
  /** Optional cleanup invoked when the options dialog closes (e.g. clearing live previews). */
  onClose?: () => void;
  Panel: (props: PanelProps<T>) => ReactNode;
}

/** Declares a panel, checking that its parts agree on the value's type. */
export function definePanel<T>(panel: OptionsPanel<T>): OptionsPanel {
  return panel as unknown as OptionsPanel;
}
