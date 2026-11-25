import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

afterEach(cleanup);

describe('BrandMark', () => {
  it('renders the Moonglade SVG with unique defs IDs across multiple instances', () => {
    const { container } = render(
      <div>
        <BrandMark size={28} />
        <BrandMark size={16} label="Feed Sanity" />
      </div>,
    );

    const svgs = container.querySelectorAll('svg.fs-brand-mark');
    expect(svgs).toHaveLength(2);

    const first = svgs[0]!;
    const second = svgs[1]!;

    expect(first.getAttribute('width')).toBe('28');
    expect(first.getAttribute('aria-hidden')).toBe('true');
    expect(first.getAttribute('role')).toBeNull();

    expect(second.getAttribute('width')).toBe('16');
    expect(second.getAttribute('role')).toBe('img');
    expect(second.getAttribute('aria-label')).toBe('Feed Sanity');
    expect(second.getAttribute('aria-hidden')).toBeNull();

    const firstIds = [...first.querySelectorAll('defs [id]')].map((el) => el.id);
    const secondIds = [...second.querySelectorAll('defs [id]')].map((el) => el.id);
    expect(firstIds.length).toBeGreaterThanOrEqual(6);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
    expect(container.querySelector('text')).toBeNull();
  });
});
