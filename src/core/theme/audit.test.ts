import { afterEach, describe, expect, it } from 'vitest';
import { findThemePreset } from '../theming';
import { auditThemeCoverage, captureLayoutSnapshot } from './audit';

const warmPaper = findThemePreset('warm-paper')!.palette;

describe('core/theme/audit', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.style.backgroundColor = '';
  });

  it('detects contrast failures, polarity leaks, unexpected layout shifts, and sticky header occlusion', () => {
    document.body.style.backgroundColor = warmPaper.background;
    document.body.innerHTML = `
      <header id="post-header" style="position: sticky; top: 0; background-color: rgba(0, 0, 0, 0);">
        <h1>Post</h1>
      </header>
      <article id="actual-post" style="background-color: rgb(253, 250, 244);">
        <p id="post-body" style="color: rgb(231, 233, 234);">Top of the actual post</p>
      </article>
      <aside id="unthemed-card" style="background-color: rgb(22, 24, 28); color: rgb(231, 233, 234);">
        <span>Dark card</span>
      </aside>
    `;

    const header = document.querySelector('#post-header') as HTMLElement;
    const h1 = header.querySelector('h1') as HTMLElement;
    const article = document.querySelector('#actual-post') as HTMLElement;
    const postBody = document.querySelector('#post-body') as HTMLElement;
    const unthemedCard = document.querySelector('#unthemed-card') as HTMLElement;
    const cardSpan = unthemedCard.querySelector('span') as HTMLElement;

    // Pre-theme layout: header is 53px tall, post starts cleanly at y=53 (no overlap).
    header.getBoundingClientRect = () => new DOMRect(0, 0, 600, 53);
    h1.getBoundingClientRect = () => new DOMRect(16, 12, 100, 24);
    article.getBoundingClientRect = () => new DOMRect(0, 53, 600, 120);
    postBody.getBoundingClientRect = () => new DOMRect(16, 60, 400, 24);
    unthemedCard.getBoundingClientRect = () => new DOMRect(620, 0, 300, 200);
    cardSpan.getBoundingClientRect = () => new DOMRect(636, 16, 100, 20);

    const beforeSnapshot = captureLayoutSnapshot(document);

    // Simulate a broken theme rule that resizes #post-header from 53px -> 90px AND paints it opaque,
    // covering the top of #post-body (y=60..84)!
    header.style.backgroundColor = 'rgba(244, 239, 230, 0.88)';
    header.getBoundingClientRect = () => new DOMRect(0, 0, 600, 90);

    const report = auditThemeCoverage(document, warmPaper, { beforeSnapshot });

    expect(report.summary.contrast).toBeGreaterThanOrEqual(1);
    expect(report.summary.polarityLeak).toBeGreaterThanOrEqual(1);
    expect(report.summary.layoutShift).toBeGreaterThanOrEqual(1);
    expect(report.summary.headerOcclusion).toBeGreaterThanOrEqual(1);
    expect(
      report.violations.some(
        (v) => v.kind === 'layout-shift' && v.selector === 'header#post-header',
      ),
    ).toBe(true);
    expect(
      report.violations.some(
        (v) => v.kind === 'header-occlusion' && v.selector === 'header#post-header',
      ),
    ).toBe(true);
    expect(report.score).toBeLessThan(100);
  });

  it('reports 100% score with zero violations when contrast, polarity, and layout are clean', () => {
    document.body.style.backgroundColor = warmPaper.background;
    document.body.innerHTML = `
      <header id="post-header" style="position: sticky; top: 0; background-color: rgba(244, 239, 230, 0.88); color: rgb(43, 36, 28);">
        <h1 style="color: rgb(43, 36, 28);">Post</h1>
      </header>
      <article id="actual-post" style="background-color: rgb(253, 250, 244);">
        <p id="post-body" style="color: rgb(43, 36, 28);">Readable post text</p>
      </article>
    `;
    const header = document.querySelector('#post-header') as HTMLElement;
    const h1 = header.querySelector('h1') as HTMLElement;
    const article = document.querySelector('#actual-post') as HTMLElement;
    const postBody = document.querySelector('#post-body') as HTMLElement;

    header.getBoundingClientRect = () => new DOMRect(0, 0, 600, 53);
    h1.getBoundingClientRect = () => new DOMRect(16, 12, 100, 24);
    article.getBoundingClientRect = () => new DOMRect(0, 53, 600, 120);
    postBody.getBoundingClientRect = () => new DOMRect(16, 65, 400, 24);

    const beforeSnapshot = captureLayoutSnapshot(document);
    const report = auditThemeCoverage(document, warmPaper, { beforeSnapshot });
    expect(report.violations).toEqual([]);
    expect(report.score).toBe(100);
  });

  it('skips SVG subtrees and scrubs PII-bearing data-testid and id tokens from violation selectors', () => {
    document.body.style.backgroundColor = warmPaper.background;
    document.body.innerHTML = `
      <div data-testid="UserAvatar-Container-alice" id="1000123456-follow" style="background-color: rgb(22, 24, 28);">
        <span style="color: rgb(231, 233, 234);">Avatar</span>
      </div>
      <svg id="icon-svg"><text>Hidden SVG label</text></svg>
    `;
    const box = document.querySelector('div') as HTMLElement;
    const span = box.querySelector('span') as HTMLElement;
    const svg = document.querySelector('svg') as unknown as HTMLElement;
    box.getBoundingClientRect = () => new DOMRect(0, 0, 120, 40);
    span.getBoundingClientRect = () => new DOMRect(4, 4, 50, 20);
    svg.getBoundingClientRect = () => new DOMRect(0, 60, 24, 24);

    const report = auditThemeCoverage(document, warmPaper);
    expect(report.violations.length).toBeGreaterThanOrEqual(1);
    for (const v of report.violations) {
      expect(v.selector).not.toContain('alice');
      expect(v.selector).not.toContain('1000123456');
      expect(v.selector).not.toContain('svg');
    }
  });
});
