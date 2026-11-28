import { useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SiteStatus } from '../../core/site-settings';
import type { ThemeDocumentV1 } from '../../core/theming/document';
import type { GlobalThemeOverride } from '../../core/theming/library';
import type { DragHandleProps } from '../primitives';
import type { AnalyzedSavedTheme } from './popup-theme-card';
import { NAME, SUPPORT_URL } from '../../../project';
import { isSiteVisible } from '../../core/site-settings';
import { analyzeThemeDocument } from '../../core/theming/document';
import {
  Badge,
  BrandMark,
  BrandWordmark,
  getSiteMark,
  SettingCard,
  Switch,
  UiIcon,
} from '../primitives';
import { SavedThemesStrip } from './popup-theme-card';
import { SITE_QUICK_CONFIGS } from './starter-modes';

export interface UnattachedSupportedTab {
  readonly siteId: string;
  readonly displayName: string;
  readonly origins: readonly string[];
}

export interface PopupBrandBarProps {
  readonly asHeading?: boolean;
  readonly dragAttrs?: DragHandleProps & {
    readonly 'data-draggable': 'true';
    readonly title: string;
  };
  readonly showGrip?: boolean;
  readonly closeButton: ReactNode;
  readonly onSupport: () => void;
}

export function PopupBrandBar({
  asHeading = false,
  dragAttrs,
  showGrip = false,
  closeButton,
  onSupport,
}: PopupBrandBarProps) {
  const wordmark = <BrandWordmark height={17} {...(asHeading ? { label: NAME } : {})} />;
  return (
    <div className="qp-brand-bar" {...dragAttrs}>
      <div className="qp-brand-lockup">
        {showGrip && (
          <span className="qp-grip" aria-hidden="true">
            <UiIcon name="grip" size={12} />
          </span>
        )}
        <BrandMark size={22} />
        {asHeading ? <h1 className="qp-title">{wordmark}</h1> : wordmark}
      </div>
      <div className="qp-brand-actions">
        <button type="button" className="qp-support-btn" onClick={onSupport}>
          Keep {NAME} Alive
        </button>
        {closeButton}
      </div>
    </div>
  );
}

interface UnsupportedTabViewProps {
  readonly sites: readonly SiteStatus[];
  readonly experimentalUnlocked: boolean;
  readonly unattachedTab?: UnattachedSupportedTab | null;
  readonly onRequestAccess?: () => Promise<boolean>;
  readonly onRetryConnect?: () => void;
  readonly onReloadTab?: () => void;
  readonly savedThemes: readonly AnalyzedSavedTheme[];
  readonly globalTheme: GlobalThemeOverride | undefined;
  readonly closeButton: ReactNode;
  readonly toastEl: ReactNode;
  readonly onSetSiteEnabled: (siteId: string, enabled: boolean) => void;
  readonly onApplyAllSites: (doc: ThemeDocumentV1, displayName?: string) => void;
  readonly onOpenSettings: (section?: string) => void;
  readonly onOpenSiteUrl: (url: string) => void;
}

export function UnsupportedTabView({
  sites,
  experimentalUnlocked,
  unattachedTab,
  onRequestAccess,
  onRetryConnect,
  onReloadTab,
  savedThemes,
  globalTheme,
  closeButton,
  toastEl,
  onSetSiteEnabled,
  onApplyAllSites,
  onOpenSettings,
  onOpenSiteUrl,
}: UnsupportedTabViewProps) {
  const siteIdPrefix = useId();
  const [showExperimental, setShowExperimental] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);

  // Keep experimental rows visible for the rest of the current popup session if
  // they were enabled when opened so toggling one off doesn't drop focus or trap undo.
  const seenEnabledRef = useRef<Set<string> | null>(null);
  seenEnabledRef.current ??= new Set();
  const seenEnabled = seenEnabledRef.current;
  for (const site of sites) {
    if (site.experimental && site.enabled) {
      seenEnabled.add(site.id);
    }
  }
  const betaExpanded = experimentalUnlocked && showExperimental;
  const canToggleBeta =
    experimentalUnlocked &&
    sites.some((site) => site.experimental && !isSiteVisible(site) && !seenEnabled.has(site.id));
  const visibleSites = sites.filter(
    (site) => betaExpanded || isSiteVisible(site) || seenEnabled.has(site.id),
  );

  const globalThemeFingerprint = useMemo(
    () =>
      savedThemes.length > 0 && globalTheme
        ? analyzeThemeDocument(globalTheme.document).fingerprint
        : '',
    [savedThemes.length, globalTheme],
  );

  const handleRequestAccess = (): void => {
    if (!onRequestAccess || requestingAccess) {
      return;
    }
    setRequestingAccess(true);
    void onRequestAccess().finally(() => setRequestingAccess(false));
  };

  return (
    <div className="qp-root" role="region" aria-label={`${NAME} quick controls`}>
      <header className="qp-unsupported-header">
        <PopupBrandBar
          asHeading
          closeButton={closeButton}
          onSupport={() => onOpenSiteUrl(SUPPORT_URL)}
        />
        <div className="qp-unsupported-bar">
          <span className="qp-status">
            {unattachedTab
              ? `Permission needed on ${unattachedTab.displayName}`
              : 'Not active on this page'}
          </span>
        </div>
      </header>

      <div className="qp-body">
        {unattachedTab && (
          <SettingCard title={`Connect ${unattachedTab.displayName}`}>
            <div className="qp-permission-card" role="status">
              <p className="qp-permission-copy">
                {NAME} doesn&apos;t have access to {unattachedTab.displayName} on this tab yet.
                Grant site access or reload the tab to connect.
              </p>
              <div className="qp-permission-actions">
                {onRequestAccess && (
                  <button
                    type="button"
                    className="qp-btn primary"
                    disabled={requestingAccess}
                    onClick={handleRequestAccess}
                  >
                    {requestingAccess ? 'Requesting…' : 'Grant access'}
                  </button>
                )}
                {onRetryConnect && (
                  <button type="button" className="qp-btn" onClick={onRetryConnect}>
                    Retry
                  </button>
                )}
                {onReloadTab && (
                  <button type="button" className="qp-btn" onClick={onReloadTab}>
                    Reload tab
                  </button>
                )}
              </div>
              <p className="qp-permission-hint">
                In Safari, you can also enable access in Safari → Settings → Extensions.
              </p>
            </div>
          </SettingCard>
        )}

        <SettingCard
          title="Supported sites"
          action={
            canToggleBeta ? (
              <button
                type="button"
                className="qp-presets-btn"
                aria-expanded={betaExpanded}
                onClick={() => setShowExperimental((open) => !open)}
              >
                {betaExpanded ? 'Hide beta' : 'Show beta'}
              </button>
            ) : undefined
          }
        >
          {visibleSites.map((site) => {
            const cfg = SITE_QUICK_CONFIGS[site.id];
            const switchId = `${siteIdPrefix}-${site.id}`;
            return (
              <div key={site.id} className="qp-site-row">
                <div className="qp-site-left">
                  <span className="qp-site-badge" aria-hidden="true">
                    {getSiteMark(site.id, site.displayName)}
                  </span>
                  <label className="qp-site-name" htmlFor={switchId}>
                    {site.displayName}
                  </label>
                  {site.experimental && <Badge tone="warning">Beta</Badge>}
                </div>
                <div className="qp-site-controls">
                  <Switch
                    id={switchId}
                    checked={site.enabled}
                    ariaLabel={`Enable ${NAME} on ${site.displayName}`}
                    onChange={(next) => onSetSiteEnabled(site.id, next)}
                  />
                  {cfg && (
                    <button
                      type="button"
                      className="qp-open-link"
                      onClick={() => onOpenSiteUrl(cfg.launchUrl)}
                    >
                      Open
                      <UiIcon name="externalLink" size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </SettingCard>

        {savedThemes.length > 0 && (
          <SettingCard title="My Themes" action={<Badge tone="neutral">All sites</Badge>}>
            <div className="qp-saved-card-pad">
              <SavedThemesStrip
                items={savedThemes}
                activeFingerprint={globalThemeFingerprint}
                ariaLabel="My Themes"
                onSelect={(entry) => onApplyAllSites(entry.document)}
              />
            </div>
          </SettingCard>
        )}
      </div>

      {toastEl}

      <footer className="qp-footer">
        <button
          type="button"
          className="qp-btn qp-btn-ghost"
          onClick={() => onOpenSettings('Appearance')}
        >
          <UiIcon name="sparkles" size={13} />
          Theme Studio
        </button>
        <button
          type="button"
          className="qp-btn primary qp-btn-grow"
          onClick={() => onOpenSettings()}
        >
          All settings →
        </button>
      </footer>
    </div>
  );
}
