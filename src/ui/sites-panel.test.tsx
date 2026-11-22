import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SitePermissionStatus } from '../core/platform';
import { sitesPanel } from './sites-panel';

describe('sitesPanel', () => {
  it('lists built-in and optional sites, shows pending Disabling state, and displays post-revoke hint', async () => {
    let statuses: SitePermissionStatus[] = [
      {
        id: 'facebook',
        displayName: 'Facebook',
        description: 'Facebook features.',
        required: true,
        enabled: true,
      },
      {
        id: 'instagram',
        displayName: 'Instagram',
        description: 'Instagram features.',
        required: false,
        enabled: true,
      },
    ];
    let finishRevoke!: () => void;
    const revoke = vi.fn(
      (siteId: string) =>
        new Promise<SitePermissionStatus[]>((resolve) => {
          finishRevoke = () => {
            statuses = statuses.map((s) => (s.id === siteId ? { ...s, enabled: false } : s));
            resolve(statuses);
          };
        }),
    );
    const panel = sitesPanel({
      managedByExtension: true,
      initial: () => statuses.map((s) => ({ ...s, enabled: s.required })),
      list: async () => statuses,
      revoke,
    });

    render(<panel.Panel value={null} onChange={() => undefined} />);

    expect(await screen.findByText('Built-in')).toBeTruthy();
    expect(await screen.findByText('Enabled')).toBeTruthy();
    // Only the optional site has a Disable button (built-in Facebook does not).
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(revoke).toHaveBeenCalledWith('instagram');
    const busyBtn = screen.getByRole('button', { name: 'Disabling…' }) as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);

    finishRevoke();
    expect(await screen.findByText('Not enabled')).toBeTruthy();
    expect(screen.getByText(/Open Instagram and click the Feed Sanity toolbar icon/)).toBeTruthy();
  });

  it('renders userscript guidance cleanly and tolerates list/revoke failures', async () => {
    const userscriptPanel = sitesPanel({
      managedByExtension: false,
      initial: () => [
        {
          id: 'instagram',
          displayName: 'Instagram',
          description: 'Instagram features.',
          required: false,
          enabled: true,
        },
      ],
      list: () => Promise.reject(new Error('offline')),
      revoke: () => Promise.reject(new Error('offline')),
    });

    render(<userscriptPanel.Panel value={null} onChange={() => undefined} />);
    expect(screen.getByText(/managed by your userscript manager/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });
});
