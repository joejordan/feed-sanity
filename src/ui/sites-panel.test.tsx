import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SiteSettingsClient, SiteStatus } from '../core/site-settings';
import { sitesPanel } from './sites-panel';

describe('sitesPanel', () => {
  afterEach(cleanup);
  it('shows production sites, gates experimental sites behind a warning toggle, and toggles live with pending state', async () => {
    let statuses: SiteStatus[] = [
      {
        id: 'facebook',
        displayName: 'Facebook',
        description: 'Facebook features.',
        enabled: true,
      },
      {
        id: 'x',
        displayName: 'X (Twitter)',
        description: 'X features.',
        enabled: true,
      },
      {
        id: 'instagram',
        displayName: 'Instagram',
        description: 'Instagram features.',
        enabled: false,
        experimental: true,
      },
      {
        id: 'reddit',
        displayName: 'Reddit',
        description: 'Reddit features.',
        enabled: false,
        experimental: true,
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
    let experimentalUnlocked = false;
    const setExperimentalUnlocked = vi.fn(async (unlocked: boolean) => {
      experimentalUnlocked = unlocked;
      for (const listener of listeners) {
        listener();
      }
    });
    const client: SiteSettingsClient = {
      ready: Promise.resolve(),
      list: () => statuses,
      isEnabled: (id) => statuses.find((s) => s.id === id)?.enabled ?? true,
      setEnabled,
      isExperimentalUnlocked: () => experimentalUnlocked,
      setExperimentalUnlocked,
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const panel = sitesPanel(client);

    render(<panel.Panel value={null} onChange={() => undefined} />);

    // Badge counts visible production + active experimental sites (2/2 initially).
    expect(panel.badge?.()).toBe('2/2');

    // Only production sites (Facebook, X) are visible until Show experimental sites is toggled on.
    expect(screen.queryByText('Built-in')).toBeNull();
    expect(screen.getAllByText('Enabled')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Disable / })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Enable Instagram' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enable Reddit' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Disable Facebook' }));
    expect(setEnabled).toHaveBeenCalledWith('facebook', false);
    const busyBtn = screen.getByRole('button', { name: 'Disable Facebook' }) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(busyBtn.getAttribute('aria-busy')).toBe('true');
    expect(busyBtn.querySelector('.fs-spinner')).not.toBeNull();
    expect(busyBtn.textContent).toBe('Disabling…');

    finishToggle();
    expect(await screen.findByText('Disabled')).toBeTruthy();
    expect(panel.badge?.()).toBe('1/2');
    const enableBtn = await screen.findByRole('button', { name: 'Enable Facebook' });
    expect(enableBtn.textContent).toBe('Enable');

    await userEvent.click(enableBtn);
    expect(setEnabled).toHaveBeenCalledWith('facebook', true);
    finishToggle();
    await vi.waitFor(() => expect(screen.getAllByText('Enabled')).toHaveLength(2));

    // Toggling Show experimental sites reveals warning + disabled Instagram and Reddit cards and persists opt-in.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show experimental sites' }));
    expect(setExperimentalUnlocked).toHaveBeenCalledWith(true);
    expect(screen.getByText(/things will be broken/i)).toBeTruthy();
    const enableIg = screen.getByRole('button', { name: 'Enable Instagram' });
    expect(screen.getByRole('button', { name: 'Enable Reddit' })).toBeTruthy();

    await userEvent.click(enableIg);
    expect(setEnabled).toHaveBeenCalledWith('instagram', true);
    finishToggle();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Disable Instagram' })).toBeTruthy(),
    );
    expect(panel.badge?.()).toBe('3/3');

    // Collapsing experimental sites persists opt-out, and triggering a Command Jump search hit
    // for an experimental site automatically expands the section again.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show experimental sites' }));
    expect(setExperimentalUnlocked).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button', { name: 'Enable Reddit' })).toBeNull();
    const redditHit = panel.searchItems?.().find((item) => item.id === 'site:reddit');
    expect(redditHit?.onSelect).toBeTypeOf('function');
    redditHit?.onSelect?.();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enable Reddit' })).toBeTruthy(),
    );
  });

  it('auto-reveals experimental sites when one is already enabled or matches currentSiteId and tolerates storage errors', async () => {
    const client: SiteSettingsClient = {
      ready: Promise.resolve(),
      list: () => [
        {
          id: 'gmail',
          displayName: 'Gmail',
          description: 'Gmail features.',
          enabled: true,
          experimental: true,
        },
      ],
      isEnabled: () => true,
      setEnabled: () => Promise.reject(new Error('storage offline')),
      isExperimentalUnlocked: () => false,
      setExperimentalUnlocked: () => Promise.resolve(),
      onChange: () => () => undefined,
    };
    const panel = sitesPanel(client);

    render(<panel.Panel value={null} onChange={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Disable Gmail' }) as HTMLButtonElement;
    await userEvent.click(btn);
    expect(btn.disabled).toBe(false);
    expect(screen.getByText('Enabled')).toBeTruthy();
  });

  it('keeps the Disabling spinner steady while waitForSiteSync is still settling after storage writes', async () => {
    let enabled = true;
    const listeners = new Set<() => void>();
    const syncGate = Promise.withResolvers<void>();
    const client: SiteSettingsClient = {
      ready: Promise.resolve(),
      list: () => [
        {
          id: 'facebook',
          displayName: 'Facebook',
          description: 'Facebook features.',
          enabled,
        },
      ],
      isEnabled: () => enabled,
      setEnabled: async (_id, next) => {
        enabled = next;
        for (const listener of listeners) {
          listener();
        }
      },
      isExperimentalUnlocked: () => false,
      setExperimentalUnlocked: () => Promise.resolve(),
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    const panel = sitesPanel(client, 'facebook', () => syncGate.promise);
    render(<panel.Panel value={null} onChange={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: 'Disable Facebook' }));
    await vi.waitFor(() => {
      const btn = screen.getByRole<HTMLButtonElement>('button', { name: 'Disable Facebook' });
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Disabling…');
      expect(btn.querySelector('.fs-spinner')).not.toBeNull();
    });

    syncGate.resolve();
    await vi.waitFor(() => {
      const btn = screen.getByRole<HTMLButtonElement>('button', { name: 'Enable Facebook' });
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Enable');
      expect(btn.querySelector('.fs-spinner')).toBeNull();
    });
  });
});
