import type { ReactNode } from 'react';

/** What a panel's component receives. */
export interface PanelProps<T> {
  /** The value as the user has edited it so far. */
  value: T;
  /** Call with the whole new value after each edit. Nothing is saved until the user saves the dialog. */
  onChange: (value: T) => void;
}

/**
 * A part of the options dialog that a feature draws itself, for settings
 * that are more than a list of options. It appears in `section`, below that
 * section's options, and its edits are saved and dropped with the dialog's.
 */
export interface OptionsPanel<T = unknown> {
  section: string;
  /** Style sheet for the panel, added to the dialog's. */
  css?: string;
  /** Settles once `read` returns the saved value. The dialog waits for it before it opens. */
  ready: Promise<void>;
  read: () => T;
  save: (value: T) => Promise<void>;
  /**
   * Why the edited value cannot be saved, or null when it can. While a
   * panel has a problem, the dialog says so and will not save.
   */
  problem?: (value: T) => string | null;
  Panel: (props: PanelProps<T>) => ReactNode;
}

/** Declares a panel, checking that its parts agree on the value's type. */
export function definePanel<T>(panel: OptionsPanel<T>): OptionsPanel {
  return panel as unknown as OptionsPanel;
}
