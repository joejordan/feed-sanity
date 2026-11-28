import { useEffect, useId, useRef } from 'react';
import { Badge, UiIcon } from '../primitives';

export const MAX_SEARCH_HITS = 10;

export interface IndexedSearchHit {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly section: string;
  readonly haystack: string;
  readonly optionKey?: string;
  readonly panelItemId?: string;
  readonly groupKey?: string;
  readonly onSelect?: () => void;
}

export interface CommandJumpOverlayProps {
  readonly query: string;
  readonly activeIndex: number;
  readonly hits: readonly IndexedSearchHit[];
  readonly onQueryChange: (query: string) => void;
  readonly onActiveIndexChange: (next: number) => void;
  readonly onSelect: (hit: IndexedSearchHit) => void;
  readonly onClose: () => void;
}

export function CommandJumpOverlay({
  query,
  activeIndex,
  hits,
  onQueryChange,
  onActiveIndexChange,
  onSelect,
  onClose,
}: CommandJumpOverlayProps) {
  const listboxId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const keyboardNavRef = useRef(false);

  const visibleHits = hits.slice(0, MAX_SEARCH_HITS);
  const safeActiveIndex =
    visibleHits.length > 0 ? Math.min(Math.max(0, activeIndex), visibleHits.length - 1) : 0;
  const optionId = (idx: number): string => `${listboxId}-option-${idx}`;
  const activeDescendant = visibleHits[safeActiveIndex] ? optionId(safeActiveIndex) : undefined;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (keyboardNavRef.current && safeActiveIndex >= 0) {
      keyboardNavRef.current = false;
      activeItemRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [safeActiveIndex]);

  const handleQueryChange = (next: string): void => {
    if (next !== query) {
      onQueryChange(next);
    }
  };

  const handleBoxKeyDown = (event: {
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const focusables = [
      ...box.querySelectorAll<HTMLElement>(
        'input:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (focusables.length === 0) {
      return;
    }
    const root = box.getRootNode();
    const activeEl =
      root instanceof Document || root instanceof ShadowRoot
        ? (root.activeElement as HTMLElement | null)
        : null;
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && (!activeEl || activeEl === first)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && activeEl === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="cmd-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={boxRef}
        className="cmd-box"
        role="dialog"
        aria-modal="true"
        aria-label="Search settings"
        onKeyDown={handleBoxKeyDown}
      >
        <div className="cmd-input-row">
          <UiIcon name="search" size={15} />
          <input
            ref={inputRef}
            className="cmd-input"
            type="search"
            role="combobox"
            aria-label="Jump to setting"
            aria-expanded={visibleHits.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeDescendant}
            placeholder="Search settings, themes, rules, sites, or actions…"
            value={query}
            onInput={(event) => handleQueryChange(event.currentTarget.value)}
            onChange={(event) => handleQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              const max = visibleHits.length;
              if (event.key === 'ArrowDown' && max > 0) {
                event.preventDefault();
                keyboardNavRef.current = true;
                onActiveIndexChange((safeActiveIndex + 1) % max);
              } else if (event.key === 'ArrowUp' && max > 0) {
                event.preventDefault();
                keyboardNavRef.current = true;
                onActiveIndexChange((safeActiveIndex - 1 + max) % max);
              } else if (event.key === 'Enter' && visibleHits[safeActiveIndex]) {
                event.preventDefault();
                onSelect(visibleHits[safeActiveIndex]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
          />
        </div>
        <div id={listboxId} className="cmd-list" role="listbox" aria-label="Matching settings">
          {visibleHits.length === 0 ? (
            <div className="cmd-empty">No options match.</div>
          ) : (
            visibleHits.map((hit, idx) => {
              const isActive = idx === safeActiveIndex;
              return (
                <button
                  key={hit.id}
                  id={optionId(idx)}
                  ref={isActive ? activeItemRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className="cmd-item"
                  data-active={isActive ? 'true' : undefined}
                  onMouseEnter={() => {
                    if (!isActive) {
                      onActiveIndexChange(idx);
                    }
                  }}
                  onClick={() => onSelect(hit)}
                >
                  <span className="cmd-item-main">
                    <span className="cmd-item-title">{hit.title}</span>
                    {hit.description && <span className="cmd-item-desc">{hit.description}</span>}
                  </span>
                  <Badge>{hit.section}</Badge>
                </button>
              );
            })
          )}
        </div>
        {hits.length > MAX_SEARCH_HITS && (
          <div className="cmd-footer">
            Showing {MAX_SEARCH_HITS} of {hits.length} matches. Type to narrow.
          </div>
        )}
      </div>
    </div>
  );
}
