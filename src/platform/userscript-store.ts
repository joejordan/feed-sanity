import type { Store } from '../core/storage';

// The userscript manager calls this file uses. They are declared here, not
// globally, so that no other code can call them and break the extension.
declare const GM: {
  getValue: (name: string) => Promise<unknown>;
  setValue: (name: string, value: unknown) => Promise<void>;
};

/** Tampermonkey and Violentmonkey only. */
declare const GM_addValueChangeListener:
  | undefined
  | ((
      name: string,
      listener: (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void,
    ) => unknown);

/** The `@grant` lines the userscript header needs, one per call declared above. */
export const GRANTS = ['GM.getValue', 'GM.setValue', 'GM_addValueChangeListener'];

/**
 * Settings storage for the userscript build, on the `GM` calls that
 * Greasemonkey, Tampermonkey and Violentmonkey all provide.
 */
export const userscriptStore: Store = {
  get: (key) => GM.getValue(key),
  set: (key, value) => GM.setValue(key, value),
  onChange(key, listener) {
    // Greasemonkey has no change listener. There, a setting saved in another
    // tab takes effect on the next page load.
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(key, (_name, oldValue, newValue) => listener(oldValue, newValue));
    }
  },
};
