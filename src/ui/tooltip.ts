import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long the pointer rests on a control before its tooltip shows, in
 * milliseconds, as for Facebook's own controls.
 */
export const TIP_DELAY_MS = 300;

/**
 * True when `element` has focus from the keyboard, when its tooltip shows
 * at once. A browser without `:focus-visible` counts every focus.
 */
export function focusedByKeyboard(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Shows and hides a tooltip: after `delay` milliseconds, or at once. */
export function useTip(): [boolean, (show: boolean, delay?: number) => void] {
  const [tip, setTip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const set = useCallback((show: boolean, delay = 0) => {
    clearTimeout(timer.current);
    if (show && delay > 0) {
      timer.current = setTimeout(() => setTip(true), delay);
    } else {
      setTip(show);
    }
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [tip, set];
}
