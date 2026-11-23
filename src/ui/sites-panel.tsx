import { useEffect, useRef, useState } from 'react';
import type { SiteSettingsClient, SiteStatus } from '../core/site-settings';
import type { OptionsPanel } from './options-dialog/panel';
import { NAME } from '../../project';
import { definePanel } from './options-dialog/panel';
import css from './sites-panel.css?inline';

function SitesPanelView({ client }: { client: SiteSettingsClient }) {
  const [sites, setSites] = useState<SiteStatus[]>(() => client.list());
  const [busyId, setBusyId] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const refresh = (): void => {
      if (alive.current) {
        setSites(client.list());
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

  return (
    <section className="sites-panel">
      <h3 className="sites-heading">Supported sites</h3>
      <p className="description">
        Enable or disable {NAME} on any supported site. Changes apply immediately to open tabs with
        no page reload.
      </p>
      <ul className="sites-list">
        {sites.map((site) => {
          const busy = busyId === site.id;
          let actionLabel: string;
          if (busy) {
            actionLabel = site.enabled ? 'Disabling…' : 'Enabling…';
          } else {
            actionLabel = site.enabled ? 'Disable' : 'Enable';
          }
          return (
            <li key={site.id} className="sites-card">
              <div className="sites-meta">
                <div className="sites-name-row">
                  <span className="sites-name">{site.displayName}</span>
                  <span className={site.enabled ? 'sites-badge enabled' : 'sites-badge'}>
                    {site.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="description">{site.description}</p>
              </div>
              <button
                className="button"
                type="button"
                aria-label={`${site.enabled ? 'Disable' : 'Enable'} ${site.displayName}`}
                disabled={busyId !== null}
                onClick={() => void toggle(site)}
              >
                {actionLabel}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Per-site enable/disable panel shown identically in Options across every supported site. */
export function sitesPanel(client: SiteSettingsClient): OptionsPanel {
  return definePanel<null>({
    section: 'Sites',
    css,
    ready: client.ready,
    read: () => null,
    save: () => Promise.resolve(),
    Panel: () => <SitesPanelView client={client} />,
  });
}
