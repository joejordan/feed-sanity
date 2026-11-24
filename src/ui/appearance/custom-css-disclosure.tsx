import { useId } from 'react';
import { Badge, Disclosure, TextInput } from '../primitives';

export interface CustomCssDisclosureProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly customCss: string;
  readonly onCustomCssChange: (nextCss: string) => void;
  readonly hasExternalCssOption: boolean;
  readonly savedExternalCssUrl: string;
  readonly externalCssDraft: string;
  readonly onExternalCssDraftChange: (draft: string) => void;
  readonly onCommitExternalCssUrl: (raw: string) => void;
}

export function CustomCssDisclosure({
  open,
  onToggle,
  customCss,
  onCustomCssChange,
  hasExternalCssOption,
  savedExternalCssUrl,
  externalCssDraft,
  onExternalCssDraftChange,
  onCommitExternalCssUrl,
}: CustomCssDisclosureProps) {
  const externalCssId = useId();
  const isActive = Boolean(customCss.trim() || savedExternalCssUrl.trim());

  return (
    <Disclosure
      label="Custom CSS"
      badge={isActive ? <Badge tone="accent">Active</Badge> : undefined}
      open={open}
      onToggle={onToggle}
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
            value={customCss}
            onChange={(event) => onCustomCssChange(event.currentTarget.value)}
          />
        </label>
        {hasExternalCssOption && (
          <div className="theme-color-row">
            <label htmlFor={externalCssId}>External stylesheet URL</label>
            <div className="theme-external-css-row">
              <TextInput
                id={externalCssId}
                type="url"
                className="field theme-hex"
                ariaLabel="External CSS url"
                placeholder="https://example.com/custom.css"
                spellCheck={false}
                value={externalCssDraft}
                onValueChange={onExternalCssDraftChange}
                onBlur={(event) => onCommitExternalCssUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommitExternalCssUrl(event.currentTarget.value);
                  }
                }}
              />
              {externalCssDraft.trim() !== savedExternalCssUrl && (
                <button
                  type="button"
                  className="button primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onCommitExternalCssUrl(externalCssDraft)}
                >
                  Apply
                </button>
              )}
              {savedExternalCssUrl && externalCssDraft.trim() === savedExternalCssUrl && (
                <button type="button" className="button" onClick={() => onCommitExternalCssUrl('')}>
                  Clear
                </button>
              )}
            </div>
            <span className="theme-studio-hint">
              Optional HTTPS stylesheet URL (served as <code>text/css</code>). Use inline CSS, an
              external URL, or both.
            </span>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
