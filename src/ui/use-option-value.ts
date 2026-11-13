import { useCallback, useSyncExternalStore } from 'react';
import type { Options, OptionValue } from '../core/options';

/** Reads an option's current value and renders again when it changes, including from another tab. */
export function useOptionValue(options: Options, key: string): OptionValue {
  const subscribe = useCallback(
    (onChange: () => void) => options.watch(key, onChange),
    [options, key],
  );
  return useSyncExternalStore(subscribe, () => options.get(key));
}
