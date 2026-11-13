import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Options } from '../../core/options';
import { extensionStore } from '../../platform/extension-store';
import { HOST_TAG } from '../mount';
import { openOptionsDialog } from '.';
import { OptionsDialog } from './options-dialog';

const specs = {
  hide_ads: {
    section: 'General',
    title: 'Hide ads',
    description: 'Hide sponsored posts.',
    default: false,
  },
  pause_after: {
    section: 'General',
    title: 'Pause after',
    description: 'Posts to load before pausing.',
    default: 10,
  },
  css_url: {
    section: 'Advanced',
    title: 'External CSS url',
    description: 'A style sheet to add.',
    default: '',
  },
  keywords: {
    section: 'Advanced',
    title: 'Keywords',
    description: 'One on each line.',
    default: '',
    multiline: true,
  },
};

/** The form control labelled `name`. */
const field = (role: string, name: string) => screen.getByRole<HTMLInputElement>(role, { name });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });

afterEach(cleanup);

async function loadedOptions(): Promise<Options> {
  const options = new Options(extensionStore, 'u/options');
  options.register(specs);
  await options.load();
  return options;
}

describe('OptionsDialog', () => {
  let options: Options;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    fakeBrowser.reset();
    await browser.storage.local.set({ 'u/options': { pause_after: 25 } });
    options = await loadedOptions();
    onClose = vi.fn();
  });

  const show = () => render(<OptionsDialog options={options} onClose={onClose} />);

  it('lists the first section with saved values, and another section when chosen', async () => {
    show();

    expect(field('checkbox', 'Hide ads').checked).toBe(false);
    expect(field('spinbutton', 'Pause after').value).toBe('25');
    expect(screen.queryByRole('textbox', { name: 'External CSS url' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));

    expect(field('textbox', 'External CSS url').value).toBe('');
    expect(screen.queryByRole('checkbox', { name: 'Hide ads' })).toBeNull();
  });

  it('saves the changes and closes', async () => {
    show();
    expect(button('Save').disabled).toBe(true);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide ads' }));
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Pause after' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Pause after' }), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(options.get('hide_ads')).toBe(true);
    expect(options.get('pause_after')).toBe(40);
    expect(await browser.storage.local.get('u/options')).toEqual({
      'u/options': { hide_ads: true, pause_after: 40 },
    });
  });

  it('takes several lines for an option that holds a list', async () => {
    show();
    await userEvent.click(button('Advanced'));
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Keywords' });
    expect(box.tagName).toBe('TEXTAREA');

    await userEvent.type(box, 'one{Enter}two');
    await userEvent.click(button('Save'));

    expect(options.get('keywords')).toBe('one\ntwo');
  });

  it('drops the changes on Cancel', async () => {
    show();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide ads' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(options.get('hide_ads')).toBe(false);
  });

  it('closes without saving on Escape', async () => {
    show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide ads' }));

    // happy-dom does not turn Escape into a cancel event, as browsers do.
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(options.get('hide_ads')).toBe(false);
  });

  it('finds options in every section by title or description', async () => {
    show();

    await userEvent.type(screen.getByRole('searchbox'), 'style sheet');

    expect(field('textbox', 'External CSS url').isConnected).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Hide ads' })).toBeNull();

    await userEvent.type(screen.getByRole('searchbox'), ' nothing like this');

    expect(screen.getByText('No options match.').isConnected).toBe(true);
  });

  it('will not save a number field that does not hold a number', async () => {
    show();
    const input = field('spinbutton', 'Pause after');

    await userEvent.clear(input);

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(button('Save').disabled).toBe(true);

    // Still named from another section, where the field is not shown.
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByText(/Not a number.*Pause after/).isConnected).toBe(true);
  });

  it('shows a value saved in another tab', async () => {
    show();

    await act(() => browser.storage.local.set({ 'u/options': { hide_ads: true } }));

    expect(field('checkbox', 'Hide ads').checked).toBe(true);
  });
});

describe('openOptionsDialog', () => {
  it('opens one dialog in its own shadow root and removes it on close', async () => {
    fakeBrowser.reset();
    const options = await loadedOptions();

    act(() => openOptionsDialog(options));
    act(() => openOptionsDialog(options));

    const hosts = document.querySelectorAll(HOST_TAG);
    expect(hosts).toHaveLength(1);
    const close = hosts[0]?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[aria-label=Close]',
    );
    expect(close).toBeTruthy();

    await act(async () => close?.click());

    expect(document.querySelector(HOST_TAG)).toBeNull();
  });

  it('keeps a reopened dialog open when a save from the first one finishes late', async () => {
    fakeBrowser.reset();
    const options = await loadedOptions();
    const write = Promise.withResolvers<void>();
    vi.spyOn(browser.storage.local, 'set').mockImplementation(() => write.promise);
    const click = (selector: string) =>
      act(async () => {
        document.querySelector(HOST_TAG)?.shadowRoot?.querySelector<HTMLElement>(selector)?.click();
      });

    act(() => openOptionsDialog(options));
    await click('input[type=checkbox]');
    await click('button.primary');
    await click('button[aria-label=Close]');
    act(() => openOptionsDialog(options));
    await act(async () => write.resolve());

    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    await click('button[aria-label=Close]');
  });
});
