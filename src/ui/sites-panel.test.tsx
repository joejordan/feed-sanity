import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteSettingsClient, SiteStatus } from '../core/site-settings';
import { sitesPanel } from './sites-panel';

describe('sitesPanel', () => {
  afterEach(cleanup);
  it('lists every supported site equally and toggles Facebook and other sites live with pending state', async () => {
    let statuses: SiteStatus[] = [
      {
        id: 'facebook',
        displayName: 'Facebook',
        description: 'Facebook features.',
        enabled: true,
      },
      {
        id: 'instagram',
        displayName: 'Instagram',
        description: 'Instagram features.',
        enabled: true,
      },
    ];
    let finishToggle!: () => void;
    const listeners = new Set<() => void>();
    const setEnabled = vi.fn(
      (siteId: string, enabled: boolean) =>
        new Promise<void>((resolve) => {
          finishToggle = () => {
            statuses = statuses.map((s) => (s.id === siteId ? { ...s, enabled } : s));
            for (const listener of listeners) {
              listener();
            }
            resolve();
          };
        }),
    );
    const client: SiteSettingsClient = {
      ready: Promise.resolve(),
      list: () => statuses,
      isEnabled: (id) => statuses.find((s) => s.id === id)?.enabled ?? true,
      setEnabled,
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const panel = sitesPanel(client);

    render(<panel.Panel value={null} onChange={() => undefined} />);

    // Both Facebook and Instagram have identical Enabled badges and Disable buttons (no "Built-in" special case).
    expect(screen.queryByText('Built-in')).toBeNull();
    expect(screen.getAllByText('Enabled')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Disable / })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Disable Facebook' }));
    expect(setEnabled).toHaveBeenCalledWith('facebook', false);
    const busyBtn = screen.getByRole('button', { name: 'Disable Facebook' }) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(busyBtn.textContent).toBe('Disabling…');

    finishToggle();
    expect(await screen.findByText('Disabled')).toBeTruthy();
    const enableBtn = await screen.findByRole('button', { name: 'Enable Facebook' });
    expect(enableBtn.textContent).toBe('Enable');

    await userEvent.click(enableBtn);
    expect(setEnabled).toHaveBeenCalledWith('facebook', true);
    finishToggle();
    await vi.waitFor(() => expect(screen.getAllByText('Enabled')).toHaveLength(2));
  });

  it('tolerates transient storage failures without breaking the toggle UI', async () => {
    const client: SiteSettingsClient = {
      ready: Promise.resolve(),
      list: () => [
        {
          id: 'gmail',
          displayName: 'Gmail',
          description: 'Gmail features.',
          enabled: true,
        },
      ],
      isEnabled: () => true,
      setEnabled: () => Promise.reject(new Error('storage offline')),
      onChange: () => () => undefined,
    };
    const panel = sitesPanel(client);

    render(<panel.Panel value={null} onChange={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Disable Gmail' }) as HTMLButtonElement;
    await userEvent.click(btn);
    expect(btn.disabled).toBe(false);
    expect(screen.getByText('Enabled')).toBeTruthy();
  });
});
