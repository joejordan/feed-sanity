import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { Diagnostics } from './collect';
import { readLocatorOverrides } from '../core/locator';
import { Options } from '../core/options';
import { SavedData } from '../core/saved';
import { LOCATOR_OVERRIDES } from '../facebook/feature';
import { extensionStore } from '../platform/extension-store';
import { OptionsDialog } from '../ui/options-dialog/options-dialog';
import { DiagnosticsPanel, diagnosticsPanel, REFRESH_MS } from './diagnostics-panel';
import { checkOverrides } from './overrides';
import { diagnostics, locator, strategy } from './testing';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const editor = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Your selectors' });

/** Renders the panel the way the dialog does, keeping the edited text. */
function renderPanel(collect: () => Diagnostics, initial = '{}') {
  let current = initial;
  function Host() {
    const [text, setText] = useState(initial);
    current = text;
    return (
      <DiagnosticsPanel
        value={text}
        onChange={setText}
        collect={collect}
        check={(typed) => checkOverrides(typed, ['post', 'post-reactions'])}
      />
    );
  }
  render(<Host />);
  return () => current;
}

describe('DiagnosticsPanel', () => {
  it('shows the build, the page, the features and the posts', () => {
    renderPanel(() => diagnostics());

    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('Chrome extension')).toBeTruthy();
    expect(screen.getByText('newsfeed')).toBeTruthy();
    expect(screen.getByText('102 of 109 known')).toBeTruthy();
    const row = screen.getByRole('row', { name: /post_filters/ });
    expect(within(row).getByText('running')).toBeTruthy();
    expect(
      screen.getByText(
        '16 posts on the page: 13 with an ID, 2 without one, 1 still being identified.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Feed slots with content not taken for posts: 0.')).toBeTruthy();
  });

  it('makes a failed feature stand out, with its last error', () => {
    renderPanel(() =>
      diagnostics({
        features: [{ id: 'post_filters', state: 'failed', errors: 10, lastError: 'no element' }],
      }),
    );

    const row = screen.getByRole('row', { name: /post_filters/ });
    expect(row.className).toContain('diag-failed');
    expect(within(row).getByText('failed')).toBeTruthy();
    expect(within(row).getByText('no element')).toBeTruthy();
  });

  it('says that post detection has not started in place of zeros', () => {
    renderPanel(() =>
      diagnostics({
        posts: {
          started: false,
          tracked: 0,
          withId: 0,
          withoutId: 0,
          identifying: 0,
          unrecognised: 0,
        },
      }),
    );

    expect(screen.getByText(/^Post detection has not started/)).toBeTruthy();
    expect(screen.queryByText(/posts on the page/)).toBeNull();
  });

  it('points out locators that never found anything and those the user overrode', async () => {
    const user = userEvent.setup();
    renderPanel(() =>
      diagnostics({
        locators: [
          locator('post', { overridden: true, strategies: [strategy({ seen: null })] }),
          locator('comment'),
          locator('post-reactions', { found: 0, strategies: [strategy({ found: 0 })] }),
        ],
      }),
    );

    expect(
      screen.getByText(/never found anything: post-reactions\.$/, { selector: 'p' }),
    ).toBeTruthy();
    expect(screen.getByText('Your selectors stand in for: post.')).toBeTruthy();
    expect(screen.getByText('your selectors')).toBeTruthy();
    expect(screen.getByText('never found')).toBeTruthy();
    expect(screen.getByText('yours')).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: /comment/ })).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: /Only show locators/ }));

    expect(screen.queryByRole('rowheader', { name: /comment/ })).toBeNull();
    expect(screen.getByRole('rowheader', { name: /post-reactions/ })).toBeTruthy();
  });

  it('reads the numbers again while it is shown, and stops once it is not', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const collect = vi.fn(() => diagnostics());
    renderPanel(collect);
    expect(collect).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(REFRESH_MS * 2);
    });
    expect(collect).toHaveBeenCalledTimes(3);

    // Preact runs the cleanups of an unmounted component after the next paint, which `act` brings forward.
    act(() => {
      cleanup();
    });
    vi.advanceTimersByTime(REFRESH_MS * 2);
    expect(collect).toHaveBeenCalledTimes(3);
  });

  it('copies a report that holds nothing personal', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel(() =>
      diagnostics({
        pageType: 'jane.doe',
        features: [
          {
            id: 'post_filters',
            state: 'running',
            errors: 1,
            lastError: 'no ID in https://www.facebook.com/jane.doe/posts/1234567890',
          },
        ],
      }),
    );

    fireEvent.click(button('Copy report'));

    await screen.findByText('The report is copied.');
    const report = writeText.mock.calls[0]?.[0] ?? '';
    expect(report).toContain('Version 1.2.3, Chrome extension');
    expect(report).toContain('Page type: other');
    expect(report).toContain('post_filters: running, 1 error. Last error: no ID in <address>');
    expect(report).not.toMatch(/jane|facebook\.com|1234567890/);
  });

  it('shows the report to copy by hand when the clipboard refuses it', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('not allowed')));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel(() => diagnostics());

    fireEvent.click(button('Copy report'));

    await screen.findByText(/could not be copied/);
    const report = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Report' });
    expect(report.value).toContain('Version 1.2.3');
  });

  it('checks the selectors as they are typed', () => {
    const text = renderPanel(() => diagnostics());

    fireEvent.change(editor(), { target: { value: '{ "post": [' } });
    expect(screen.getByText(/^This is not valid JSON\./)).toBeTruthy();
    expect(editor().getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(editor(), { target: { value: '{ "pots": ["div"] }' } });
    expect(
      screen.getByText('"pots" is not a locator. The names are in the Locators table.'),
    ).toBeTruthy();

    fireEvent.change(editor(), { target: { value: '{ "post": ["div:not("] }' } });
    expect(screen.getByText('"div:not(" for "post" is not a valid selector.')).toBeTruthy();

    fireEvent.change(editor(), { target: { value: '{ "post": ["[role=article]"] }' } });
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(editor().getAttribute('aria-invalid')).toBeNull();
    expect(text()).toBe('{ "post": ["[role=article]"] }');
  });
});

describe('diagnosticsPanel in the options dialog', () => {
  let data: SavedData;
  let options: Options;

  beforeEach(async () => {
    fakeBrowser.reset();
    data = new SavedData(extensionStore, 'u');
    options = new Options(extensionStore, 'u/options');
    await options.load();
  });

  const overrides = () => data.value(LOCATOR_OVERRIDES, readLocatorOverrides);

  /** Saves overrides once the stored value has been read, as the page does. */
  async function saveOverrides(value: Record<string, string[]>) {
    await overrides().ready;
    await overrides().set(value);
  }

  async function openDialog() {
    const panel = diagnosticsPanel({
      collect: () => diagnostics(),
      overrides: overrides(),
      locatorNames: () => ['post', 'post-reactions'],
    });
    await panel.ready;
    const onClose = vi.fn<() => void>();
    render(<OptionsDialog options={options} panels={[panel]} onClose={onClose} />);
    return onClose;
  }

  it('saves the selectors with the dialog', async () => {
    const onClose = await openDialog();

    fireEvent.change(editor(), { target: { value: '{ "post": ["[role=article]"] }' } });
    fireEvent.click(button('Save'));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(overrides().get()).toEqual({ post: ['[role=article]'] });
  });

  it('will not save selectors with a mistake, and drops them on Cancel', async () => {
    await saveOverrides({ post: ['div'] });
    await openDialog();

    fireEvent.change(editor(), { target: { value: '{ "post": ["[x"] }' } });

    expect(screen.getByText(/Your selectors in Diagnostics have a mistake/)).toBeTruthy();
    expect(button('Save').disabled).toBe(true);
    fireEvent.click(button('Cancel'));
    expect(overrides().get()).toEqual({ post: ['div'] });
  });

  it('puts the built-in selectors back', async () => {
    await saveOverrides({ post: ['div'] });
    const onClose = await openDialog();
    expect(editor().value).toBe('{\n  "post": [\n    "div"\n  ]\n}');

    fireEvent.click(button('Use the built-in selectors'));
    expect(editor().value).toBe('{}');
    fireEvent.click(button('Save'));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(overrides().get()).toEqual({});
  });
});
