import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import type { SiteStatus } from '../../core/site-settings';
import type { Store } from '../../core/storage';
import type { SiteId } from '../../sites/manifest';
import type { StandaloneSiteSession } from '../../ui/options-dialog/standalone-site';
import { OPTIONS_TITLE } from '../../../project';
import { createLogger } from '../../core/log';
import { createSiteSettings, isSiteVisible } from '../../core/site-settings';
import {
  readSiteAccountsFromSnapshot,
  resolveSiteAccountId,
  siteStoragePrefix,
} from '../../core/site-storage';
import { createThemeLibrary } from '../../core/theming/library';
import { extensionPlatform } from '../../platform/extension';
import { extensionStore } from '../../platform/extension-store';
import { parseNavigateOptionsMessage } from '../../platform/messages';
import {
  EXTENSION_THEME_TOKENS_CSS,
  injectDocumentStyle,
  toDocumentCss,
  triggerDocumentThemeTransition,
} from '../../ui/document-theme';
import { OptionsDialog } from '../../ui/options-dialog/options-dialog';
import optionsDialogCss from '../../ui/options-dialog/options-dialog.css?inline';
import {
  createStandaloneSiteSession,
  DEFAULT_STANDALONE_SITE_ID,
  isKnownSiteId,
} from '../../ui/options-dialog/standalone-site';
import { BrandMark, BrandWordmark, primitivesCss } from '../../ui/primitives';
import baseThemeCss from '../../ui/theme.css?inline';

const log = createLogger('options-page');

const STANDALONE_LOADING_CSS = `
.fs-options-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  background: var(--fs-dialog-bg);
  color: var(--fs-text);
}
.fs-options-loading-lockup {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.fs-options-loading-text {
  font-size: 13px;
  color: var(--fs-text-secondary);
}
`;

injectDocumentStyle(
  'fs-options-base-style',
  [
    toDocumentCss(baseThemeCss),
    EXTENSION_THEME_TOKENS_CSS,
    primitivesCss,
    optionsDialogCss,
    STANDALONE_LOADING_CSS,
  ].join('\n'),
);

function readInitialParams(): { readonly siteId: SiteId; readonly section?: string } {
  const params = new URLSearchParams(globalThis.location.search);
  const requestedSite = params.get('site');
  const requestedSection = params.get('section') ?? undefined;
  return {
    siteId: isKnownSiteId(requestedSite) ? requestedSite : DEFAULT_STANDALONE_SITE_ID,
    ...(requestedSection ? { section: requestedSection } : {}),
  };
}

function mapSectionForSite(section: string | undefined, targetSiteId: SiteId): string | undefined {
  if (!section) {
    return undefined;
  }
  if (targetSiteId === 'gmail' && section === 'Filtering') {
    return 'Inbox Filtering';
  }
  if (targetSiteId !== 'gmail' && section === 'Inbox Filtering') {
    return 'Filtering';
  }
  return section;
}

function syncUrlParams(siteId: SiteId, section?: string): void {
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('site', siteId);
    if (section) {
      url.searchParams.set('section', section);
    } else {
      url.searchParams.delete('section');
    }
    globalThis.history.replaceState(null, '', url.toString());
  } catch {
    // Ignore history API restrictions.
  }
}

/**
 * Wraps `base` with a complete one-shot `storage.local.get(null)` snapshot so
 * boot-time `createSiteSettings`, `createThemeLibrary`, and the initial site
 * session hydrate in a single storage IPC (including absent keys as `undefined`)
 * before clearing back to live storage reads.
 */
function createSnapshotStore(
  base: Store,
  snapshot: Readonly<Record<string, unknown>>,
): Store & { readonly clear: () => void } {
  let active: Readonly<Record<string, unknown>> | null = snapshot;
  const readKey = (key: string): Promise<unknown> =>
    active === null ? base.get(key) : Promise.resolve(active[key]);
  return {
    get: readKey,
    getMany(keys) {
      if (active !== null) {
        const current = active;
        return Promise.resolve(Object.fromEntries(keys.map((key) => [key, current[key]])));
      }
      return base.getMany
        ? base.getMany(keys)
        : Promise.all(keys.map(async (key) => [key, await base.get(key)] as const)).then(
            Object.fromEntries,
          );
    },
    set: (key, value) => base.set(key, value),
    onChange: (key, listener) => base.onChange(key, listener),
    clear() {
      active = null;
    },
  };
}

interface StorageBootstrap {
  readonly accounts: Readonly<Record<string, string>>;
  readonly allKeys: readonly string[];
  readonly snapshotStore: Store & { readonly clear: () => void };
}

async function loadStorageBootstrap(): Promise<StorageBootstrap> {
  try {
    const all = await browser.storage.local.get(null);
    return {
      accounts: readSiteAccountsFromSnapshot(all),
      allKeys: Object.keys(all),
      snapshotStore: createSnapshotStore(extensionStore, all),
    };
  } catch (error: unknown) {
    log.error('could not inspect storage keys for standalone settings', error);
    return {
      accounts: {},
      allKeys: [],
      snapshotStore: Object.assign(extensionStore, { clear: () => undefined }),
    };
  }
}

function StandaloneOptionsApp() {
  const initial = useMemo(readInitialParams, []);
  const [selectedSiteId, setSelectedSiteId] = useState<SiteId>(initial.siteId);
  const [targetSection, setTargetSection] = useState<string | undefined>(initial.section);
  const [sites, setSites] = useState<SiteStatus[]>([]);
  const [experimentalUnlocked, setExperimentalUnlocked] = useState(false);
  const [session, setSession] = useState<StandaloneSiteSession | null>(null);
  const [bootstrap, setBootstrap] = useState<StorageBootstrap | null>(null);

  const siteSettingsRef = useRef<ReturnType<typeof createSiteSettings> | null>(null);
  const themeLibraryRef = useRef<ReturnType<typeof createThemeLibrary> | null>(null);
  const activeSessionRef = useRef<StandaloneSiteSession | null>(null);
  const sectionJumpRef = useRef<((section: string) => void) | undefined>(undefined);
  const currentSectionRef = useRef<string | undefined>(initial.section);
  const selectedSiteIdRef = useRef<SiteId>(selectedSiteId);
  selectedSiteIdRef.current = selectedSiteId;

  // Dispose the currently committed session when the standalone page unmounts.
  useEffect(() => {
    return () => {
      activeSessionRef.current?.dispose();
      activeSessionRef.current = null;
    };
  }, []);

  // Read storage once on boot, then initialize shared clients against the snapshot.
  useEffect(() => {
    let alive = true;
    let stopSites: (() => void) | undefined;
    let siteSettings: ReturnType<typeof createSiteSettings> | undefined;
    let themeLibrary: ReturnType<typeof createThemeLibrary> | undefined;

    void loadStorageBootstrap().then(async (loaded) => {
      if (!alive) {
        return;
      }
      siteSettings = createSiteSettings(loaded.snapshotStore);
      themeLibrary = createThemeLibrary(loaded.snapshotStore);
      siteSettingsRef.current = siteSettings;
      themeLibraryRef.current = themeLibrary;

      const syncSites = (): void => {
        if (!alive || !siteSettings) {
          return;
        }
        setSites(siteSettings.list());
        setExperimentalUnlocked(siteSettings.isExperimentalUnlocked());
      };
      stopSites = siteSettings.onChange(syncSites);
      await Promise.all([siteSettings.ready, themeLibrary.ready]);
      if (!alive) {
        return;
      }
      syncSites();
      setBootstrap(loaded);
    });

    return () => {
      alive = false;
      stopSites?.();
      siteSettings?.dispose?.();
      themeLibrary?.dispose();
      siteSettingsRef.current = null;
      themeLibraryRef.current = null;
    };
  }, []);

  // Load the selected site's options & panels whenever `selectedSiteId` or bootstrap updates.
  // Keep the previously committed session alive until the replacement is ready so
  // `<OptionsDialog>` never renders against a disposed `Options`/`SavedData` instance.
  useEffect(() => {
    const siteSettings = siteSettingsRef.current;
    const themeLibrary = themeLibraryRef.current;
    if (!bootstrap || !siteSettings || !themeLibrary) {
      return;
    }
    let alive = true;
    let committed = false;
    let pendingUiThemeCss: string | undefined;
    const accountId = resolveSiteAccountId(selectedSiteId, bootstrap.accounts, bootstrap.allKeys);
    const storagePrefix = siteStoragePrefix(selectedSiteId, accountId);

    const nextSession = createStandaloneSiteSession({
      siteId: selectedSiteId,
      storagePrefix,
      store: bootstrap.snapshotStore,
      siteSettings,
      themeLibrary,
      ...(extensionPlatform.fetchThemeUrl
        ? { fetchThemeUrl: extensionPlatform.fetchThemeUrl }
        : {}),
      onUiThemeCss: (css) => {
        if (!alive) {
          return;
        }
        if (committed) {
          triggerDocumentThemeTransition();
          injectDocumentStyle('fs-options-user-theme', toDocumentCss(css));
        } else {
          pendingUiThemeCss = css;
        }
      },
    });

    void nextSession.ready
      .then(() => {
        bootstrap.snapshotStore.clear();
        if (!alive) {
          return;
        }
        const previous = activeSessionRef.current;
        committed = true;
        activeSessionRef.current = nextSession;
        previous?.dispose();
        if (pendingUiThemeCss !== undefined) {
          if (previous) {
            triggerDocumentThemeTransition();
          }
          injectDocumentStyle('fs-options-user-theme', toDocumentCss(pendingUiThemeCss));
        }
        injectDocumentStyle(
          'fs-options-panel-styles',
          nextSession.panels.map((panel) => panel.css ?? '').join('\n'),
        );
        document.title = `${nextSession.displayName} · ${OPTIONS_TITLE}`;
        setSession(nextSession);
      })
      .catch((error: unknown) => {
        bootstrap.snapshotStore.clear();
        nextSession.dispose();
        log.error('could not load standalone site settings', error);
        if (
          alive &&
          activeSessionRef.current &&
          activeSessionRef.current.siteId !== selectedSiteId
        ) {
          const fallbackSiteId = activeSessionRef.current.siteId;
          setSelectedSiteId(fallbackSiteId);
          syncUrlParams(fallbackSiteId, currentSectionRef.current);
        }
      });

    return () => {
      alive = false;
      if (!committed) {
        nextSession.dispose();
      }
    };
  }, [selectedSiteId, bootstrap]);

  const switchSite = useCallback((nextSiteId: string, requestedSection?: string) => {
    if (!isKnownSiteId(nextSiteId)) {
      return;
    }
    const mappedSection = mapSectionForSite(
      requestedSection ?? currentSectionRef.current,
      nextSiteId,
    );
    currentSectionRef.current = mappedSection;
    setTargetSection(mappedSection);
    setSelectedSiteId(nextSiteId);
    syncUrlParams(nextSiteId, mappedSection);
  }, []);

  // Allow the toolbar popup to navigate this already-open window to a site/section.
  useEffect(() => {
    const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (
      message,
      sender,
      sendResponse,
    ) => {
      if (sender.id !== browser.runtime.id) {
        return;
      }
      const parsed = parseNavigateOptionsMessage(message);
      if (!parsed) {
        return;
      }
      const currentSiteId = selectedSiteIdRef.current;
      if (isKnownSiteId(parsed.siteId) && parsed.siteId !== currentSiteId) {
        switchSite(parsed.siteId, parsed.section);
      } else if (parsed.section) {
        const mapped = mapSectionForSite(parsed.section, currentSiteId);
        if (mapped) {
          currentSectionRef.current = mapped;
          setTargetSection(mapped);
          syncUrlParams(currentSiteId, mapped);
          if (activeSessionRef.current?.siteId === currentSiteId) {
            sectionJumpRef.current?.(mapped);
          }
        }
      }
      sendResponse({ ok: true });
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, [switchSite]);

  const handleSelectSite = useCallback(
    (nextSiteId: string) => switchSite(nextSiteId),
    [switchSite],
  );

  const handleSectionChange = useCallback(
    (nextSection: string) => {
      currentSectionRef.current = nextSection;
      syncUrlParams(selectedSiteId, nextSection);
    },
    [selectedSiteId],
  );

  const registerSectionJump = useCallback((jump: ((section: string) => void) | undefined) => {
    sectionJumpRef.current = jump;
  }, []);

  const sessionSiteId = session?.siteId;
  const handleToggleSite = useCallback(
    (enabled: boolean) => {
      const client = siteSettingsRef.current;
      if (!client || !sessionSiteId) {
        return;
      }
      void client.setEnabled(sessionSiteId, enabled).catch((error: unknown) => {
        log.error('could not toggle site state', error);
      });
    },
    [sessionSiteId],
  );

  const handleSiteEnabledChange = useCallback(
    (listener: (enabled: boolean) => void) => {
      const client = siteSettingsRef.current;
      if (!client || !sessionSiteId) {
        return () => undefined;
      }
      return client.onChange(() => listener(client.isEnabled(sessionSiteId)));
    },
    [sessionSiteId],
  );

  const siteSwitcher = useMemo(() => {
    const available = sites.filter(
      (site) => experimentalUnlocked || isSiteVisible(site) || site.id === selectedSiteId,
    );
    const hasHiddenExperimental =
      !experimentalUnlocked &&
      sites.some((site) => site.experimental && !site.enabled && site.id !== selectedSiteId);
    return {
      sites: available,
      onSelectSite: handleSelectSite,
      hasHiddenExperimental,
    };
  }, [sites, experimentalUnlocked, selectedSiteId, handleSelectSite]);

  const siteSettings = siteSettingsRef.current;
  if (!session || !siteSettings) {
    return (
      <div className="fs-options-loading" role="status">
        <span className="fs-options-loading-lockup" aria-hidden="true">
          <BrandMark size={28} />
          <BrandWordmark height={20} />
        </span>
        <span className="fs-options-loading-text">Loading settings…</span>
      </div>
    );
  }

  return (
    <OptionsDialog
      key={session.siteId}
      standalone
      options={session.options}
      panels={session.panels}
      site={{ id: session.siteId, displayName: session.displayName }}
      siteEnabled={siteSettings.isEnabled(session.siteId)}
      onToggleSite={handleToggleSite}
      onSiteEnabledChange={handleSiteEnabledChange}
      siteSwitcher={siteSwitcher}
      {...(targetSection ? { initialSection: targetSection } : {})}
      onSectionChange={handleSectionChange}
      registerSectionJump={registerSectionJump}
    />
  );
}

const rootEl = document.querySelector('#root');
if (rootEl) {
  createRoot(rootEl).render(<StandaloneOptionsApp />);
}
