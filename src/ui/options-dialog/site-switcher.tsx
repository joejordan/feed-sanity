import { useEffect, useId, useRef, useState } from 'react';
import type { SiteStatus } from '../../core/site-settings';
import { Badge, getSiteMark, Switch, UiIcon } from '../primitives';

export interface SiteSwitcherConfig {
  /** Sites available to load in the standalone Settings window. */
  readonly sites: readonly SiteStatus[];
  /** Called when the user picks a site from the dropdown menu. */
  readonly onSelectSite: (siteId: string) => void;
  /** True when disabled experimental sites remain hidden behind the Sites tab toggle. */
  readonly hasHiddenExperimental?: boolean;
}

export interface SiteSwitcherCardProps {
  readonly site: { readonly id: string; readonly displayName: string };
  readonly enabledHere: boolean;
  readonly togglingSite?: 'enabling' | 'disabling' | null;
  readonly onToggleSite?: (enabled: boolean) => void;
  readonly switcher: SiteSwitcherConfig;
  readonly onManageSites?: () => void;
}

/**
 * Interactive top-left site card for standalone Settings mode. Clicking the
 * card opens a rich listbox menu of available sites (mark, status, Beta badge,
 * description, active check) while keeping the site's pause/resume Switch
 * cleanly clickable on the right without opening the menu.
 */
export function SiteSwitcherCard({
  site,
  enabledHere,
  togglingSite = null,
  onToggleSite,
  switcher,
  onManageSites,
}: SiteSwitcherCardProps) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const labelId = useId();

  const { sites, onSelectSite, hasHiddenExperimental } = switcher;
  const activeIndex = Math.max(
    0,
    sites.findIndex((entry) => entry.id === site.id),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const btn = optionRefs.current[focusIndex];
    btn?.focus();
  }, [open, focusIndex]);

  const openMenu = (): void => {
    setFocusIndex(activeIndex);
    setOpen(true);
  };

  const selectSite = (siteId: string): void => {
    setOpen(false);
    if (siteId === site.id) {
      queueMicrotask(() => triggerRef.current?.focus());
    } else {
      onSelectSite(siteId);
    }
  };

  const handleTriggerKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
      }
    }
  };

  const handleListKeyDown = (event: { key: string; preventDefault: () => void }): void => {
    const count = sites.length;
    if (count === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusIndex((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusIndex((i) => (i - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setFocusIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setFocusIndex(count - 1);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="site-switcher-wrap"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (open && (!nextTarget || !wrapRef.current?.contains(nextTarget))) {
          setOpen(false);
        }
      }}
    >
      <div className="site-header" data-switchable="true" data-open={open ? 'true' : undefined}>
        <button
          ref={triggerRef}
          type="button"
          className="site-switcher-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={`Switch site (${site.displayName})`}
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleTriggerKeyDown}
        >
          <span className="site-mark" aria-hidden="true">
            {getSiteMark(site.id, site.displayName)}
          </span>
          <span className="site-meta">
            <span className="site-title-row">
              <span className="site-title">{site.displayName}</span>
              <span className="site-switcher-chevron" aria-hidden="true">
                <UiIcon name="chevronDown" size={13} />
              </span>
            </span>
            <span className="site-status" aria-busy={togglingSite !== null || undefined}>
              {togglingSite === null ? (
                <span
                  className="site-dot"
                  data-paused={enabledHere ? undefined : 'true'}
                  aria-hidden="true"
                />
              ) : (
                <span className="fs-spinner" aria-hidden="true" />
              )}
              {togglingSite === 'enabling' && 'Enabling…'}
              {togglingSite === 'disabling' && 'Pausing…'}
              {togglingSite === null &&
                (enabledHere ? 'Active · Switch site' : 'Paused · Switch site')}
            </span>
          </span>
        </button>
        {onToggleSite && (
          <Switch
            checked={enabledHere}
            disabled={togglingSite !== null}
            ariaLabel={`Enable Feed Sanity on ${site.displayName}`}
            onChange={onToggleSite}
          />
        )}
      </div>

      {open && (
        <div className="site-menu">
          <div className="site-menu-header">
            <span id={labelId} className="site-menu-kicker">
              Load site settings
            </span>
            <Badge tone="neutral">
              {sites.length} {sites.length === 1 ? 'site' : 'sites'}
            </Badge>
          </div>
          <div
            id={menuId}
            className="site-menu-list"
            role="listbox"
            aria-labelledby={labelId}
            onKeyDown={handleListKeyDown}
          >
            {sites.map((entry, idx) => {
              const selected = entry.id === site.id;
              return (
                <button
                  key={entry.id}
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  tabIndex={idx === focusIndex ? 0 : -1}
                  aria-selected={selected}
                  className="site-menu-item"
                  data-selected={selected ? 'true' : undefined}
                  onMouseEnter={() => setFocusIndex(idx)}
                  onClick={() => selectSite(entry.id)}
                >
                  <span className="site-menu-mark" aria-hidden="true">
                    {getSiteMark(entry.id, entry.displayName)}
                  </span>
                  <span className="site-menu-copy">
                    <span className="site-menu-title-row">
                      <span className="site-menu-name">{entry.displayName}</span>
                      {entry.experimental && <Badge tone="warning">Beta</Badge>}
                      <span className="site-menu-status">
                        <span
                          className="site-dot"
                          data-paused={entry.enabled ? undefined : 'true'}
                          aria-hidden="true"
                        />
                        {entry.enabled ? 'Active' : 'Paused'}
                      </span>
                    </span>
                    <span className="site-menu-desc">{entry.description}</span>
                  </span>
                  <span className="site-menu-check" aria-hidden="true">
                    {selected && <UiIcon name="check" size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
          {onManageSites && (
            <div className="site-menu-footer">
              <button
                type="button"
                className="site-menu-manage"
                onClick={() => {
                  setOpen(false);
                  onManageSites();
                }}
              >
                <UiIcon name="globe" size={13} />
                <span>
                  {hasHiddenExperimental ? 'Manage & unlock beta sites…' : 'Manage all sites…'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
