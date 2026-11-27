import { useEffect, useId, useRef, useState } from 'react';
import type { SiteSettingsClient, SiteStatus } from '../core/site-settings';
import type { OptionsPanel } from './options-dialog/panel';
import { isSiteVisible } from '../core/site-settings';
import { definePanel } from './options-dialog/panel';
import { Badge, getSiteMark, SettingCard, Switch } from './primitives';
import css from './sites-panel.css?inline';

function SiteCard({
  site,
  currentSiteId,
  busyId,
  onToggle,
}: {
  readonly site: SiteStatus;
  readonly currentSiteId?: string;
  readonly busyId: string | null;
  readonly onToggle: (site: SiteStatus) => void;
}) {
  const busy = busyId === site.id;
  let actionLabel: string;
  if (busy) {
    actionLabel = site.enabled ? 'Disabling…' : 'Enabling…';
  } else {
    actionLabel = site.enabled ? 'Disable' : 'Enable';
  }
  return (
    <li className="sites-row">
      <span className="sites-mark" aria-hidden="true">
        {getSiteMark(site.id, site.displayName)}
      </span>
      <div className="sites-meta">
        <div className="sites-name-row">
          <span className="sites-name">{site.displayName}</span>
          {site.id === currentSiteId && <Badge tone="accent">Current tab</Badge>}
          {site.experimental && <Badge tone="warning">Experimental</Badge>}
          <Badge tone={site.enabled ? 'success' : 'neutral'}>
            {site.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <p className="sites-desc">{site.description}</p>
      </div>
      <button
        className={site.enabled ? 'button' : 'button primary'}
        type="button"
        aria-label={`${site.enabled ? 'Disable' : 'Enable'} ${site.displayName}`}
        disabled={busyId !== null}
        onClick={() => onToggle(site)}
      >
        {actionLabel}
      </button>
    </li>
  );
}

function SitesPanelView({
  client,
  currentSiteId,
  onSiteListChange,
  consumeRevealPending,
  registerReveal,
}: {
  client: SiteSettingsClient;
  currentSiteId?: string;
  onSiteListChange: () => void;
  consumeRevealPending: () => boolean;
  registerReveal: (fn: (() => void) | undefined) => void;
}) {
  const experimentalToggleId = useId();
  const [sites, setSites] = useState<SiteStatus[]>(() => client.list());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showExperimental, setShowExperimental] = useState<boolean>(
    () =>
      consumeRevealPending() ||
      sites.some((s) => s.experimental && (s.enabled || s.id === currentSiteId)),
  );
  const alive = useRef(true);
  const onSiteListChangeRef = useRef(onSiteListChange);
  onSiteListChangeRef.current = onSiteListChange;

  useEffect(() => {
    registerReveal(() => setShowExperimental(true));
    return () => registerReveal(undefined);
  }, [registerReveal]);

  useEffect(() => {
    alive.current = true;
    const refresh = (): void => {
      if (alive.current) {
        setSites(client.list());
        onSiteListChangeRef.current();
      }
    };
    const stop = client.onChange(refresh);
    return () => {
      alive.current = false;
      stop();
    };
  }, [client]);

  const toggle = async (site: SiteStatus): Promise<void> => {
    setBusyId(site.id);
    try {
      await client.setEnabled(site.id, !site.enabled);
    } catch {
      // Keep current list on transient storage error.
    } finally {
      if (alive.current) {
        setBusyId(null);
      }
    }
  };

  const renderSiteList = (list: readonly SiteStatus[]) => (
    <ul className="sites-list">
      {list.map((site) => (
        <SiteCard
          key={site.id}
          site={site}
          {...(currentSiteId ? { currentSiteId } : {})}
          busyId={busyId}
          onToggle={(target) => void toggle(target)}
        />
      ))}
    </ul>
  );

  const productionSites = sites.filter((site) => !site.experimental);
  const experimentalSites = sites.filter((site) => site.experimental);
  const enabledExperimentalCount = experimentalSites.filter((site) => site.enabled).length;

  return (
    <section className="sites-panel">
      <SettingCard title="Supported Sites">{renderSiteList(productionSites)}</SettingCard>

      {experimentalSites.length > 0 && (
        <div className="sites-experimental">
          <div className="sites-experimental-header">
            <div className="sites-meta">
              <div className="sites-name-row">
                <label className="sites-name" htmlFor={experimentalToggleId}>
                  Experimental sites
                </label>
                <Badge tone="warning">Unfinished</Badge>
                {enabledExperimentalCount > 0 && (
                  <Badge tone="neutral">{enabledExperimentalCount} active</Badge>
                )}
              </div>
              <p className="sites-desc">
                Early support for sites that are still rough around the edges. Expect broken filters
                or unfinished styling.
              </p>
            </div>
            <Switch
              id={experimentalToggleId}
              checked={showExperimental}
              ariaLabel="Show experimental sites"
              onChange={setShowExperimental}
            />
          </div>

          {showExperimental && (
            <>
              <p className="sites-experimental-warning" role="note">
                Warning: these sites are work-in-progress and things will be broken. Each site stays
                disabled by default until you turn it on below.
              </p>
              <SettingCard>{renderSiteList(experimentalSites)}</SettingCard>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Per-site enable/disable panel shown identically in Options across every supported site. */
export function sitesPanel(client: SiteSettingsClient, currentSiteId?: string): OptionsPanel {
  let revealPending = false;
  let revealActive: (() => void) | undefined;
  const requestReveal = (): void => {
    if (revealActive) {
      revealActive();
    } else {
      revealPending = true;
    }
  };
  const consumeRevealPending = (): boolean => {
    const pending = revealPending;
    revealPending = false;
    return pending;
  };
  const registerReveal = (fn: (() => void) | undefined): void => {
    revealActive = fn;
    if (fn && revealPending) {
      revealPending = false;
      fn();
    }
  };

  return definePanel<null>({
    section: 'Sites',
    css,
    instant: true,
    ready: client.ready,
    read: () => null,
    save: () => Promise.resolve(),
    badge: () => {
      const relevant = client.list().filter(isSiteVisible);
      if (relevant.length === 0) {
        return null;
      }
      const on = relevant.filter((s) => s.enabled).length;
      return `${on}/${relevant.length}`;
    },
    searchItems: () =>
      client.list().map((site) => ({
        id: `site:${site.id}`,
        title: `${site.displayName} (${site.enabled ? 'Enabled' : 'Disabled'})`,
        description: site.description,
        keywords: [
          'site',
          site.id,
          site.displayName.toLowerCase(),
          ...(site.experimental ? ['experimental', 'beta'] : []),
        ],
        ...(site.experimental ? { onSelect: requestReveal } : {}),
      })),
    Panel: ({ onChange }) => (
      <SitesPanelView
        client={client}
        {...(currentSiteId ? { currentSiteId } : {})}
        onSiteListChange={() => onChange(null)}
        consumeRevealPending={consumeRevealPending}
        registerReveal={registerReveal}
      />
    ),
  });
}
