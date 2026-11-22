import { useEffect, useRef, useState } from 'react';
import type { SitePermissionStatus, SitePermissionsClient } from '../core/platform';
import type { OptionsPanel } from './options-dialog/panel';
import { NAME } from '../../project';
import { definePanel } from './options-dialog/panel';
import css from './sites-panel.css?inline';

export type { SitePermissionsClient };

function statusLabel(site: SitePermissionStatus): string {
  if (site.required) {
    return 'Built-in';
  }
  return site.enabled ? 'Enabled' : 'Not enabled';
}

function SitesPanelView({ client }: { client: SitePermissionsClient }) {
  const [sites, setSites] = useState<SitePermissionStatus[]>(() => client.initial());
  const [busyId, setBusyId] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void client
      .list()
      .then((next) => {
        if (alive.current) {
          setSites(next);
        }
      })
      .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [client]);

  const disable = async (siteId: string): Promise<void> => {
    setBusyId(siteId);
    try {
      const next = await client.revoke(siteId);
      if (alive.current) {
        setSites(next);
      }
    } catch {
      // Keep current list on transient IPC error.
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
        {client.managedByExtension
          ? `Optional sites only request host permission when you enable them. Visit an optional site and click the ${NAME} toolbar button to grant access immediately with no page reload.`
          : 'Site matching in the userscript build is managed by your userscript manager.'}
      </p>
      <ul className="sites-list">
        {sites.map((site) => (
          <li key={site.id} className="sites-card">
            <div className="sites-meta">
              <div className="sites-name-row">
                <span className="sites-name">{site.displayName}</span>
                <span className={site.enabled ? 'sites-badge enabled' : 'sites-badge'}>
                  {statusLabel(site)}
                </span>
              </div>
              <p className="description">{site.description}</p>
              {!site.required && !site.enabled && client.managedByExtension && (
                <p className="sites-hint">
                  Open {site.displayName} and click the {NAME} toolbar icon to enable.
                </p>
              )}
            </div>
            {!site.required && site.enabled && client.managedByExtension && (
              <button
                className="button"
                type="button"
                disabled={busyId === site.id}
                onClick={() => void disable(site.id)}
              >
                {busyId === site.id ? 'Disabling…' : 'Disable'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Read/revoke Sites panel shown in the Options dialog across all sites. */
export function sitesPanel(client: SitePermissionsClient): OptionsPanel {
  return definePanel<null>({
    section: 'Sites',
    css,
    ready: Promise.resolve(),
    read: () => null,
    save: () => Promise.resolve(),
    Panel: () => <SitesPanelView client={client} />,
  });
}
