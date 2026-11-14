import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Atoms } from './atoms';

function addStyles(css: string): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}

/** Makes the page's only stylesheet one whose rules it may not read, as with another origin's. */
function blockStyleSheet(href: string): void {
  const blocked = {
    href,
    get cssRules(): CSSRuleList {
      throw new DOMException('blocked', 'SecurityError');
    },
  };
  vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([blocked] as unknown as StyleSheetList);
}

function addElements(className: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const element = document.createElement('div');
    element.className = className;
    document.body.append(element);
  }
}

describe('atoms', () => {
  let atoms: Atoms;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    atoms = new Atoms(() => Promise.reject(new Error('no downloads in this test')));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('translates a name to the class whose rule has that declaration', async () => {
    addStyles('.xflex001 { display: flex; } .xrel0002{position:relative}');
    await atoms.scan();

    expect(atoms.translate('div.S2F_disp_flex:not(.S2F_pos_rel)')).toBe(
      'div.xflex001:not(.xrel0002)',
    );
  });

  it('leaves a name alone until its class is known', async () => {
    addStyles('.xflex001 { display: flex; }');
    await atoms.scan();

    expect(atoms.translate('.S2F_disp_flex.S2F_pos_abs')).toBe('.xflex001.S2F_pos_abs');
    expect(atoms.translate('.S2F_not_a_name')).toBe('.S2F_not_a_name');
  });

  it('resolves a selector only once every name in it has a class', async () => {
    addStyles('.xflex001 { display: flex; }');
    await atoms.scan();

    expect(atoms.resolve('div.S2F_disp_flex:not(.S2F_pos_rel)')).toBeNull();
    expect(atoms.resolve('.S2F_disp_flex > a')).toBe('.xflex001 > a');
    expect(atoms.resolve('[role=article]')).toBe('[role=article]');

    addStyles('.xrel0002 { position: relative; }');
    await atoms.scan();

    expect(atoms.resolve('div.S2F_disp_flex:not(.S2F_pos_rel)')).toBe(
      'div.xflex001:not(.xrel0002)',
    );
  });

  it('ignores rules with more than one declaration or a longer selector', async () => {
    addStyles(`
      .xmany001 { display: flex; color: red; }
      div .xdeep001 { display: flex; }
      .xfine001:hover { display: flex; }
    `);
    await atoms.scan();

    expect(atoms.translate('S2F_disp_flex')).toBe('S2F_disp_flex');
  });

  it('tells a plain rule from the same declaration behind a pseudo-class', async () => {
    addStyles('.xnone001 { display: none; } .xempty01:empty { display: none; }');
    await atoms.scan();

    expect(atoms.translate('S2F_disp_none S2F_empty_none')).toBe('xnone001 xempty01');
  });

  it('finds a class that follows another class in the selector', async () => {
    addStyles('.xfirst01:not([disabled]) .xsecond1 { z-index: unset; }');
    await atoms.scan();

    expect(atoms.translate('S2F_en_nozi')).toBe('xsecond1');
  });

  it('finds a doubled class inside its media rule only', async () => {
    addStyles(`
      .xplain01.xplain01 { max-width: none; }
      @media (max-width: 1920px) { .xwide001.xwide001 { max-width: none; } }
    `);
    await atoms.scan();

    expect(atoms.translate('S2F_fhd_wide')).toBe('xwide001');
  });

  it('keeps the class used more on the page when two fit one rule', async () => {
    addStyles('.xrare001 { display: flex; } .xcommon1 { display: flex; }');
    addElements('xrare001', 1);
    addElements('xcommon1', 5);
    await atoms.scan();
    expect(atoms.translate('S2F_disp_flex')).toBe('xcommon1');

    await atoms.scan();
    expect(atoms.translate('S2F_disp_flex')).toBe('xcommon1');
  });

  it('downloads a stylesheet the page may not read, once', async () => {
    blockStyleSheet('https://static.example/blocked.css');
    const loadText = vi.fn(() => Promise.resolve('.xflex001 { display: flex; }'));
    atoms = new Atoms(loadText);

    await atoms.scan();
    await atoms.scan();

    expect(loadText).toHaveBeenCalledExactlyOnceWith('https://static.example/blocked.css');
    expect(atoms.translate('S2F_disp_flex')).toBe('xflex001');
  });

  it('carries on when a download fails', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    blockStyleSheet('https://static.example/blocked.css');

    await expect(atoms.scan()).resolves.toBeUndefined();
  });

  it('tells listeners only when a scan changes a class', async () => {
    const listener = vi.fn();
    const stop = atoms.onChange(listener);

    addStyles('.xflex001 { display: flex; }');
    await atoms.scan();
    await atoms.scan();
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    addStyles('.xrel0002 { position: relative; }');
    await atoms.scan();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('scans again after a pause while few classes are known', async () => {
    vi.useFakeTimers();
    const started = atoms.start();
    expect(atoms.start()).toBe(started);
    await started;

    addStyles('.xflex001 { display: flex; }');
    await vi.advanceTimersByTimeAsync(400);
    expect(atoms.translate('S2F_disp_flex')).toBe('S2F_disp_flex');

    await vi.advanceTimersByTimeAsync(100);
    expect(atoms.translate('S2F_disp_flex')).toBe('xflex001');
  });

  it('gives up rescanning after the last pause', async () => {
    vi.useFakeTimers();
    await atoms.start();

    // Never settled, so the pauses run out: 0.5 + 1 + 2 + 4 + 8 seconds.
    await vi.advanceTimersByTimeAsync(15_500);
    addStyles('.xflex001 { display: flex; }');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(atoms.translate('S2F_disp_flex')).toBe('S2F_disp_flex');
  });

  it('scans again after a move to another page', async () => {
    vi.useFakeTimers();
    await atoms.start();
    await vi.advanceTimersByTimeAsync(15_500);

    addStyles('.xflex001 { display: flex; }');
    history.pushState({}, '', '/marketplace/');
    dispatchEvent(new Event('popstate'));
    await vi.advanceTimersByTimeAsync(0);

    expect(atoms.translate('S2F_disp_flex')).toBe('xflex001');
    history.replaceState({}, '', '/');
  });
});
