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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
            onInput={(event) => onQueryChange(event.currentTarget.value)}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              const max = Math.min(hits.length, MAX_SEARCH_HITS);
              if (event.key === 'ArrowDown' && max > 0) {
                event.preventDefault();
                onActiveIndexChange((activeIndex + 1) % max);
              } else if (event.key === 'ArrowUp' && max > 0) {
                event.preventDefault();
                onActiveIndexChange((activeIndex - 1 + max) % max);
              } else if (event.key === 'Enter' && hits[activeIndex]) {
                event.preventDefault();
                onSelect(hits[activeIndex]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
          />
        </div>
        <div className="cmd-list">
          {hits.length === 0 ? (
            <div className="cmd-empty">No options match.</div>
          ) : (
            hits.slice(0, MAX_SEARCH_HITS).map((hit, idx) => (
              <button
                key={hit.id}
                type="button"
                className="cmd-item"
                data-active={idx === activeIndex ? 'true' : undefined}
                onClick={() => onSelect(hit)}
              >
                <span className="cmd-item-main">
                  <span className="cmd-item-title">{hit.title}</span>
                  {hit.description && <span className="cmd-item-desc">{hit.description}</span>}
                </span>
                <Badge>{hit.section}</Badge>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
