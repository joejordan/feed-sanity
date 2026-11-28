import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Badge, Disclosure, TextInput } from '../primitives';

const CUSTOM_CSS_DEBOUNCE_MS = 250;

export interface CustomCssDisclosureProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly jumpId?: string;
  readonly customCss: string;
  readonly onCustomCssChange: (nextCss: string) => void;
  readonly hasStylesheetOption: boolean;
  readonly savedStylesheetUrl: string;
  readonly stylesheetDraft: string;
  readonly onStylesheetDraftChange: (draft: string) => void;
  readonly onCommitStylesheetUrl: (raw: string) => void;
}

export function CustomCssDisclosure({
  open,
  onToggle,
  jumpId,
  customCss,
  onCustomCssChange,
  hasStylesheetOption,
  savedStylesheetUrl,
  stylesheetDraft,
  onStylesheetDraftChange,
  onCommitStylesheetUrl,
}: CustomCssDisclosureProps) {
  const stylesheetId = useId();
  const [cssDraft, setCssDraft] = useState(customCss);
  const pendingCssRef = useRef<string | null>(null);
  const lastCommittedRef = useRef(customCss);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onCustomCssChange);
  onChangeRef.current = onCustomCssChange;

  const flushCssDraft = useCallback((): void => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    const pending = pendingCssRef.current;
    if (pending !== null) {
      pendingCssRef.current = null;
      lastCommittedRef.current = pending;
      onChangeRef.current(pending);
    }
  }, []);

  useEffect(() => {
    // Ignore echoes of our own last commit while the user is typing a newer draft;
    // any other `customCss` change (Undo, Reset, Import, external tab) wins immediately.
    if (pendingCssRef.current !== null && customCss === lastCommittedRef.current) {
      return;
    }
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    pendingCssRef.current = null;
    lastCommittedRef.current = customCss;
    setCssDraft(customCss);
  }, [customCss]);

  useEffect(() => flushCssDraft, [flushCssDraft]);

  const handleCssInput = (next: string): void => {
    setCssDraft(next);
    pendingCssRef.current = next;
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(flushCssDraft, CUSTOM_CSS_DEBOUNCE_MS);
  };

  const isActive = Boolean(cssDraft.trim() || savedStylesheetUrl.trim());

  return (
    <Disclosure
      label="Custom CSS"
      badge={isActive ? <Badge tone="accent">Active</Badge> : undefined}
      open={open}
      onToggle={onToggle}
      {...(jumpId ? { jumpId } : {})}
    >
      <div className="theme-drawer-pad">
        <label className="theme-color-row">
          <span>Custom CSS</span>
          <textarea
            className="field"
            rows={4}
            aria-label="Custom CSS"
            placeholder="Write custom CSS rules layered on top of this site's theme"
            spellCheck={false}
            value={cssDraft}
            onChange={(event) => handleCssInput(event.currentTarget.value)}
            onBlur={flushCssDraft}
          />
        </label>
        {hasStylesheetOption && (
          <div className="theme-color-row">
            <label htmlFor={stylesheetId}>Custom stylesheet URL</label>
            <div className="theme-external-css-row">
              <TextInput
                id={stylesheetId}
                type="url"
                className="field theme-hex"
                ariaLabel="Custom stylesheet URL"
                placeholder="https://example.com/custom.css"
                spellCheck={false}
                value={stylesheetDraft}
                onValueChange={onStylesheetDraftChange}
                onBlur={(event) => onCommitStylesheetUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommitStylesheetUrl(event.currentTarget.value);
                  }
                }}
              />
              {stylesheetDraft.trim() !== savedStylesheetUrl && (
                <button
                  type="button"
                  className="button primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onCommitStylesheetUrl(stylesheetDraft)}
                >
                  Apply
                </button>
              )}
              {savedStylesheetUrl && stylesheetDraft.trim() === savedStylesheetUrl && (
                <button type="button" className="button" onClick={() => onCommitStylesheetUrl('')}>
                  Clear
                </button>
              )}
            </div>
            <span className="theme-studio-hint">
              Loads a CSS file from the web on every page of this site. Serve it over HTTPS as{' '}
              <code>text/css</code>, or the browser may refuse it. Works alongside the CSS above.
            </span>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
