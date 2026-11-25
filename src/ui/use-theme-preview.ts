import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ThemeDocumentV1 } from '../core/theming/document';

export interface ThemePreviewControls {
  /** Lazily builds and previews a candidate document keyed by `previewKey`, skipping redundant previews and no-ops matching `current`. */
  readonly preview: (previewKey: string, buildCandidate: () => ThemeDocumentV1) => void;
  /** Previews an already-built `doc` keyed by `previewKey`, optionally short-circuiting when `matchesCurrent` is known. */
  readonly previewDocument: (
    previewKey: string,
    doc: ThemeDocumentV1,
    matchesCurrent?: boolean,
  ) => void;
  /** Ends any active hover/focus preview (`onPreview(null)`). */
  readonly clear: () => void;
  /** Resets active hover tracking when committing an edit; returns `true` if a hover preview was active. */
  readonly markCommitted: () => boolean;
  /** True when a hover/focus preview is currently active. */
  readonly isActive: () => boolean;
}

/**
 * Shared hover/focus theme preview state machine used by both AppearancePanel
 * and QuickPopup. Deduplicates consecutive identical previews (e.g. `mouseenter`
 * followed by `focus`), avoids eager `JSON.stringify`, clears automatically on
 * unmount or disable, and suppresses trailing `mouseleave` clears after click.
 */
export function useThemePreview(
  current: ThemeDocumentV1,
  onPreview: ((doc: ThemeDocumentV1 | null) => void) | undefined,
  enabled = true,
): ThemePreviewControls {
  const currentRef = useRef(current);
  currentRef.current = current;
  const onPreviewRef = useRef(onPreview);
  onPreviewRef.current = onPreview;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const activeKeyRef = useRef<string | null>(null);
  const currentJsonRef = useRef<{ doc: ThemeDocumentV1; json: string } | null>(null);

  const clear = useCallback((): void => {
    if (activeKeyRef.current === null) {
      return;
    }
    activeKeyRef.current = null;
    onPreviewRef.current?.(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      clear();
    }
  }, [enabled, clear]);

  useEffect(() => () => clear(), [clear]);

  const getCurrentJson = useCallback((): string => {
    const doc = currentRef.current;
    if (currentJsonRef.current?.doc !== doc) {
      currentJsonRef.current = { doc, json: JSON.stringify(doc) };
    }
    return currentJsonRef.current.json;
  }, []);

  const previewDocument = useCallback(
    (previewKey: string, doc: ThemeDocumentV1, matchesCurrent?: boolean): void => {
      if (!enabledRef.current || !onPreviewRef.current || activeKeyRef.current === previewKey) {
        return;
      }
      if (
        matchesCurrent === true ||
        doc === currentRef.current ||
        (matchesCurrent === undefined && JSON.stringify(doc) === getCurrentJson())
      ) {
        clear();
        return;
      }
      activeKeyRef.current = previewKey;
      onPreviewRef.current(doc);
    },
    [clear, getCurrentJson],
  );

  const preview = useCallback(
    (previewKey: string, buildCandidate: () => ThemeDocumentV1): void => {
      if (!enabledRef.current || !onPreviewRef.current || activeKeyRef.current === previewKey) {
        return;
      }
      previewDocument(previewKey, buildCandidate());
    },
    [previewDocument],
  );

  const markCommitted = useCallback((): boolean => {
    const hadPreview = activeKeyRef.current !== null;
    activeKeyRef.current = null;
    return hadPreview;
  }, []);

  const isActive = useCallback((): boolean => activeKeyRef.current !== null, []);

  return useMemo(
    () => ({ preview, previewDocument, clear, markCommitted, isActive }),
    [preview, previewDocument, clear, markCommitted, isActive],
  );
}
