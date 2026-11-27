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
import { definePanel } from './panel';
import { orderSections } from './sections';

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
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });

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

  it('renders a clickable Feed Sanity brand lockup and feed-sanity.com link at the floor of the sidebar when opened on a host site', () => {
    const { container } = render(
      <OptionsDialog
        options={options}
        site={{ id: 'facebook', displayName: 'Facebook' }}
        siteEnabled={true}
        onClose={onClose}
      />,
    );

    const floorBrand = container.querySelector<HTMLAnchorElement>('.sidebar > a.sidebar-brand');
    expect(floorBrand?.getAttribute('href')).toBe('https://feed-sanity.com');
    expect(floorBrand?.getAttribute('target')).toBe('_blank');
    expect(floorBrand?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(floorBrand?.querySelector('svg.fs-brand-mark')).not.toBeNull();
    expect(floorBrand?.querySelector('svg.fs-brand-wordmark')).not.toBeNull();
    expect(floorBrand?.querySelector('.sidebar-brand-url')?.textContent).toBe('feed-sanity.com');
  });

  it('lists the first section with saved values, and another section when chosen', async () => {
    const { container } = show();

    const headerWordmark = container.querySelector('h2.site-title svg.fs-brand-wordmark');
    expect(headerWordmark?.getAttribute('role')).toBe('img');
    expect(headerWordmark?.getAttribute('aria-label')).toBe('Feed Sanity');

    expect(field('checkbox', 'Hide ads').checked).toBe(false);
    expect(field('spinbutton', 'Pause after').value).toBe('25');
    expect(screen.queryByRole('textbox', { name: 'External CSS url' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));

    expect(field('textbox', 'External CSS url').value).toBe('');
    expect(screen.queryByRole('checkbox', { name: 'Hide ads' })).toBeNull();
  });

  it('saves boolean toggles silently without toast clutter, and commits number drafts with Undo on Enter', async () => {
    show();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide ads' }));
    await vi.waitFor(() => expect(options.get('hide_ads')).toBe(true));
    expect(screen.queryByRole('status')).toBeNull();

    // Edit numeric field + press Enter -> shows Undo toast and supports reverting.
    const spin = screen.getByRole('spinbutton', { name: 'Pause after' });
    await userEvent.clear(spin);
    await userEvent.type(spin, '40{Enter}');

    await vi.waitFor(() => expect(options.get('pause_after')).toBe(40));
    expect(screen.getByRole('status').textContent).toContain('Pause after saved');
    await userEvent.click(button('Undo'));
    await vi.waitFor(() => expect(options.get('pause_after')).toBe(25));

    await userEvent.clear(spin);
    await userEvent.type(spin, '40{Enter}');
    await vi.waitFor(() => expect(options.get('pause_after')).toBe(40));
    expect(await browser.storage.local.get('u/options')).toEqual({
      'u/options': { hide_ads: true, pause_after: 40 },
    });
  });

  it('takes several lines for an option that holds a list, supports Reset without saving, and saves via Apply', async () => {
    show();
    await userEvent.click(button('Advanced'));
    const box = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Keywords' });
    expect(box.tagName).toBe('TEXTAREA');

    await userEvent.type(box, 'discard me');
    await userEvent.click(button('Reset'));
    expect(box.value).toBe('');
    expect(options.get('keywords')).toBe('');

    await userEvent.type(box, 'one{Enter}two');
    await userEvent.click(button('Apply'));

    await vi.waitFor(() => expect(options.get('keywords')).toBe('one\ntwo'));
  });

  /** Shows the dialog with one option that has choices. */
  async function showChoices(): Promise<Options> {
    const choosing = new Options(extensionStore, 'c/options');
    choosing.register({
      feed: {
        section: 'Feeds',
        title: 'Home feed',
        description: 'The feed Home shows.',
        default: 'home',
        choices: [
          { value: 'home', label: "Facebook's own" },
          { value: 'friends', label: 'Friends' },
        ],
      },
    });
    await choosing.load();
    render(<OptionsDialog options={choosing} onClose={onClose} />);
    return choosing;
  }

  it('offers the choices of an option that has them, and saves the one picked immediately', async () => {
    const choosing = await showChoices();
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Home feed' });
    expect(select.value).toBe('home');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      "Facebook's own",
      'Friends',
    ]);

    await userEvent.selectOptions(select, 'friends');

    await vi.waitFor(() => expect(choosing.get('feed')).toBe('friends'));
  });

  it('shows a choice saved elsewhere while the dialog is open', async () => {
    const choosing = await showChoices();

    await act(() => choosing.set('feed', 'friends'));

    expect(field('combobox', 'Home feed').value).toBe('friends');
  });

  it('closes on Escape and Close button', async () => {
    show();

    // happy-dom does not turn Escape into a cancel event, as browsers do.
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('finds options and panels in every section via unified Command Jump search', async () => {
    const panel = definePanel<null>({
      section: 'Backup & Reset',
      ready: Promise.resolve(),
      read: () => null,
      save: () => Promise.resolve(),
      searchItems: () => [
        {
          id: 'export-json',
          title: 'Export settings backup',
          description: 'Download JSON',
          keywords: ['json', 'backup'],
        },
      ],
      Panel: () => <p>Backup body</p>,
    });
    render(<OptionsDialog options={options} panels={[panel]} onClose={onClose} />);

    await userEvent.click(button('Search options'));
    const search = screen.getByRole('combobox', { name: 'Jump to setting' });
    expect(search.getAttribute('aria-controls')).toBeTruthy();
    await userEvent.type(search, 'style sheet');

    expect(screen.getByText('External CSS url')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: /External CSS url/ }));

    expect(field('textbox', 'External CSS url').isConnected).toBe(true);
    expect(screen.queryByRole('checkbox', { name: 'Hide ads' })).toBeNull();

    // Also searches custom panel items and jumps straight to that section.
    await userEvent.click(button('Search options'));
    await userEvent.type(screen.getByRole('combobox', { name: 'Jump to setting' }), 'backup');
    await userEvent.click(screen.getByRole('option', { name: /Export settings backup/ }));
    expect(screen.getByText('Backup body')).toBeTruthy();

    // Empty state for unmatched queries.
    await userEvent.click(button('Search options'));
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Jump to setting' }),
      'nothing matches this',
    );
    expect(screen.getByText('No options match.')).toBeTruthy();
  });

  it('groups advanced options under collapsible disclosures and supports site pause switch', async () => {
    const grouped = new Options(extensionStore, 'g/options');
    grouped.register({
      master: {
        section: 'Filtering',
        group: 'Quick Shields',
        title: 'Post filtering',
        description: 'Master toggle',
        default: true,
      },
      extra: {
        section: 'Filtering',
        group: 'Quick Shields',
        advanced: true,
        dependsOn: 'master',
        title: 'Advanced matcher',
        description: 'Hidden behind disclosure until expanded',
        default: false,
      },
      keywords: {
        section: 'Filtering',
        group: 'Bulk Keyword Blocklist',
        advanced: true,
        title: 'Hide posts matching keywords',
        description: 'One keyword per line',
        default: '',
        multiline: true,
      },
    });
    await grouped.load();
    const onToggleSite = vi.fn();
    render(
      <OptionsDialog
        options={grouped}
        site={{ id: 'x', displayName: 'X (Twitter)' }}
        siteEnabled={true}
        onToggleSite={onToggleSite}
        onClose={onClose}
      />,
    );

    expect(screen.queryByRole('checkbox', { name: 'Advanced matcher' })).toBeNull();
    // Standalone advanced disclosures (like Bulk Keyword Blocklist) must not show a misleading option count badge.
    const bulkDisclosure = button(/Bulk Keyword Blocklist/);
    expect(bulkDisclosure.textContent?.trim()).toBe('Bulk Keyword Blocklist');
    await userEvent.click(button(/More options/));
    expect(field('checkbox', 'Advanced matcher').checked).toBe(false);

    expect(screen.getByText('Active on this site')).toBeTruthy();
    await userEvent.click(field('checkbox', 'Enable Feed Sanity on X (Twitter)'));
    expect(onToggleSite).toHaveBeenCalledWith(false);
    expect(screen.getByText('Paused here')).toBeTruthy();
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

  it('drags smoothly from the header, sets data-dragging while moving, and recenters on double-click', () => {
    show();
    const dialogEl = screen.getByRole<HTMLDialogElement>('dialog');
    const header = dialogEl.querySelector<HTMLElement>('.pane-header');
    expect(header).toBeTruthy();

    vi.spyOn(dialogEl, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      top: 100,
      width: 600,
      height: 400,
      right: 800,
      bottom: 500,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(header as HTMLElement, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 250,
      clientY: 120,
    });
    expect(dialogEl.getAttribute('data-dragging')).toBeNull();

    fireEvent.pointerMove(document, { pointerId: 1, clientX: 330, clientY: 180 });
    expect(dialogEl.getAttribute('data-dragging')).toBe('true');
    expect(dialogEl.style.transform).toBe('translate3d(80px, 60px, 0)');

    fireEvent.pointerUp(document, { pointerId: 1, clientX: 330, clientY: 180 });
    expect(dialogEl.getAttribute('data-dragging')).toBeNull();
    expect(dialogEl.getAttribute('data-moved')).toBe('true');

    fireEvent.doubleClick(header as HTMLElement);
    expect(dialogEl.getAttribute('data-moved')).toBeNull();
    expect(dialogEl.style.transform).toBe('');
  });
});

describe('openOptionsDialog', () => {
  it('opens one dialog in its own shadow root, jumps sections if reopened with initialSection, and removes it on close', async () => {
    fakeBrowser.reset();
    const options = await loadedOptions();

    await act(() => openOptionsDialog(options));
    await act(() => openOptionsDialog(options, [], { initialSection: 'Advanced' }));

    const hosts = document.querySelectorAll(HOST_TAG);
    expect(hosts).toHaveLength(1);
    const heading = hosts[0]?.shadowRoot?.querySelector('h3.pane-heading');
    expect(heading?.textContent).toBe('Advanced');
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

    await act(() => openOptionsDialog(options));
    await click('input[type=checkbox]');
    await click('button[aria-label=Close]');
    await act(() => openOptionsDialog(options));
    await act(async () => write.resolve());

    expect(document.querySelectorAll(HOST_TAG)).toHaveLength(1);
    await click('button[aria-label=Close]');
  });
});

describe('OptionsDialog panels', () => {
  /** A buffered (non-instant) panel holding a list of words, edited by adding one. */
  function wordsPanel(saved: string[], section: string) {
    const save = vi.fn<(value: string[]) => Promise<void>>(() => Promise.resolve());
    const panel = definePanel<string[]>({
      section,
      ready: Promise.resolve(),
      read: () => saved,
      save,
      Panel: ({ value, onChange }) => (
        <button type="button" onClick={() => onChange([...value, 'more'])}>
          Words: {value.join(' ')}
        </button>
      ),
    });
    return { panel, save };
  }

  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('shows a panel below the options of its section, and gives a section of its own a place', async () => {
    const user = userEvent.setup();
    const options = await loadedOptions();
    const panels = [wordsPanel(['a'], 'General').panel, wordsPanel(['z'], 'Words').panel];
    render(<OptionsDialog options={options} panels={panels} onClose={() => undefined} />);

    expect(button('Words: a')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Words: z' })).toBeNull();

    await user.click(button('Words'));

    expect(button('Words: z')).toBeTruthy();
    expect(screen.queryByText('Nothing to set here yet.')).toBeNull();
  });

  it('shows floating dirty bar and saves only the buffered panel the user edited', async () => {
    const user = userEvent.setup();
    const options = await loadedOptions();
    const edited = wordsPanel(['a'], 'General');
    const untouched = wordsPanel(['z'], 'Words');
    render(
      <OptionsDialog
        options={options}
        panels={[edited.panel, untouched.panel]}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    await user.click(button('Words: a'));
    expect(button('Words: a more')).toBeTruthy();
    await user.click(button('Save'));

    expect(edited.save).toHaveBeenCalledWith(['a', 'more']);
    expect(untouched.save).not.toHaveBeenCalled();
  });

  it('drops the edits of a buffered panel on Cancel', async () => {
    const user = userEvent.setup();
    const options = await loadedOptions();
    const { panel, save } = wordsPanel(['a'], 'General');
    render(<OptionsDialog options={options} panels={[panel]} onClose={() => undefined} />);

    await user.click(button('Words: a'));
    await user.click(button('Cancel'));

    expect(save).not.toHaveBeenCalled();
    expect(button('Words: a')).toBeTruthy();
  });

  it('does not save while a buffered panel says its value has a problem', async () => {
    const user = userEvent.setup();
    const options = await loadedOptions();
    const { panel } = wordsPanel(['a'], 'General');
    const checked = {
      ...panel,
      problem: (value: unknown) =>
        (value as string[]).length > 2 ? 'Too many words in the panel.' : null,
    };
    render(<OptionsDialog options={options} panels={[checked]} onClose={() => undefined} />);

    await user.click(button('Words: a'));
    expect(button('Save').disabled).toBe(false);
    await user.click(button('Words: a more'));

    expect(screen.getByText('Too many words in the panel.')).toBeTruthy();
    expect(button('Save').disabled).toBe(true);
  });

  it('pre-glides the sidebar active highlight immediately on pointerdown and reverts if cancelled', async () => {
    const options = await loadedOptions();
    render(<OptionsDialog options={options} onClose={() => undefined} />);
    const generalBtn = button('General');
    const advancedBtn = button('Advanced');
    expect(generalBtn.dataset.visualActive).toBe('true');
    expect(advancedBtn.dataset.visualActive).toBeUndefined();

    // Pressing down on another section moves visual focus immediately before click fires.
    fireEvent.pointerDown(advancedBtn, { button: 0 });
    expect(advancedBtn.dataset.visualActive).toBe('true');
    expect(generalBtn.dataset.visualActive).toBeUndefined();

    // Dragging off without clicking reverts cleanly to the active section.
    fireEvent.pointerLeave(advancedBtn);
    expect(generalBtn.dataset.visualActive).toBe('true');
    expect(advancedBtn.dataset.visualActive).toBeUndefined();

    // Completing the click switches sections and keeps visual active synced.
    await userEvent.click(advancedBtn);
    expect(advancedBtn.getAttribute('aria-current')).toBe('page');
    expect(advancedBtn.dataset.visualActive).toBe('true');
  });

  it('orders sidebar sections as Filtering, Appearance, Timeline & Clutter, Media', () => {
    expect(
      orderSections([
        'Media',
        'Diagnostics',
        'Timeline & Clutter',
        'Appearance',
        'Sites',
        'Filtering',
        'Data',
      ]),
    ).toEqual([
      'Filtering',
      'Appearance',
      'Timeline & Clutter',
      'Media',
      'Sites',
      'Data',
      'Diagnostics',
    ]);
  });

  it('shows a paused-site banner with a Resume button on site sections and hides it on global sections', async () => {
    const user = userEvent.setup();
    const options = await loadedOptions();
    const onToggleSite = vi.fn(() => Promise.resolve());
    const sitesStub = definePanel<null>({
      section: 'Sites',
      ready: Promise.resolve(),
      read: () => null,
      save: () => Promise.resolve(),
      Panel: () => <div>Sites panel</div>,
    });
    render(
      <OptionsDialog
        options={options}
        panels={[sitesStub]}
        site={{ id: 'x', displayName: 'X' }}
        siteEnabled={false}
        onToggleSite={onToggleSite}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText(/Feed Sanity is paused on X/i)).toBeTruthy();

    // Global (manage-group) sections hide the per-site paused banner.
    await user.click(button('Sites'));
    expect(screen.queryByText(/Feed Sanity is paused on X/i)).toBeNull();

    // Returning to a site section shows the banner again, and Resume dismisses it.
    await user.click(button('General'));
    expect(screen.getByText(/Feed Sanity is paused on X/i)).toBeTruthy();
    await user.click(button('Resume'));
    expect(onToggleSite).toHaveBeenCalledWith(true);
    expect(screen.queryByText(/Feed Sanity is paused on X/i)).toBeNull();
  });

  it('disables transitive dependent rows with root Requires hints and updates live on external storage changes', async () => {
    const user = userEvent.setup();
    const options = new Options(extensionStore, 'u/options');
    options.register({
      root_opt: {
        section: 'General',
        title: 'Root toggle',
        description: 'Top-level switch.',
        default: false,
      },
      mid_opt: {
        section: 'General',
        title: 'Middle toggle',
        description: 'Depends on root.',
        dependsOn: 'root_opt',
        default: true,
      },
      leaf_opt: {
        section: 'General',
        title: 'Leaf toggle',
        description: 'Depends on middle.',
        dependsOn: 'mid_opt',
        default: true,
      },
    });
    await options.load();
    render(<OptionsDialog options={options} onClose={() => undefined} />);

    const root = field('checkbox', 'Root toggle');
    const mid = field('checkbox', 'Middle toggle');
    const leaf = field('checkbox', 'Leaf toggle');

    // When root is off, both middle and transitive leaf are disabled with root's Requires hint.
    expect(mid.disabled).toBe(true);
    expect(leaf.disabled).toBe(true);
    expect(screen.getAllByText('Requires Root toggle')).toHaveLength(2);

    // Turning root on via external storage change reactively enables both middle and leaf.
    await act(async () => {
      await browser.storage.local.set({
        'u/options': { root_opt: true, mid_opt: true, leaf_opt: true },
      });
    });
    expect(root.checked).toBe(true);
    expect(mid.disabled).toBe(false);
    expect(leaf.disabled).toBe(false);
    expect(screen.queryByText(/Requires/)).toBeNull();

    // Turning middle off disables only leaf with middle's Requires hint.
    await user.click(mid);
    expect(leaf.disabled).toBe(true);
    expect(screen.getByText('Requires Middle toggle')).toBeTruthy();
  });

  it('reverts dirty inline text edits on Escape without closing the Options dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opts = new Options(extensionStore, 'u/options');
    opts.register({
      custom_stylesheet_url: {
        section: 'Appearance',
        title: 'External CSS url',
        description: 'Optional stylesheet URL.',
        default: '',
      },
    });
    await opts.load();
    render(<OptionsDialog options={opts} onClose={onClose} />);

    const input = field('textbox', 'External CSS url');
    await user.type(input, 'https://example.com/draft.css');
    expect(input.value).toBe('https://example.com/draft.css');

    await user.keyboard('{Escape}');
    expect(input.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });
});
