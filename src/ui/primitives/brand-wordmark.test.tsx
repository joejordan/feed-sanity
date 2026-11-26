import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandWordmark } from './brand-wordmark';

afterEach(cleanup);

describe('BrandWordmark', () => {
  it('renders the outlined Stillwater wordmark with proportional dimensions, moon tittle, and zero <text>', () => {
    const { container } = render(
      <div>
        <BrandWordmark height={16} />
        <BrandWordmark height={15} label="Feed Sanity" />
      </div>,
    );

    const svgs = container.querySelectorAll('svg.fs-brand-wordmark');
    expect(svgs).toHaveLength(2);

    const decorative = svgs[0]!;
    const labeled = svgs[1]!;

    expect(decorative.getAttribute('height')).toBe('16');
    expect(Number(decorative.getAttribute('width'))).toBeCloseTo((16 * 541.05) / 98, 1);
    expect(decorative.getAttribute('aria-hidden')).toBe('true');
    expect(decorative.getAttribute('role')).toBeNull();
    expect(decorative.querySelector('title')).toBeNull();

    expect(labeled.getAttribute('height')).toBe('15');
    expect(labeled.getAttribute('role')).toBe('img');
    expect(labeled.getAttribute('aria-label')).toBe('Feed Sanity');
    expect(labeled.getAttribute('aria-hidden')).toBeNull();
    expect(labeled.querySelector('title')).toBeNull();

    const tittle = labeled.querySelector('circle');
    expect(tittle?.getAttribute('fill')).toContain('--fs-brand-tittle');
    expect(container.querySelector('text')).toBeNull();
  });
});
