import { useEffect, useRef } from 'react';
import { Badge, UiIcon } from '../primitives';

export const MAX_SEARCH_HITS = 10;

export interface IndexedSearchHit {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly section: string;
  readonly haystack: string;
  readonly optionKey?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const keyboardNavRef = useRef(false);

  const visibleHits = hits.slice(0, MAX_SEARCH_HITS);
  const safeActiveIndex =
    visibleHits.length > 0 ? Math.min(Math.max(0, activeIndex), visibleHits.length - 1) : 0;

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
      <div className="cmd-box" role="dialog" aria-label="Search settings">
        <div className="cmd-input-row">
          <UiIcon name="search" size={15} />
          <input
            ref={inputRef}
            className="cmd-input"
            type="search"
            aria-label="Jump to setting"
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
        <div className="cmd-list">
          {visibleHits.length === 0 ? (
            <div className="cmd-empty">No options match.</div>
          ) : (
            visibleHits.map((hit, idx) => {
              const isActive = idx === safeActiveIndex;
              return (
                <button
                  key={hit.id}
                  ref={isActive ? activeItemRef : undefined}
                  type="button"
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
